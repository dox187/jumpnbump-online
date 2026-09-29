/**
 * Runs one online match in a canvas: loads the level, drives the NetSession every animation frame,
 * draws the predicted state with the original renderer and finally shows the classic score screen.
 */
import { get_gob } from '../assets';
import { memset } from '../c';
import { JNB_MAX_PLAYERS, KEY, MOD, NUM, SCREEN_HEIGHT, SCREEN_WIDTH, SFX, SFX_FREQ } from '../constants';
import ctx, { resetContext } from '../context';
import { local_fx, show_score } from '../fx';
import type { GameInputDevice } from '../inputs';
import { get_ban_map } from '../level';
import { deinit_program, init_level_scene, init_program, update_objects } from '../main';
import { ClientMessage, MatchInfo, MatchResult, ServerMessage } from '../net/protocol';
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
import { addkey, intr_sysupdate, key_went_down, set_ai_hotkeys_enabled } from '../sdl/interrpt';
import {
    dj_play_sfx,
    dj_ready_mod,
    dj_set_mod_volume,
    dj_set_sfx_volume,
    dj_start_mod,
    dj_stop,
    dj_stop_sfx_channel,
} from '../sdl/sound';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, SimState } from '../sim/sim';
import type { Pob } from '../assets';
import { CAPS_TOP, TextColor, fit_text, font_ready, init_font, render_text } from '../web/pixel/font';

export type OnlineGameOptions = {
    canvas: HTMLCanvasElement;
    dat: ArrayBuffer;
    match: MatchInfo;
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

export type OnlineGamePhase = 'loading' | 'waiting' | 'playing' | 'ending' | 'scores';

const BUNNY_LABELS = ['DOTT', 'JIFFY', 'FIZZ', 'MIJJI'];
/** The level is 22 tiles wide; the score column fills the rest of the screen. */
const PLAYFIELD_WIDTH = 352;
const NAME_TAG_WIDTH = 80;
const SCORE_NAME_WIDTH = 56;

/** A player name drawn in the game font, with the rows its visible pixels occupy. */
type NameTag = { canvas: HTMLCanvasElement; top: number; bottom: number };

function name_tag(text: string, width: number, color: TextColor): NameTag {
    const canvas = render_text(fit_text(text, width), color, true);
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let top = canvas.height;
    let bottom = 0;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (!data[(y * canvas.width + x) * 4 + 3]) continue;
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    return { canvas, top: Math.min(top, bottom), bottom };
}

export class OnlineGame {
    phase: OnlineGamePhase = 'loading';
    result: MatchResult | null = null;
    on_phase: (phase: OnlineGamePhase) => void = () => {};

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
    /** Per bunny slot: the name above the bunny and the name on the score screen. */
    private name_tags: (NameTag | null)[] = [];
    private score_tags: (NameTag | null)[] = [];

    constructor(options: OnlineGameOptions) {
        this.options = options;
    }

    stats(): SessionStats | null {
        return this.session ? this.session.stats() : null;
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
        const controls = [...ctx.controls];
        controls[options.slot] = options.control;
        ctx.controls = controls;

        init_program(canvas, options.dat, this.pal);
        this.screen = canvas.getContext('2d');
        if (!font_ready()) init_font(get_gob('font'));
        this.make_name_tags(options.match.slots.map((s) => s?.name ?? null));
        set_ai_hotkeys_enabled(false);
        init_level_scene(this.pal);
        if (!options.noflies) position_flies();

        memset(this.cur_pal, 0, 768);
        setpalette(0, 256, this.cur_pal);

        window.addEventListener('blur', this.release_keys);
        document.addEventListener('visibilitychange', this.release_keys);
        this.set_phase('waiting');
    }

    handle_message(message: ServerMessage) {
        if (this.destroyed) return;
        if (message.t === 'go') {
            this.start(message.state);
            return;
        }
        if (!this.session) {
            // Confirmations can only follow 'go', but keep anything that arrives early
            this.queued.push(message);
            return;
        }
        if (message.t === 'over') {
            this.result = message.result;
            this.make_name_tags(message.result.names);
        }
        this.session.handle_message(message);
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

    private start(state: SimState) {
        const options = this.options;
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
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const name = names[i];
            const color: TextColor = i === this.options.slot ? 'gold' : 'white';
            this.name_tags[i] = name ? name_tag(name, NAME_TAG_WIDTH, color) : null;
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

    private draw_name_tags(state: SimState) {
        if (!this.screen) return;
        const alpha = this.brightness();
        if (alpha <= 0) return;
        this.screen.globalAlpha = alpha;
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const player = state.player[i];
            const tag = this.name_tags[i];
            if (!player.enabled || !tag) continue;
            const width = tag.canvas.width;
            const height = tag.bottom - tag.top + 1;
            // Centred over the bunny and kept on screen, so a bunny above the top edge can still be found
            const x = Math.max(0, Math.min(PLAYFIELD_WIDTH - width, (player.x >> 16) + 8 - (width >> 1)));
            const top = Math.max(0, (player.y >> 16) - 2 - height);
            this.screen.drawImage(tag.canvas, x, top - tag.top);
        }
        this.screen.globalAlpha = 1;
    }

    private set_phase(phase: OnlineGamePhase) {
        this.phase = phase;
        this.on_phase(phase);
    }

    private loop = (now: number) => {
        if (this.destroyed) return;
        this.frame_request = requestAnimationFrame(this.loop);
        intr_sysupdate();

        const escape_pressed = key_went_down(KEY.ESCAPE);

        if (this.phase === 'playing') {
            if (escape_pressed) this.options.on_escape();
            const session = this.session!;
            session.update(now, this.read_input());
            // Draw once per simulated frame; high refresh rate screens would otherwise redraw for nothing
            const new_frame = session.frame !== this.last_render_frame;
            if (session.dirty && (new_frame || now - this.last_render_time > 50 || session.finished)) {
                session.dirty = false;
                this.last_render_frame = session.frame;
                this.last_render_time = now;
                this.render(session.view);
            }
            if (this.session!.finished) this.set_phase('ending');
        } else if (this.phase === 'ending') {
            this.fade_out_step(now);
        } else if (this.phase === 'scores') {
            if (escape_pressed || key_went_down('Enter') || key_went_down('Space')) this.fading_out_scores = true;
            this.scores_step(now);
        }
    };

    private read_input() {
        const slot = this.options.slot;
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let mask = 0;
        if (read_device_input(slot, 0, gamepads)) mask |= INPUT_LEFT;
        if (read_device_input(slot, 1, gamepads)) mask |= INPUT_RIGHT;
        if (read_device_input(slot, 2, gamepads)) mask |= INPUT_UP;
        return mask;
    }

    private release_keys = () => {
        const control = ctx.controls[this.options.slot];
        if (control && control.type === 'keyboard') for (const key of control.mappings) addkey(key, false);
    };

    /** Advances everything cosmetic by one frame; called once for every newly simulated frame. */
    private on_new_frame = (state: SimState) => {
        const main_info = ctx.info;
        ctx.player = state.player as typeof ctx.player;

        main_info.page_info.num_pobs = 0;
        update_objects();
        this.object_pobs = main_info.page_info.pobs.slice(0, main_info.page_info.num_pobs);
        if (!this.options.noflies) update_flies(1);

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

    private render(state: SimState) {
        const main_info = ctx.info;
        const rabbit_gobs = get_gob('rabbit');
        ctx.player = state.player as typeof ctx.player;

        const pobs: Pob[] = [];
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const player = state.player[i];
            if (!player.enabled) continue;
            pobs.push({ x: player.x >> 16, y: player.y >> 16, image: player.image + i * 18, pob_data: rabbit_gobs });
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
        this.draw_name_tags(state);
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
        this.render(this.session!.view);
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

    /** Continues from the score screen, e.g. from a button in the page overlay. */
    dismiss_scores() {
        if (this.phase === 'scores') this.fading_out_scores = true;
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
