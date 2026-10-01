// Changed by dox187 on 2026-09-29, 2026-09-30 and 2026-10-01 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

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
/** Every sound effect that is playing, also those on no channel (-1). */
const voices = new Set<Voice>();
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
let sfx_master: GainNode | null = null;
/** Set while the effects context is being suspended after a game; the next sound resumes it once that is done. */
let sfx_suspending: Promise<void> | null = null;
const track_volumes = new WeakMap<Mod, number>();

function set_track_volume(track: Mod, volume: number) {
    track.setVolume(volume);
    // The player library ramps zero through 0.01. Cancel that ramp for a truly silent mute,
    // including while the game keeps updating its fade volume every frame.
    if (volume === 0 && track.gainNode) {
        track.gainNode.gain.cancelScheduledValues(track.context.currentTime);
        track.gainNode.gain.setValueAtTime(0, track.context.currentTime);
    }
}

/** Apply saved audio switches immediately, including looping effects and songs already playing. */
export function dj_set_audio_preferences(mute_music: boolean, mute_effects: boolean) {
    context.info.no_music = mute_music;
    context.info.music_no_sound = mute_effects;
    context.info.no_sound = mute_music && mute_effects;
    if (sfx_master) sfx_master.gain.value = mute_effects ? 0 : 1;
    for (const track of tracks) {
        if (track) set_track_volume(track, mute_music ? 0 : (track_volumes.get(track) ?? 1));
    }
}

function sfx_audio(): AudioContext | null {
    if (!sfx_context) {
        try {
            sfx_context = new AudioContext();
            sfx_master = sfx_context.createGain();
            sfx_master.gain.value = context.info.music_no_sound || context.info.no_sound ? 0 : 1;
            sfx_master.connect(sfx_context.destination);
        } catch {
            return null;
        }
    }
    if (sfx_suspending) {
        const audio = sfx_context;
        sfx_suspending.then(() => audio.resume()).catch(() => {});
        sfx_suspending = null;
    } else if (sfx_context.state === 'suspended') sfx_context.resume().catch(() => {});
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
    source.connect(gain).connect(sfx_master!);
    const voice: Voice = { source, gain };
    voices.add(voice);
    source.onended = () => {
        voices.delete(voice);
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
    suspend_track(track);
}

/** The latest suspend() of each track's AudioContext; play() waits for it, or the song would start suspended. */
const suspending = new WeakMap<Mod, Promise<void>>();

/** A running AudioContext keeps the audio device busy even in silence, which costs battery on phones. */
function suspend_track(track: Mod) {
    const done = track.context.suspend().catch(() => {});
    suspending.set(track, done);
}

export function dj_start_mod() {
    const track = getCurrentTrack();
    if (track === null) return;
    if (wanted.get(track)) {
        if (track.context.state === 'suspended') track.context.resume().catch(() => {});
        return;
    }
    // Keep the song's position while muted, so toggling music does not restart it.
    set_track_volume(track, context.info.no_music || context.info.no_sound ? 0 : (track_volumes.get(track) ?? 1));
    wanted.set(track, true);
    (suspending.get(track) ?? Promise.resolve())
        .then(() => track.play())
        .then(
            () => {
                if (!wanted.get(track)) stop_track(track);
            },
            (e: unknown) => {
                wanted.set(track, false);
                console.info('Music could not start:', e);
            }
        );
}

export function dj_stop_mod() {
    return;
}

export function dj_init() {
    dj_set_audio_preferences(
        context.info.no_music || context.info.no_sound,
        context.info.music_no_sound || context.info.no_sound
    );
    window.addEventListener('touchstart', handleUserGesture);
    window.addEventListener('mousedown', handleUserGesture);
    window.addEventListener('keydown', handleKeyboardUserGesture);
}

export function dj_deinit() {
    window.removeEventListener('touchstart', handleUserGesture);
    window.removeEventListener('mousedown', handleUserGesture);
    window.removeEventListener('keydown', handleKeyboardUserGesture);
    // Nothing plays outside the game, so the effects context sleeps until the next sound
    for (const voice of voices) stop_voice(voice);
    channels.length = 0;
    if (sfx_context && !sfx_suspending) sfx_suspending = sfx_context.suspend().catch(() => {});
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
    const track = getCurrentTrack();
    if (track === null) {
        return;
    }
    track_volumes.set(track, volume / MAX_VOLUME);
    set_track_volume(track, context.info.no_music || context.info.no_sound ? 0 : volume / MAX_VOLUME);
}

export function dj_set_sfx_volume(volume: number) {}

export function dj_mix() {}

function stop_voice(voice: Voice) {
    voices.delete(voice);
    try {
        voice.source.stop();
    } catch {
        // already stopped
    }
    voice.source.disconnect();
    voice.gain.disconnect();
}

export function dj_stop_sfx_channel(channel_num: number) {
    if (!channels[channel_num]) {
        return;
    }

    for (const voice of channels[channel_num]) stop_voice(voice);
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
        const track = new Mod({ src, audioWorkletUrl, wasmUrl });
        tracks[mod_num] = track;
        // All songs are loaded up front but only one plays; dj_start_mod resumes its context
        suspend_track(track);
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
