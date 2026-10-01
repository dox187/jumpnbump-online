// Changed by dox187 on 2026-09-29, 2026-09-30 and 2026-10-01 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import { read_data } from '../data';
import { MAX_VOLUME, MOD, SFX, SFX_FREQ } from '../constants';
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
type Voice = { source: AudioBufferSourceNode; gain: GainNode; scale: number; preview?: boolean };
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
let sfx_resuming: Promise<void> | null = null;
let effects_wanted = false;
let game_audio = false;
let audio_generation = 0;
const channel_generations: number[] = [];
const channel_volumes: number[] = [];
let music_volume = 100;
let effects_volume = 100;
let gestures_initialized = false;
const track_volumes = new WeakMap<Mod, number>();
const loading = new WeakMap<Mod, Promise<void>>();

export type AudioPreview = 'music' | 'effects';
let preview: AudioPreview | null = null;
let preview_music: Uint8Array | null = null;
let preview_effects: AudioBuffer[] = [];
let preview_samples: ArrayBuffer[] = [];
let preview_track: Mod | null = null;
let preview_timer = 0;
let preview_generation = 0;

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
export function dj_set_audio_preferences(
    mute_music: boolean,
    mute_effects: boolean,
    music = music_volume,
    effects = effects_volume
) {
    music_volume = Math.max(0, Math.min(100, music));
    effects_volume = Math.max(0, Math.min(100, effects));
    context.info.no_music = mute_music;
    context.info.music_no_sound = mute_effects;
    context.info.no_sound = mute_music && mute_effects;
    if (sfx_master) sfx_master.gain.value = mute_effects ? 0 : effects_volume / 100;
    for (const track of tracks) {
        if (track) set_track_volume(track, mute_music ? 0 : ((track_volumes.get(track) ?? 1) * music_volume) / 100);
    }
    if (preview_track) set_track_volume(preview_track, mute_music ? 0 : (30 / MAX_VOLUME) * (music_volume / 100));
    if ((preview === 'music' && mute_music) || (preview === 'effects' && mute_effects)) dj_stop_preview();
}

function sfx_audio(): AudioContext | null {
    if (!sfx_context) {
        try {
            sfx_context = new AudioContext({ latencyHint: 'interactive' });
            sfx_master = sfx_context.createGain();
            sfx_master.gain.value = context.info.music_no_sound || context.info.no_sound ? 0 : effects_volume / 100;
            sfx_master.connect(sfx_context.destination);
        } catch {
            return null;
        }
    }
    return sfx_context;
}

function resume_effects(from_gesture = false): Promise<void> {
    effects_wanted = true;
    const audio = sfx_audio();
    if (!audio || audio.state === 'closed') return Promise.resolve();
    // An autoplay-blocked resume can stay pending until a later gesture calls resume() again.
    // Reusing that promise inside the gesture would leave every effect waiting forever.
    if (sfx_resuming && !from_gesture) return sfx_resuming;
    const resume = () => audio.resume();
    // Preserve the gesture even during a pending suspend; the browser queues these calls in order.
    const done = sfx_suspending && !from_gesture ? sfx_suspending.then(resume) : resume();
    const pending = done
        .catch(() => {})
        .finally(() => {
            if (sfx_resuming === pending) sfx_resuming = null;
            // Leaving the game or hiding the app also wins over a resume that was still waiting on the device.
            if (!effects_wanted || document.hidden) suspend_effects();
        });
    sfx_resuming = pending;
    return pending;
}

function suspend_effects() {
    effects_wanted = false;
    if (!sfx_context || sfx_suspending) return;
    sfx_suspending = sfx_context
        .suspend()
        .catch(() => {})
        .finally(() => {
            sfx_suspending = null;
        });
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
    channel_volumes[channel_num] = volume;
    if (!channels[channel_num]) {
        return;
    }

    for (const voice of channels[channel_num]) {
        voice.gain.gain.value = (volume / MAX_VOLUME) * voice.scale;
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
    const buffer = sfx_buffer(audio, sfx_num, rate);
    const requested = performance.now();
    const generation = audio_generation;
    const channel_generation = channel_generations[channel] ?? 0;
    if (channel !== -1) channel_volumes[channel] = volume;
    const play = () => {
        if (generation !== audio_generation || document.hidden || audio.state !== 'running') return;
        if (channel !== -1 && channel_generation !== (channel_generations[channel] ?? 0)) return;
        // An interrupted device can take hundreds of milliseconds to resume. Never replay old jumps or deaths.
        if (!settings.loop && performance.now() - requested > 100) return;
        start_voice(
            audio,
            buffer,
            freq / rate,
            settings.loop,
            channel === -1 ? volume : channel_volumes[channel],
            channel,
            sfx_num === SFX.FLY ? 0.5 : 1
        );
    };
    if (document.hidden) return;
    if (audio.state === 'running' && !sfx_suspending) play();
    else void resume_effects().then(play);
}

function start_voice(
    audio: AudioContext,
    buffer: AudioBuffer,
    rate: number,
    loop: boolean,
    volume: number,
    channel = -1,
    scale = 1,
    is_preview = false
) {
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = Math.max(0.05, rate);
    const gain = audio.createGain();
    gain.gain.value = (volume / MAX_VOLUME) * scale;
    source.connect(gain).connect(sfx_master!);
    const voice: Voice = { source, gain, scale, preview: is_preview };
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
        if (track.context.state !== 'running') {
            void (suspending.get(track) ?? Promise.resolve())
                .then(() => {
                    if (wanted.get(track) && !document.hidden) return track.context.resume();
                })
                .then(() => {
                    if (document.hidden) suspend_track(track);
                })
                .catch(() => {});
        }
        return;
    }
    // Keep the song's position while muted, so toggling music does not restart it.
    set_track_volume(
        track,
        context.info.no_music || context.info.no_sound ? 0 : ((track_volumes.get(track) ?? 1) * music_volume) / 100
    );
    start_track(track);
}

function start_track(track: Mod) {
    wanted.set(track, true);
    Promise.all([suspending.get(track), loading.get(track)])
        .then(() => {
            if (document.hidden) wanted.set(track, false);
            if (wanted.get(track)) return track.play();
        })
        .then(
            () => {
                if (!wanted.get(track)) stop_track(track);
                else if (document.hidden) suspend_track(track);
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
    game_audio = true;
    dj_stop_preview();
    dj_set_audio_preferences(
        context.info.no_music || context.info.no_sound,
        context.info.music_no_sound || context.info.no_sound
    );
    dj_init_audio_gestures();
    void resume_effects();
}

export function dj_deinit() {
    game_audio = false;
    audio_generation++;
    // Nothing plays outside the game, so the effects context sleeps until the next sound
    for (const voice of voices) stop_voice(voice);
    channels.length = 0;
    suspend_effects();
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
    set_track_volume(
        track,
        context.info.no_music || context.info.no_sound ? 0 : (volume / MAX_VOLUME) * (music_volume / 100)
    );
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
    channel_generations[channel_num] = (channel_generations[channel_num] ?? 0) + 1;
    if (!channels[channel_num]) {
        return;
    }

    for (const voice of channels[channel_num]) stop_voice(voice);
    channels[channel_num] = [];
}

export function dj_load_sfx(filename: string, sfx_num: SFX) {
    sounds[sfx_num] = sample_data(read_data(filename));
    // Each level may bring its own sounds. Decode before the first jump, not on the input frame.
    sfx_buffers.delete(sfx_num);
    const audio = sfx_audio();
    if (audio) sfx_buffer(audio, sfx_num, limitToWebSafeSampleRate(dj_get_sfx_settings(sfx_num).default_freq));
}

function sample_data(src: Uint8Array): ArrayBuffer {
    const dest = new Uint8Array(src.byteLength / 2);
    for (let i = 0; i < dest.byteLength; i++) {
        const temp = src[i * 2] + (src[i * 2 + 1] << 8);
        dest[i] = temp;
    }
    return dest.buffer;
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
        const track = new Mod({ audioWorkletUrl, wasmUrl });
        loading.set(
            track,
            track.loadData(src).catch((error) => console.info('Music could not load:', error))
        );
        tracks[mod_num] = track;
        // All songs are loaded up front but only one plays; dj_start_mod resumes its context
        suspend_track(track);
    } catch (e) {
        console.info('Music is not available in this browser:', e);
    }
}

/** Unlock on real input before asynchronous level loading; keep recovering after mobile audio interruptions. */
export function dj_init_audio_gestures() {
    if (gestures_initialized) return;
    gestures_initialized = true;
    const gesture = (event: Event) => {
        if (!event.isTrusted) return;
        if (!sfx_context || sfx_resuming || game_audio || preview === 'effects') {
            void resume_effects(true).then(() => {
                if (!game_audio && preview !== 'effects') suspend_effects();
            });
        }
        if (game_audio) dj_start_mod();
        if (preview === 'music' && preview_track) preview_track.context.resume().catch(() => {});
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'touchend', 'keydown', 'click']) {
        window.addEventListener(type, gesture, { capture: true, passive: true });
    }
    window.addEventListener('blur', dj_stop_preview);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            audio_generation++;
            dj_stop_preview();
            for (const voice of voices) if (!voice.source.loop) stop_voice(voice);
            suspend_effects();
            // Explicitly suspend active music too: mobile WebKit may otherwise return with an interrupted clock.
            for (const track of tracks) if (track && wanted.get(track)) suspend_track(track);
        } else if (game_audio) {
            void resume_effects();
            dj_start_mod();
        }
    });
}

/** Copy the original menu's samples while its datafile is loaded; previews never replace a match's datafile. */
export function dj_load_preview_audio() {
    preview_music = read_data('jump.mod').slice();
    preview_samples = ['jump.smp', 'spring.smp', 'death.smp'].map((file) => sample_data(read_data(file)));
}

export function dj_preview_audio(kind: AudioPreview) {
    if (preview === kind || game_audio || document.hidden) return;
    dj_stop_preview();
    if (kind === 'music' ? context.info.no_music : context.info.music_no_sound) return;
    preview = kind;
    const generation = preview_generation;
    if (kind === 'music') {
        if (!music_supported() || !preview_music) return;
        if (!preview_track) {
            preview_track = new Mod({ audioWorkletUrl, wasmUrl });
            loading.set(
                preview_track,
                preview_track.loadData(preview_music).catch(() => {})
            );
        }
        set_track_volume(preview_track, (30 / MAX_VOLUME) * (music_volume / 100));
        // Resume inside the focus/input gesture, before waiting for worklet loading.
        preview_track.context.resume().catch(() => {});
        start_track(preview_track);
    } else {
        const audio = sfx_audio();
        if (!audio) return;
        if (!preview_effects.length) {
            preview_effects = preview_samples.map((sample) => {
                const data = new Int8Array(sample);
                const buffer = audio.createBuffer(1, data.length, SFX_FREQ.JUMP);
                buffer.getChannelData(0).set(Float32Array.from(data, (value) => value / 128));
                return buffer;
            });
        }
        let index = 0;
        const play = () => {
            if (
                generation !== preview_generation ||
                preview !== 'effects' ||
                audio.state !== 'running' ||
                !preview_effects.length
            )
                return;
            start_voice(audio, preview_effects[index++ % preview_effects.length], 1, false, MAX_VOLUME, -1, 1, true);
        };
        void resume_effects().then(play);
        preview_timer = window.setInterval(play, 800);
    }
}

export function dj_stop_preview() {
    preview = null;
    preview_generation++;
    clearInterval(preview_timer);
    if (preview_track) stop_track(preview_track);
    for (const voice of voices) if (voice.preview) stop_voice(voice);
    if (!game_audio) suspend_effects();
}

export function dj_dispose_preview() {
    dj_stop_preview();
    const track = preview_track;
    preview_track = null;
    if (track) void (loading.get(track) ?? Promise.resolve()).finally(() => track.context.close().catch(() => {}));
}
