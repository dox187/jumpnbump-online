import { read_data } from '../data';
import { MAX_VOLUME, MOD, SFX } from '../constants';
import { Mod } from '@webtrack/mod';
/* @ts-ignore - Special static import with Vite */
import audioWorkletUrl from '@webtrack/mod/dist/mod-processor.js?url';
/* @ts-ignore - Special static import with Vite */
import wasmUrl from '@webtrack/mod/dist/hxcmod_player.wasm?url';
import context from '../context';

type SoundConfig = { loop: boolean; default_freq: number };
const soundSettings: SoundConfig[] = [];
const sounds: ArrayBuffer[] = [];
/** A sound effect that is playing. */
type Voice = { source: AudioBufferSourceNode; gain: GainNode };
const channels: Voice[][] = [];
const tracks: Mod[] = [];
let currentTrack: MOD | null = null;
const getCurrentTrack = () => tracks[currentTrack] ?? null;

const SAFE_MIN_SAMPLE_RATE = 8000;
const SAFE_MAX_SAMPLE_RATE = 96000;
// MDN says that the AudioContext implementation should at least support PCM sample rates from 8000-96000Hz
// FireFox throws an error for sample rates below 8000Hz
// https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
const limitToWebSafeSampleRate = (sampleRate: number) =>
    Math.min(Math.max(sampleRate, SAFE_MIN_SAMPLE_RATE), SAFE_MAX_SAMPLE_RATE);

/**
 * One AudioContext for all sound effects. The sample library this replaces opened a new one for every sound
 * played (each jump, splash and death) and never closed them; browsers allow only a limited number.
 */
let sfx_context: AudioContext | null = null;

function sfx_audio(): AudioContext | null {
    if (!sfx_context) {
        try {
            sfx_context = new AudioContext();
        } catch {
            return null;
        }
    }
    if (sfx_context.state === 'suspended') sfx_context.resume().catch(() => {});
    return sfx_context;
}

/** Decoded samples (signed 8-bit PCM) at the sound's own rate; other pitches play them faster or slower. */
const sfx_buffers = new Map<number, AudioBuffer>();

function sfx_buffer(audio: AudioContext, sfx_num: number, rate: number) {
    let buffer = sfx_buffers.get(sfx_num);
    if (!buffer || buffer.sampleRate !== rate || buffer.length === 0) {
        const data = new Int8Array(sounds[sfx_num]);
        buffer = audio.createBuffer(1, Math.max(1, data.length), rate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) channel[i] = data[i] / 128;
        sfx_buffers.set(sfx_num, buffer);
    }
    return buffer;
}

export function dj_set_sfx_channel_volume(channel_num: number, volume: number) {
    if (!channels[channel_num]) {
        return;
    }

    for (const voice of channels[channel_num]) {
        voice.gain.gain.value = volume / MAX_VOLUME;
    }
}

export function dj_play_sfx(
    sfx_num: number,
    freq: number,
    volume: number,
    panning: number,
    delay: number,
    channel: number
) {
    if (context.info.music_no_sound || context.info.no_sound) {
        return;
    }

    if (!sounds[sfx_num]) {
        console.warn(`Sound ${sfx_num} not loaded`);
        return;
    }

    const audio = sfx_audio();
    if (!audio) return;
    const settings = dj_get_sfx_settings(sfx_num);
    const rate = limitToWebSafeSampleRate(settings.default_freq);
    const source = audio.createBufferSource();
    source.buffer = sfx_buffer(audio, sfx_num, rate);
    source.loop = settings.loop;
    source.playbackRate.value = Math.max(0.05, freq / rate);
    const gain = audio.createGain();
    gain.gain.value = volume / MAX_VOLUME;
    source.connect(gain).connect(audio.destination);
    const voice: Voice = { source, gain };
    source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (channel !== -1) channels[channel] = (channels[channel] ?? []).filter((v) => v !== voice);
    };
    source.start();

    if (channel !== -1) {
        channels[channel] = channels[channel] || [];
        channels[channel].push(voice);
    }
}

export function dj_get_sfx_settings(sfx_num: number) {
    return (
        soundSettings[sfx_num] || {
            loop: false,
            default_freq: 11025,
        }
    );
}

export function dj_set_sfx_settings(sfx_num: number, settings: SoundConfig) {
    soundSettings[sfx_num] = settings;
}

export function dj_set_nosound(enable: number) {
    return;
}

/** Whether each track should be playing: a stop that arrives while play() is still starting wins. */
const wanted = new WeakMap<Mod, boolean>();

/**
 * Stops a track for real. Mod.stop() disconnects the worklet from the destination although it is connected to
 * the gain node, so it throws halfway and the music played on (for example in the menu after leaving a match).
 */
function stop_track(track: Mod) {
    wanted.set(track, false);
    try {
        track.gainNode?.disconnect();
    } catch {
        // not connected
    }
    const node = track.node;
    if (node) {
        try {
            node.disconnect();
        } catch {
            // not connected
        }
        node.port.postMessage({ command: 'stop' });
        // play() makes a new node and loads the song into it again
        track.node = null;
    }
    track.context.suspend().catch(() => {});
}

export function dj_start_mod() {
    if (context.info.no_sound || context.info.no_music) {
        return;
    }

    const track = getCurrentTrack();
    if (track === null) {
        return;
    }
    wanted.set(track, true);
    track.play().then(
        () => {
            if (!wanted.get(track)) stop_track(track);
        },
        (e: unknown) => console.info('Music could not start:', e)
    );
}

export function dj_stop_mod() {
    return;
}

export function dj_init() {
    window.addEventListener('touchstart', handleUserGesture);
    window.addEventListener('mousedown', handleUserGesture);
    window.addEventListener('keydown', handleKeyboardUserGesture);
}

export function dj_deinit() {
    window.removeEventListener('touchstart', handleUserGesture);
    window.removeEventListener('mousedown', handleUserGesture);
    window.removeEventListener('keydown', handleKeyboardUserGesture);
}

/** Stops the music: every track, also the ones that were faded out and left running. */
export function dj_stop() {
    for (const track of tracks) if (track) stop_track(track);
}

export function dj_ready_mod(mod_type: MOD) {
    // Like the original player, getting a song ready ends the one that was loaded before
    const previous = getCurrentTrack();
    if (previous && currentTrack !== mod_type) stop_track(previous);
    currentTrack = mod_type;
}

export function dj_set_mod_volume(volume: number) {
    if (context.info.no_sound) {
        return;
    }

    const track = getCurrentTrack();
    if (track === null) {
        return;
    }
    track.setVolume(volume / MAX_VOLUME);
}

export function dj_set_sfx_volume(volume: number) {}

export function dj_mix() {}

export function dj_stop_sfx_channel(channel_num: number) {
    if (!channels[channel_num]) {
        return;
    }

    for (const voice of channels[channel_num]) {
        try {
            voice.source.stop();
        } catch {
            // already stopped
        }
        voice.source.disconnect();
        voice.gain.disconnect();
    }
    channels[channel_num] = [];
}

export function dj_load_sfx(filename: string, sfx_num: SFX) {
    const src = read_data(filename);
    const dest = new Uint8Array(src.byteLength / 2);
    for (let i = 0; i < dest.byteLength; i++) {
        const temp = src[i * 2] + (src[i * 2 + 1] << 8);
        dest[i] = temp;
    }
    sounds[sfx_num] = dest.buffer;
    // Each level may bring its own sounds
    sfx_buffers.delete(sfx_num);
}

/** The MOD player needs an AudioWorklet, which browsers only offer on HTTPS pages and on localhost. */
export function music_supported() {
    return typeof window !== 'undefined' && window.isSecureContext && typeof AudioWorkletNode !== 'undefined';
}

export function dj_load_mod(filename: string, mod_num: MOD) {
    if (!music_supported()) {
        // Play on without music; the sound effects do not need the worklet
        return;
    }
    const src = read_data(filename);
    // Each track has its own AudioContext; close the old one, browsers only allow a few at a time
    const old = tracks[mod_num];
    if (old) {
        stop_track(old);
        old.context.close().catch(() => {});
    }
    try {
        tracks[mod_num] = new Mod({ src, audioWorkletUrl, wasmUrl });
    } catch (e) {
        console.info('Music is not available in this browser:', e);
    }
}

function handleUserGesture(event: Event) {
    if (event.isTrusted) {
        // Phones only let audio start from a tap or a key press
        sfx_audio();
        dj_start_mod();
        window.removeEventListener(event.type, handleUserGesture);
    }
}

function handleKeyboardUserGesture(event: KeyboardEvent) {
    sfx_audio();
    dj_start_mod();
    const isArrowKeys =
        event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight';

    // Ignore arrow keys, as they are not considered user gestures in Firefox
    if (!isArrowKeys && event.isTrusted) {
        window.removeEventListener(event.type, handleKeyboardUserGesture);
    }
}
