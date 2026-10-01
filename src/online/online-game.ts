// Contains code from src/main.ts, src/menu.ts and src/renderer.ts of jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js),
// changed by dox187 on 2026-09-29, 2026-09-30 and 2026-10-01.

/**
 * Runs one online match in a canvas: loads the level, drives the NetSession every animation frame,
 * draws the predicted state with the original renderer, replays the last death in slow motion and
 * finally shows the classic score screen.
 */
import { get_gob } from '../assets';
import { memset } from '../c';
import { JNB_MAX_PLAYERS, KEY, MOD, NUM, OBJ, SCREEN_HEIGHT, SCREEN_WIDTH, SFX, SFX_FREQ } from '../constants';
import ctx, { resetContext } from '../context';
import { local_fx, show_score } from '../fx';
import type { GameInputDevice } from '../inputs';
import { get_ban_map } from '../level';
import { deinit_program, init_level_scene, init_program, update_objects } from '../main';
import { COUNTDOWN_FRAMES, ClientMessage, FRAME_MS, MatchInfo, MatchResult, ServerMessage } from '../net/protocol';
import { NetSession, SessionStats } from '../net/session';
import {
    add_pob,
    clear_scores,
    draw_flies,
    draw_leftovers,
    draw_pobs,
    draw_score,
    position_flies,
    update_flies,
} from '../renderer';
import { read_pcx } from '../data';
import { draw_begin, draw_end, put_text, register_background, register_mask, setpalette } from '../sdl/gfx';
import { read_device_input } from '../sdl/input';
import { addkey, gamepad_went_down, intr_sysupdate, key_went_down, set_ai_hotkeys_enabled } from '../sdl/interrpt';
import {
    dj_play_sfx,
    dj_ready_mod,
    dj_set_mod_volume,
    dj_set_sfx_volume,
    dj_start_mod,
    dj_stop,
    dj_stop_sfx_channel,
} from '../sdl/sound';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, NO_CHEATS, Sim, SimFx, SimState, clone_state } from '../sim/sim';
import type { Pob } from '../assets';
import { CAPS_TOP, TextColor, fit_text, font_ready, init_font, render_text } from '../web/pixel/font';
import { PAD_A, PAD_B, extra_mask } from '../extra-input';
import { clear_panel_names, render_panel_name } from './panel-names';
import { panel_name_layouts } from './panel-layouts';

export type OnlineGameOptions = {
    canvas: HTMLCanvasElement;
    dat: ArrayBuffer;
    match: MatchInfo;
    /** Our bunny, or -1 when we only watch. */
    slot: number;
    control: GameInputDevice;
    mute_music: boolean;
    mute_effects: boolean;
    nogore: boolean;
    noflies: boolean;
    send: (message: ClientMessage) => void;
    rtt_ms: () => number;
    /** The player pressed ESC; the page decides what that means (quit or end the match). */
    on_escape: () => void;
    /** The score screen was dismissed. */
    on_exit: () => void;
};

export type OnlineGamePhase = 'loading' | 'waiting' | 'playing' | 'replay' | 'ending' | 'scores';

/** Seconds left before the bunnies may move (3, 2, 1), 0 for "go", null once the match runs. */
export type Countdown = number | null;

const BUNNY_LABELS = ['DOTT', 'JIFFY', 'FIZZ', 'MIJJI'];
const SCORE_NAME_WIDTH = 56;
/** How long "GO!" stays up, in frames. */
const GO_FRAMES = 40;

/** The replay shows the frames around the last death: this many before it and after it... */
const REPLAY_BEFORE = 100;
const REPLAY_AFTER = 20;
/** ...this many times slower than real time (2 seconds take 5)... */
const REPLAY_SLOWDOWN = 2.5;
/** ...and holds the last frame this long. */
const REPLAY_HOLD_MS = 600;
/** Confirmed states are kept every this many frames, for this many frames back. */
const SNAPSHOT_EVERY = 30;
const HISTORY_FRAMES = 1200;
/** A bunny that moved further than this between two frames respawned; it is not interpolated. */
const TELEPORT_PX = 32;

/** A player name drawn in the game font. */
type NameTag = { canvas: HTMLCanvasElement };

function name_tag(text: string, width: number, color: TextColor): NameTag {
    return { canvas: render_text(fit_text(text, width), color, true) };
}

function total_bumps(state: SimState) {
    let total = 0;
    for (const player of state.player) total += player.bumps;
    return total;
}

type Replay = {
    state: SimState;
    sim: Sim;
    first: number;
    last: number;
    started: number;
    /** Positions before the latest step, for smooth slow motion. */
    from_x: number[];
    from_y: number[];
};

export class OnlineGame {
    phase: OnlineGamePhase = 'loading';
    result: MatchResult | null = null;
    on_phase: (phase: OnlineGamePhase) => void = () => {};
    on_countdown: (countdown: Countdown) => void = () => {};

    private options: OnlineGameOptions;
    private session: NetSession | null = null;
    private pal = new Uint8ClampedArray(768);
    private cur_pal = new Uint8ClampedArray(768);
    private mod_vol = 0;
    private sfx_vol = 0;
    private update_palette = false;
    private object_pobs: Pob[] = [];
    private frame_request = 0;
    private destroyed = false;
    private last_scores_tick = 0;
    private fading_out_scores = false;
    private queued: ServerMessage[] = [];
    private last_render_frame = -1;
    private last_render_time = 0;
    private screen: CanvasRenderingContext2D | null = null;
    /** Per bunny slot: the name on the side panel and on the score screen. */
    private plate_tags: (NameTag | null)[] = [];
    private score_tags: (NameTag | null)[] = [];
    private countdown: Countdown = null;

    /** Recent confirmed history for the replay. */
    private snapshots: SimState[] = [];
    private inputs = new Int32Array(HISTORY_FRAMES);
    private enabled = new Uint8Array(HISTORY_FRAMES);
    private recorded_until = 0;
    private last_input = 0;
    private bumps_seen = 0;
    private last_kill_frame = -1;
    private replay: Replay | null = null;
    /** What the fade-out after the match shows: the end of the replay, or the final state. */
    private ending_view: SimState | null = null;

    constructor(options: OnlineGameOptions) {
        this.options = options;
    }

    stats(): SessionStats | null {
        return this.session ? this.session.stats() : null;
    }

    private get spectator() {
        return this.options.slot < 0;
    }

    /** Prepares graphics, sound and the level. Resolves when the level is ready to be played. */
    init() {
        const { canvas, options } = { canvas: this.options.canvas, options: this.options };
        canvas.width = SCREEN_WIDTH;
        canvas.height = SCREEN_HEIGHT;

        resetContext();
        ctx.state = 'running';
        ctx.info.no_gore = options.nogore;
        ctx.info.no_sound = options.mute_music && options.mute_effects;
        ctx.info.no_music = options.mute_music;
        ctx.info.music_no_sound = options.mute_effects;
        if (!this.spectator) {
            const controls = [...ctx.controls];
            controls[options.slot] = options.control;
            ctx.controls = controls;
        }

        init_program(canvas, options.dat, this.pal);
        this.screen = canvas.getContext('2d');
        if (!font_ready()) init_font(get_gob('font'));
        this.make_name_tags(options.match.slots.map((s) => s?.name ?? null));
        set_ai_hotkeys_enabled(false);
        init_level_scene(this.pal);
        const background = read_pcx('level.pcx', this.pal);
        clear_panel_names(background, options.match.level);
        register_background(background, this.pal);
        // Masks copy pixels from the background, including the labels on some custom levels.
        register_mask(read_pcx('mask.pcx', null), this.pal);
        if (!options.noflies) position_flies();

        memset(this.cur_pal, 0, 768);
        setpalette(0, 256, this.cur_pal);

        window.addEventListener('blur', this.release_keys);
        document.addEventListener('visibilitychange', this.release_keys);
        this.set_phase('waiting');
    }

    handle_message(message: ServerMessage) {
        if (this.destroyed) return;
        if (message.t === 'go' || message.t === 'watch') {
            this.start(message.state);
            return;
        }
        if (!this.session) {
            // Confirmations can only follow 'go', but keep anything that arrives early
            this.queued.push(message);
            return;
        }
        this.session.handle_message(message);
        if (message.t === 'over') {
            this.result = message.result;
            this.make_name_tags(message.result.names);
            // The final step may have been the deciding bump
            if (total_bumps(message.state) > this.bumps_seen) this.last_kill_frame = message.state.frame - 1;
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        cancelAnimationFrame(this.frame_request);
        window.removeEventListener('blur', this.release_keys);
        document.removeEventListener('visibilitychange', this.release_keys);
        dj_stop_sfx_channel(4);
        dj_stop();
        deinit_program();
        set_ai_hotkeys_enabled(true);
        ctx.state = 'stopped';
    }

    /** Leaves the slow-motion replay, e.g. from a button in the page overlay. */
    skip_replay() {
        if (this.phase === 'replay') this.end_replay();
    }

    /** Continues from the score screen, e.g. from a button in the page overlay. */
    dismiss_scores() {
        if (this.phase === 'scores') this.fading_out_scores = true;
    }

    private start(state: SimState) {
        if (this.session) return;
        const options = this.options;
        this.bumps_seen = total_bumps(state);
        this.session = new NetSession({
            slot: options.slot,
            state,
            map: get_ban_map(),
            end_score: options.match.endScore,
            send: options.send,
            now: performance.now(),
            rtt_ms: options.rtt_ms(),
            fx: local_fx,
            on_new_frame: this.on_new_frame,
            on_confirm: this.record,
        });
        for (const message of this.queued.splice(0)) this.handle_message(message);

        this.mod_vol = this.sfx_vol = 0;
        dj_ready_mod(MOD.GAME);
        dj_set_mod_volume(0);
        dj_set_sfx_volume(0);
        dj_start_mod();
        if (!options.noflies) dj_play_sfx(SFX.FLY, SFX_FREQ.FLY, 0, 0, 0, 4);

        this.set_phase('playing');
        this.frame_request = requestAnimationFrame(this.loop);
    }

    private make_name_tags(names: (string | null)[]) {
        const layouts = panel_name_layouts(this.options.match.level);
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const name = names[i];
            const color: TextColor = i === this.options.slot ? 'gold' : 'white';
            this.plate_tags[i] = name ? { canvas: render_panel_name(name, i, layouts[i].width) } : null;
            this.score_tags[i] = name ? name_tag(name, SCORE_NAME_WIDTH, color) : null;
        }
    }

    /** How far the palette has faded in (0-1); the names drawn over the screen follow it. */
    private brightness() {
        let current = 0;
        let target = 0;
        for (let i = 0; i < 768; i++) {
            current += this.cur_pal[i];
            target += this.pal[i];
        }
        return target ? Math.min(1, current / target) : 1;
    }

    /** Compact names painted directly onto the cleared stone panels. */
    private draw_name_plates(state: SimState) {
        const screen = this.screen;
        if (!screen) return;
        const alpha = this.brightness();
        if (alpha <= 0) return;
        screen.globalAlpha = alpha;
        const layouts = panel_name_layouts(this.options.match.level);
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const tag = this.plate_tags[i];
            if (!tag || !state.player[i].enabled) continue;
            const layout = layouts[i];
            screen.drawImage(tag.canvas, 352 + layout.x, layout.y + i * 64);
        }
        screen.globalAlpha = 1;
    }

    private set_phase(phase: OnlineGamePhase) {
        this.phase = phase;
        this.on_phase(phase);
    }

    private set_countdown(countdown: Countdown) {
        if (countdown === this.countdown) return;
        this.countdown = countdown;
        this.on_countdown(countdown);
    }

    private loop = (now: number) => {
        if (this.destroyed) return;
        this.frame_request = requestAnimationFrame(this.loop);
        intr_sysupdate();

        // A gamepad's Start or Back button counts as Escape (see intr_sysupdate)
        const escape_pressed = key_went_down(KEY.ESCAPE);
        const skip_pressed = escape_pressed || key_went_down('Enter') || key_went_down('Space');

        if (this.phase === 'playing') {
            if (escape_pressed) this.options.on_escape();
            const session = this.session!;
            session.update(now, this.read_input());
            const left = COUNTDOWN_FRAMES - session.frame;
            this.set_countdown(left > 0 ? Math.ceil(left / 60) : left > -GO_FRAMES ? 0 : null);
            // Draw once per simulated frame; high refresh rate screens would otherwise redraw for nothing
            const new_frame = session.frame !== this.last_render_frame;
            if (session.dirty && (new_frame || now - this.last_render_time > 50 || session.finished)) {
                session.dirty = false;
                this.last_render_frame = session.frame;
                this.last_render_time = now;
                this.render(session.view);
            }
            if (session.finished) {
                this.set_countdown(null);
                if (!this.start_replay(now)) this.set_phase('ending');
            }
        } else if (this.phase === 'replay') {
            if (skip_pressed) this.end_replay();
            else this.replay_step(now);
        } else if (this.phase === 'ending') {
            this.fade_out_step(now);
        } else if (this.phase === 'scores') {
            // A and B are jump buttons: only the score screen takes them, the replay must not end by accident
            if (skip_pressed || gamepad_went_down(PAD_A, PAD_B)) this.fading_out_scores = true;
            this.scores_step(now);
        }
    };

    private read_input() {
        if (this.spectator) return 0;
        const slot = this.options.slot;
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let mask = 0;
        if (read_device_input(slot, 0, gamepads)) mask |= INPUT_LEFT;
        if (read_device_input(slot, 1, gamepads)) mask |= INPUT_RIGHT;
        if (read_device_input(slot, 2, gamepads)) mask |= INPUT_UP;
        return mask | extra_mask();
    }

    private release_keys = () => {
        const control = ctx.controls[this.options.slot];
        if (control && control.type === 'keyboard') for (const key of control.mappings) addkey(key, false);
    };

    /** Keeps the confirmed history the replay needs; called before each confirmed frame is simulated. */
    private record = (state: SimState, packed: number) => {
        const f = state.frame;
        const bumps = total_bumps(state);
        if (bumps > this.bumps_seen) this.last_kill_frame = f - 1;
        this.bumps_seen = bumps;
        if (f % SNAPSHOT_EVERY === 0) {
            this.snapshots.push(clone_state(state));
            if (this.snapshots.length > HISTORY_FRAMES / SNAPSHOT_EVERY) this.snapshots.shift();
        }
        let enabled = 0;
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) if (state.player[i].enabled) enabled |= 1 << i;
        this.inputs[f % HISTORY_FRAMES] = packed;
        this.enabled[f % HISTORY_FRAMES] = enabled;
        this.recorded_until = f + 1;
        this.last_input = packed;
    };

    /** Advances everything cosmetic by one frame. */
    private advance_cosmetics(state: SimState) {
        const main_info = ctx.info;
        ctx.player = state.player as typeof ctx.player;
        main_info.page_info.num_pobs = 0;
        update_objects();
        this.object_pobs = main_info.page_info.pobs.slice(0, main_info.page_info.num_pobs);
        if (!this.options.noflies) update_flies(1);
    }

    /** Called once for every newly simulated frame: cosmetics plus the fade-in of palette and volume. */
    private on_new_frame = (state: SimState) => {
        this.advance_cosmetics(state);
        if (this.mod_vol < 30) dj_set_mod_volume(++this.mod_vol);
        if (this.sfx_vol < 64) dj_set_sfx_volume(++this.sfx_vol);
        for (let i = 0; i < 768; i++) {
            if (this.cur_pal[i] < this.pal[i]) {
                this.cur_pal[i]++;
                this.update_palette = true;
            } else if (this.cur_pal[i] > this.pal[i]) {
                this.cur_pal[i]--;
                this.update_palette = true;
            }
        }
    };

    /** Rebuilds the last death from the recorded history and starts showing it slowed down. */
    private start_replay(now: number) {
        const kill = this.last_kill_frame;
        if (kill < 0) return false;
        const first = Math.max(0, kill - REPLAY_BEFORE + 1);
        if (first < this.recorded_until - HISTORY_FRAMES) return false;
        let snapshot: SimState | null = null;
        for (const s of this.snapshots)
            if (s.frame <= first && s.frame >= this.recorded_until - HISTORY_FRAMES) snapshot = s;
        if (!snapshot) return false;

        const state = clone_state(snapshot);
        const sim = new Sim(state, get_ban_map(), NO_CHEATS, 0);
        while (state.frame < first) this.replay_sim_step(sim, state);

        // Leftover fur, flesh, smoke and splashes of the real death would fly around in the replay too
        for (const object of ctx.objects) {
            if (object.type !== OBJ.SPRING && object.type !== OBJ.YEL_BUTFLY && object.type !== OBJ.PINK_BUTFLY) {
                object.used = 0;
            }
        }
        const fx: SimFx = {
            objects: ctx.objects,
            no_gore: ctx.info.no_gore,
            rnd: local_fx.rnd,
            add_object: local_fx.add_object,
            // Deeper, slower sounds for the slow motion
            dj_play_sfx: (sfx, freq, volume, panning, delay, channel) =>
                local_fx.dj_play_sfx(sfx, Math.round(freq / 2), volume, panning, delay, channel),
            add_score: () => {},
        };
        sim.fx = fx;
        this.replay = {
            state,
            sim,
            first,
            last: kill + REPLAY_AFTER,
            started: now,
            from_x: state.player.map((p) => p.x),
            from_y: state.player.map((p) => p.y),
        };
        this.set_phase('replay');
        return true;
    }

    /** One replayed frame: the recorded inputs, or after the end of the match the last ones. */
    private replay_sim_step(sim: Sim, state: SimState) {
        const f = state.frame;
        let packed = this.last_input;
        if (f < this.recorded_until) {
            packed = this.inputs[f % HISTORY_FRAMES];
            const enabled = this.enabled[f % HISTORY_FRAMES];
            for (let i = 0; i < JNB_MAX_PLAYERS; i++) state.player[i].enabled = (enabled & (1 << i)) !== 0;
        }
        sim.step(packed);
    }

    private replay_step(now: number) {
        const replay = this.replay!;
        const state = replay.state;
        const frames = (now - replay.started) / (FRAME_MS * REPLAY_SLOWDOWN);
        const target = Math.min(replay.first + Math.floor(frames), replay.last + 1);
        while (state.frame < target) {
            for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
                replay.from_x[i] = state.player[i].x;
                replay.from_y[i] = state.player[i].y;
            }
            this.replay_sim_step(replay.sim, state);
            this.advance_cosmetics(state);
        }
        const done = state.frame > replay.last;
        this.render(state, done ? null : { x: replay.from_x, y: replay.from_y, t: frames % 1 });
        const length_ms = (replay.last + 1 - replay.first) * FRAME_MS * REPLAY_SLOWDOWN;
        if (done && now - replay.started > length_ms + REPLAY_HOLD_MS) this.end_replay();
    }

    private end_replay() {
        this.ending_view = this.replay?.state ?? null;
        this.replay = null;
        this.set_phase('ending');
    }

    private render(state: SimState, blend: { x: number[]; y: number[]; t: number } | null = null) {
        const main_info = ctx.info;
        const rabbit_gobs = get_gob('rabbit');
        ctx.player = state.player as typeof ctx.player;

        const pobs: Pob[] = [];
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const player = state.player[i];
            if (!player.enabled) continue;
            let x = player.x >> 16;
            let y = player.y >> 16;
            if (blend) {
                const from_x = blend.x[i] >> 16;
                const from_y = blend.y[i] >> 16;
                if (Math.abs(x - from_x) < TELEPORT_PX && Math.abs(y - from_y) < TELEPORT_PX) {
                    x = Math.round(from_x + (x - from_x) * blend.t);
                    y = Math.round(from_y + (y - from_y) * blend.t);
                }
            }
            pobs.push({ x, y, image: player.image + i * 18, pob_data: rabbit_gobs });
        }
        for (const pob of this.object_pobs) {
            if (pobs.length >= NUM.POBS) break;
            pobs.push(pob);
        }
        main_info.page_info.pobs = pobs;
        main_info.page_info.num_pobs = pobs.length;

        draw_begin();
        draw_pobs();
        if (!this.options.noflies) draw_flies();
        if (this.update_palette) {
            setpalette(0, 256, this.cur_pal);
            this.update_palette = false;
        }
        draw_leftovers(main_info.draw_page);
        clear_scores();
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) if (state.player[i].enabled) show_score(i, state.player[i].bumps);
        draw_score();
        draw_end();
        this.draw_name_plates(state);
    }

    /** The original fades the palette and the music out once the end score is reached. */
    private fade_out_step(now: number) {
        if (now - this.last_scores_tick < 1000 / 60) return;
        this.last_scores_tick = now;
        let fading = false;
        for (let i = 0; i < 768; i++) {
            if (this.cur_pal[i] > 0) {
                this.cur_pal[i]--;
                fading = true;
            }
        }
        if (this.mod_vol > 0) dj_set_mod_volume(--this.mod_vol);
        setpalette(0, 256, this.cur_pal);
        this.render(this.ending_view ?? this.session!.view);
        if (!fading) this.show_scores();
    }

    private show_scores() {
        const main_info = ctx.info;
        const rabbit_gobs = get_gob('rabbit');
        dj_stop_sfx_channel(4);
        dj_stop();

        main_info.page_info.num_pobs = 0;
        for (let c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            const x = [100, 160, 220, 280];
            const y = [80, 110, 140, 170];
            add_pob(main_info.view_page, 60, y[c1] - 2, c1 * 18, rabbit_gobs);
            // crushed sprites for the columns
            add_pob(main_info.view_page, x[c1] - 5, 30, 17 + c1 * 18, rabbit_gobs);
        }
        this.object_pobs = main_info.page_info.pobs.slice(0, main_info.page_info.num_pobs);

        read_pcx('level.pcx', this.pal);
        register_background(new Uint8ClampedArray(400 * 256 * 4), this.pal);
        register_mask(new Uint8ClampedArray(400 * 256 * 4), null);
        /* fix dark font */
        for (let c1 = 0; c1 < 16; c1++) {
            this.pal[(240 + c1) * 3 + 0] = c1 << 2;
            this.pal[(240 + c1) * 3 + 1] = c1 << 2;
            this.pal[(240 + c1) * 3 + 2] = c1 << 2;
        }
        memset(this.cur_pal, 0, 768);
        setpalette(0, 256, this.cur_pal);

        this.mod_vol = 0;
        dj_ready_mod(MOD.SCORES);
        dj_set_mod_volume(0);
        dj_start_mod();
        this.set_phase('scores');
    }

    private scores_step(now: number) {
        if (now - this.last_scores_tick < 1000 / 60) return;
        this.last_scores_tick = now;

        if (!this.fading_out_scores) {
            if (this.mod_vol < 35) dj_set_mod_volume(++this.mod_vol);
            for (let c1 = 0; c1 < 768; c1++) if (this.cur_pal[c1] < this.pal[c1]) this.cur_pal[c1]++;
        } else {
            let fading = false;
            for (let c1 = 0; c1 < 768; c1++) {
                if (this.cur_pal[c1] > 0) {
                    this.cur_pal[c1]--;
                    fading = true;
                }
            }
            if (this.mod_vol > 0) dj_set_mod_volume(--this.mod_vol);
            if (!fading && this.mod_vol === 0) {
                this.options.on_exit();
                return;
            }
        }
        setpalette(0, 256, this.cur_pal);
        this.draw_final_scores();
    }

    private draw_final_scores() {
        const main_info = ctx.info;
        const state = this.session!.view;
        const names = this.result?.names ?? state.player.map((p) => (p.enabled ? '' : null));
        const shown = (i: number) => names[i] !== null && names[i] !== undefined;

        main_info.page_info.pobs = this.object_pobs.slice();
        main_info.page_info.num_pobs = this.object_pobs.length;
        draw_begin();
        draw_pobs();

        // Bunnies nobody played keep their names; the players' names are drawn over the screen below
        for (let c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            if (this.score_tags[c1]) continue;
            put_text(main_info.view_page, 100 + c1 * 60, 50, BUNNY_LABELS[c1], 2);
            put_text(main_info.view_page, 40, 80 + c1 * 30, BUNNY_LABELS[c1], 2);
        }
        for (let c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            if (!shown(c1)) continue;
            for (let c2 = 0; c2 < JNB_MAX_PLAYERS; c2++) {
                if (!shown(c2)) continue;
                const text = c2 != c1 ? state.player[c1].bumped[c2].toString() : '-';
                put_text(main_info.view_page, 100 + c2 * 60, 80 + c1 * 30, text, 2);
            }
            put_text(main_info.view_page, 350, 80 + c1 * 30, state.player[c1].bumps.toString(), 2);
        }
        put_text(main_info.view_page, 200, 230, 'Press ESC to continue', 2);
        draw_end();

        const alpha = this.brightness();
        if (!this.screen || alpha <= 0) return;
        this.screen.globalAlpha = alpha;
        for (let c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            const tag = this.score_tags[c1];
            if (!tag) continue;
            // Column heads centred like the original labels, row names right-aligned next to the bunnies;
            // put_text places the top of the capitals at y
            const width = tag.canvas.width;
            this.screen.drawImage(tag.canvas, 100 + c1 * 60 - Math.floor(width / 2), 50 - CAPS_TOP);
            this.screen.drawImage(tag.canvas, 56 - width, 80 + c1 * 30 - CAPS_TOP);
        }
        this.screen.globalAlpha = 1;
    }
}
