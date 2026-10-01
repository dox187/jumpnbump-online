// Changed by dox187 on 2026-09-29 and 2026-10-01 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import { object_anims, player_anims } from './animation';
import { cheats, check_cheats, reset_cheats } from './cheats';
import {
    BAN,
    JNB_MAX_PLAYERS,
    KEY,
    MOD,
    NUM,
    OBJ,
    OBJ_ANIM,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    SFX,
    SFX_FREQ,
} from './constants';
import {
    dj_deinit,
    dj_init,
    dj_load_mod,
    dj_load_sfx,
    dj_mix,
    dj_play_sfx,
    dj_ready_mod,
    dj_set_mod_volume,
    dj_set_nosound,
    dj_set_sfx_settings,
    dj_set_sfx_volume,
    dj_start_mod,
    dj_stop,
    dj_stop_mod,
    dj_stop_sfx_channel,
} from './sdl/sound';
import { update_player_actions } from './sdl/input';
import { intr_sysupdate, key_pressed } from './sdl/interrpt';
import { GET_BAN_MAP_TILE, SET_BAN_MAP, get_ban_map } from './level';
import {
    serverTellEveryoneGoodbye,
    tellServerGoodbye,
    tellServerNewPosition,
    update_players_from_clients,
    update_players_from_server,
} from './network';
import {
    add_leftovers,
    add_object,
    add_pob,
    add_score,
    draw_flies,
    draw_leftovers,
    draw_pobs,
    draw_score,
    position_flies,
    update_flies,
    init_renderer,
} from './renderer';
import { memset, rnd } from './c';
import {
    draw_begin,
    draw_end,
    fillpalette,
    gfx_init,
    put_text,
    register_background,
    register_mask,
    setpalette,
} from './sdl/gfx';
import { preread_datafile, read_gob, read_level, read_pcx } from './data';
import { menu } from './menu';
import ctx from './context';
import { run_in_frame_loop } from './loop';
import { deinit_controls_listener, init_controls_listener } from './sdl/events';
import { Pob, register_gob, get_gob } from './assets';
import { GameInputDevice } from 'inputs';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP, Sim, create_state } from './sim/sim';
import { LocalBot } from './local-bot';
import { local_fx } from './fx';

let endscore_reached = 0;

const pal = new Uint8ClampedArray(768);
const cur_pal = new Uint8ClampedArray(768);

const is_server = true;
const is_net = false;

let client_player_num = -1;
let server_said_bye = 0;

let flies_enabled = true;

const local_sim_instance = new Sim(create_state(1), get_ban_map());
const local_bots = Array.from({ length: JNB_MAX_PLAYERS }, () => new LocalBot());

/** The shared simulation, pointed at the global context of the local game. */
function local_sim() {
    local_sim_instance.state.player = ctx.player;
    local_sim_instance.map = get_ban_map();
    local_sim_instance.cheats = cheats;
    local_sim_instance.fx = local_fx;
    return local_sim_instance;
}

function collision_check() {
    local_sim().collision_check();
}

async function game_loop() {
    for (const bot of local_bots) bot.reset();
    const main_info = ctx.info;
    const player = ctx.player;
    let mod_vol, sfx_vol;
    let update_count = 1;
    let end_loop_flag = 0;
    let fade_flag = 0;
    let update_palette = 0;
    let mod_fade_direction;

    const rabbit_gobs = get_gob('rabbit');

    mod_vol = sfx_vol = 0;
    mod_fade_direction = 1;
    dj_ready_mod(MOD.GAME);
    dj_set_mod_volume(mod_vol);
    dj_set_sfx_volume(mod_vol);
    dj_start_mod();

    intr_sysupdate();

    endscore_reached = 0;
    async function inner_game_loop() {
        while (update_count) {
            if (endscore_reached || key_pressed(KEY.ESCAPE)) {
                if (is_net) {
                    if (is_server) {
                        serverTellEveryoneGoodbye();
                    } else {
                        tellServerGoodbye();
                    }
                }
                end_loop_flag = 1;
                memset(pal, 0, 768);
                mod_fade_direction = 0;
            }

            check_cheats();

            if (is_net) {
                if (is_server) {
                    update_players_from_clients();
                } else {
                    if (!update_players_from_server()) {
                        break; /* got a BYE packet */
                    }
                }
            }

            steer_players();

            dj_mix();

            collision_check();

            dj_mix();

            main_info.page_info.num_pobs = 0;
            for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
                if (player[i].enabled) main_info.page_info.num_pobs++;
            }

            update_objects();

            dj_mix();

            if (flies_enabled) {
                update_flies(update_count);
            }

            dj_mix();

            if (update_count == 1) {
                let c2;

                for (let i = 0, c2 = 0; i < JNB_MAX_PLAYERS; i++) {
                    if (player[i].enabled) {
                        if (!main_info.page_info.pobs[c2]) {
                            main_info.page_info.pobs[c2] = new Pob();
                        }
                        main_info.page_info.pobs[c2].x = player[i].x >> 16;
                        main_info.page_info.pobs[c2].y = player[i].y >> 16;
                        main_info.page_info.pobs[c2].image = player[i].image + i * 18;
                        main_info.page_info.pobs[c2].pob_data = rabbit_gobs;
                        c2++;
                    }
                }

                draw_begin();

                draw_pobs();

                dj_mix();

                if (flies_enabled) draw_flies();
            }

            if (mod_fade_direction == 1) {
                if (mod_vol < 30) {
                    mod_vol++;
                    dj_set_mod_volume(mod_vol);
                }
                if (sfx_vol < 64) {
                    sfx_vol++;
                    dj_set_sfx_volume(sfx_vol);
                }
            } else {
                if (mod_vol > 0) {
                    mod_vol--;
                    dj_set_mod_volume(mod_vol);
                }
                if (sfx_vol > 0) {
                    sfx_vol--;
                    dj_set_sfx_volume(sfx_vol);
                }
            }

            fade_flag = 0;
            for (let i = 0; i < 768; i++) {
                if (cur_pal[i] < pal[i]) {
                    cur_pal[i]++;
                    fade_flag = 1;
                } else if (cur_pal[i] > pal[i]) {
                    cur_pal[i]--;
                    fade_flag = 1;
                }
            }
            if (fade_flag == 1) update_palette = 1;
            if (fade_flag == 0 && end_loop_flag == 1) break;

            if (update_count == 1) {
                if (update_palette == 1) {
                    setpalette(0, 256, cur_pal);
                    update_palette = 0;
                }

                main_info.draw_page ^= 1;
                main_info.view_page ^= 1;

                draw_begin();

                // Do we need this?
                // if (flies_enabled)
                // redraw_flies_background(main_info.draw_page);
            }
            draw_leftovers(main_info.draw_page);
            draw_score();
            draw_end();
            update_count--;
        }

        if (is_net) {
            if (
                !player[client_player_num].dead_flag &&
                (player[client_player_num].action_left ||
                    player[client_player_num].action_right ||
                    player[client_player_num].action_up ||
                    player[client_player_num].jump_ready == 0)
            ) {
                tellServerNewPosition();
            }
        }

        update_count = intr_sysupdate();

        if (is_net) {
            if (server_said_bye || (fade_flag == 0 && end_loop_flag == 1)) return 0;
        } else {
            if (fade_flag == 0 && end_loop_flag == 1) return 0;
        }
        return -1;
    }

    await run_in_frame_loop(inner_game_loop);

    return 0;
}

function game_stopped() {
    return ctx.state === 'stopped';
}

async function menu_loop() {
    const player = ctx.player;
    let mod_vol;
    let c1, c2;
    const main_info = ctx.info;

    for (
        c1 = 0;
        c1 < JNB_MAX_PLAYERS;
        c1++ // reset player values
    ) {
        ctx.ai[c1] = 0;
    }

    while (1) {
        const rabbit_gobs = get_gob('rabbit');

        if (!is_net) {
            if ((await menu()) != 0) {
                deinit_program();
                break;
            }
        }
        // The page stopped the game (the player left it); every frame loop now returns at once
        if (game_stopped()) return 0;
        if (key_pressed(KEY.ESCAPE)) {
            return 0;
        }
        if ((await init_level(0, pal)) != 0) {
            deinit_level();
            deinit_program();
        }

        memset(cur_pal, 0, 768);
        setpalette(0, 256, cur_pal);

        if (flies_enabled) {
            position_flies();
        }

        if (flies_enabled) {
            dj_play_sfx(SFX.FLY, SFX_FREQ.FLY, 0, 0, 0, 4);
        }

        dj_set_nosound(0);

        main_info.page_info.num_pobs = 0;
        main_info.page_info.num_pobs = 0;

        await game_loop();
        if (game_stopped()) {
            dj_stop_sfx_channel(4);
            deinit_level();
            return 0;
        }

        if (is_net) {
            if (is_server) {
                serverTellEveryoneGoodbye();
            } else {
                if (!server_said_bye) {
                    tellServerGoodbye();
                }
            }
        }

        dj_stop_sfx_channel(4);

        deinit_level();

        main_info.page_info.num_pobs = 0;

        for (c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            const x = [100, 160, 220, 280];
            const y = [80, 110, 140, 170];

            add_pob(main_info.view_page, 60, y[c1] - 2, c1 * 18, rabbit_gobs);
            // crushed sprites for the columns
            add_pob(main_info.view_page, x[c1] - 5, 30, 17 + c1 * 18, rabbit_gobs);
        }

        read_pcx('level.pcx', pal);
        register_background(new Uint8ClampedArray(400 * 256 * 4), pal);
        register_mask(new Uint8ClampedArray(400 * 256 * 4), null);

        function draw_final_scores() {
            draw_begin();

            draw_pobs();

            put_text(main_info.view_page, 100, 50, 'DOTT', 2);
            put_text(main_info.view_page, 160, 50, 'JIFFY', 2);
            put_text(main_info.view_page, 220, 50, 'FIZZ', 2);
            put_text(main_info.view_page, 280, 50, 'MIJJI', 2);
            put_text(main_info.view_page, 40, 80, 'DOTT', 2);
            put_text(main_info.view_page, 40, 110, 'JIFFY', 2);
            put_text(main_info.view_page, 40, 140, 'FIZZ', 2);
            put_text(main_info.view_page, 40, 170, 'MIJJI', 2);

            for (c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
                if (!player[c1].enabled) {
                    continue;
                }

                for (c2 = 0; c2 < JNB_MAX_PLAYERS; c2++) {
                    if (!player[c2].enabled) {
                        continue;
                    }
                    if (c2 != c1) {
                        const bumped = player[c1].bumped[c2];
                        put_text(main_info.view_page, 100 + c2 * 60, 80 + c1 * 30, bumped.toString(), 2);
                    } else {
                        put_text(main_info.view_page, 100 + c2 * 60, 80 + c1 * 30, '-', 2);
                    }
                }
                const bumps = player[c1].bumps;
                put_text(main_info.view_page, 350, 80 + c1 * 30, bumps.toString(), 2);
            }

            put_text(main_info.view_page, 200, 230, 'Press ESC to continue', 2);

            draw_end();
        }

        // loads menu into memory again

        /* fix dark font */
        for (c1 = 0; c1 < 16; c1++) {
            pal[(240 + c1) * 3 + 0] = c1 << 2;
            pal[(240 + c1) * 3 + 1] = c1 << 2;
            pal[(240 + c1) * 3 + 2] = c1 << 2;
        }

        memset(cur_pal, 0, 768);
        setpalette(0, 256, cur_pal);

        mod_vol = 0;
        dj_ready_mod(MOD.SCORES);
        dj_set_mod_volume(mod_vol);
        dj_start_mod();
        dj_set_nosound(0);

        let has_escape_been_pressed = false;

        async function scores_loop() {
            if (!has_escape_been_pressed) {
                has_escape_been_pressed = key_pressed(KEY.ESCAPE);
            }

            if (!has_escape_been_pressed) {
                if (mod_vol < 35) mod_vol++;
                dj_set_mod_volume(mod_vol);
                for (c1 = 0; c1 < 768; c1++) {
                    if (cur_pal[c1] < pal[c1]) cur_pal[c1]++;
                }
                dj_mix();
                intr_sysupdate();
                setpalette(0, 256, cur_pal);
                draw_final_scores();
                return -1;
            }

            memset(pal, 0, 768);

            if (mod_vol > 0) {
                draw_final_scores();
                mod_vol--;
                dj_set_mod_volume(mod_vol);
                for (c1 = 0; c1 < 768; c1++) {
                    if (cur_pal[c1] > pal[c1]) cur_pal[c1]--;
                }
                dj_mix();
                setpalette(0, 256, cur_pal);
                return -1;
            }

            return 0;
        }

        await run_in_frame_loop(scores_loop);

        fillpalette(0, 0, 0);
        draw_final_scores();

        dj_set_nosound(1);
        dj_stop_mod();

        if (is_net) return 0; /* don't go back to menu if in net game. */
    }
}

export type MainOptions = {
    dat: ArrayBuffer;
    nosound?: boolean;
    musicnosound?: boolean;
    nomusic?: boolean;
    nogore?: boolean;
    noflies?: boolean;
    controls?: GameInputDevice[];
};

export async function main(canvas: HTMLCanvasElement, options: MainOptions): Promise<number> {
    const main_info = ctx.info;
    main_info.no_gore = options.nogore || false;
    main_info.no_sound = options.nosound || false;
    main_info.music_no_sound = options.musicnosound || false;
    main_info.no_music = options.nomusic || false;

    if (options.controls && options.controls.length === JNB_MAX_PLAYERS) {
        // Override default controls
        ctx.controls = options.controls;
    }

    flies_enabled = options.noflies ? false : true;

    if ((await init_program(canvas, options.dat, pal)) != 0) {
        deinit_program();
        return;
    }

    let result = await menu_loop();

    deinit_program();

    return result;
}

function cpu_move() {
    const map = get_ban_map();
    const masks = local_bots.map((bot, slot) => {
        if (ctx.ai[slot]) return bot.input(ctx.player, slot, map, cheats);
        bot.reset();
        return null;
    });
    for (let slot = 0; slot < JNB_MAX_PLAYERS; slot++) {
        const mask = masks[slot];
        if (mask === null) continue;
        const player = ctx.player[slot];
        player.action_left = (mask & INPUT_LEFT) !== 0;
        player.action_right = (mask & INPUT_RIGHT) !== 0;
        player.action_up = (mask & INPUT_UP) !== 0;
    }
}

function steer_players() {
    update_player_actions();
    cpu_move();
    local_sim().steer_players();
}

export function update_objects() {
    const main_info = ctx.info;
    const objects = ctx.objects;
    const object_gobs = get_gob('objects');
    let s1 = 0;

    for (let c1 = 0; c1 < NUM.OBJECTS; c1++) {
        if (objects[c1].used == 1) {
            switch (objects[c1].type) {
                case OBJ.SPRING:
                    objects[c1].ticks--;
                    if (objects[c1].ticks <= 0) {
                        objects[c1].frame++;
                        if (objects[c1].frame >= object_anims[objects[c1].anim].num_frames) {
                            objects[c1].frame--;
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                        } else {
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].image,
                            object_gobs
                        );
                    break;
                case OBJ.SPLASH:
                    objects[c1].ticks--;
                    if (objects[c1].ticks <= 0) {
                        objects[c1].frame++;
                        if (objects[c1].frame >= object_anims[objects[c1].anim].num_frames) objects[c1].used = 0;
                        else {
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].image,
                            object_gobs
                        );
                    break;
                case OBJ.SMOKE:
                    objects[c1].x += objects[c1].x_add;
                    objects[c1].y += objects[c1].y_add;
                    objects[c1].ticks--;
                    if (objects[c1].ticks <= 0) {
                        objects[c1].frame++;
                        if (objects[c1].frame >= object_anims[objects[c1].anim].num_frames) objects[c1].used = 0;
                        else {
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].image,
                            object_gobs
                        );
                    break;
                case OBJ.YEL_BUTFLY:
                case OBJ.PINK_BUTFLY:
                    objects[c1].x_acc += rnd(128) - 64;
                    if (objects[c1].x_acc < -1024) objects[c1].x_acc = -1024;
                    if (objects[c1].x_acc > 1024) objects[c1].x_acc = 1024;
                    objects[c1].x_add += objects[c1].x_acc;
                    if (objects[c1].x_add < -32768) objects[c1].x_add = -32768;
                    if (objects[c1].x_add > 32768) objects[c1].x_add = 32768;
                    objects[c1].x += objects[c1].x_add;
                    if (objects[c1].x >> 16 < 16) {
                        objects[c1].x = 16 << 16;
                        objects[c1].x_add = -objects[c1].x_add >> 2;
                        objects[c1].x_acc = 0;
                    } else if (objects[c1].x >> 16 > 350) {
                        objects[c1].x = 350 << 16;
                        objects[c1].x_add = -objects[c1].x_add >> 2;
                        objects[c1].x_acc = 0;
                    }
                    if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 0) {
                        if (objects[c1].x_add < 0) {
                            objects[c1].x = (((objects[c1].x >> 16) + 16) & 0xfff0) << 16;
                        } else {
                            objects[c1].x = ((((objects[c1].x >> 16) - 16) & 0xfff0) + 15) << 16;
                        }
                        objects[c1].x_add = -objects[c1].x_add >> 2;
                        objects[c1].x_acc = 0;
                    }
                    objects[c1].y_acc += rnd(64) - 32;
                    if (objects[c1].y_acc < -1024) objects[c1].y_acc = -1024;
                    if (objects[c1].y_acc > 1024) objects[c1].y_acc = 1024;
                    objects[c1].y_add += objects[c1].y_acc;
                    if (objects[c1].y_add < -32768) objects[c1].y_add = -32768;
                    if (objects[c1].y_add > 32768) objects[c1].y_add = 32768;
                    objects[c1].y += objects[c1].y_add;
                    if (objects[c1].y >> 16 < 0) {
                        objects[c1].y = 0;
                        objects[c1].y_add = -objects[c1].y_add >> 2;
                        objects[c1].y_acc = 0;
                    } else if (objects[c1].y >> 16 > 255) {
                        objects[c1].y = 255 << 16;
                        objects[c1].y_add = -objects[c1].y_add >> 2;
                        objects[c1].y_acc = 0;
                    }
                    if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 0) {
                        if (objects[c1].y_add < 0) {
                            objects[c1].y = (((objects[c1].y >> 16) + 16) & 0xfff0) << 16;
                        } else {
                            objects[c1].y = ((((objects[c1].y >> 16) - 16) & 0xfff0) + 15) << 16;
                        }
                        objects[c1].y_add = -objects[c1].y_add >> 2;
                        objects[c1].y_acc = 0;
                    }
                    if (objects[c1].type == OBJ.YEL_BUTFLY) {
                        if (objects[c1].x_add < 0 && objects[c1].anim != OBJ_ANIM.YEL_BUTFLY_LEFT) {
                            objects[c1].anim = OBJ_ANIM.YEL_BUTFLY_LEFT;
                            objects[c1].frame = 0;
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        } else if (objects[c1].x_add > 0 && objects[c1].anim != OBJ_ANIM.YEL_BUTFLY_RIGHT) {
                            objects[c1].anim = OBJ_ANIM.YEL_BUTFLY_RIGHT;
                            objects[c1].frame = 0;
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    } else {
                        if (objects[c1].x_add < 0 && objects[c1].anim != OBJ_ANIM.PINK_BUTFLY_LEFT) {
                            objects[c1].anim = OBJ_ANIM.PINK_BUTFLY_LEFT;
                            objects[c1].frame = 0;
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        } else if (objects[c1].x_add > 0 && objects[c1].anim != OBJ_ANIM.PINK_BUTFLY_RIGHT) {
                            objects[c1].anim = OBJ_ANIM.PINK_BUTFLY_RIGHT;
                            objects[c1].frame = 0;
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    objects[c1].ticks--;
                    if (objects[c1].ticks <= 0) {
                        objects[c1].frame++;
                        if (objects[c1].frame >= object_anims[objects[c1].anim].num_frames)
                            objects[c1].frame = object_anims[objects[c1].anim].restart_frame;
                        else {
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].image,
                            object_gobs
                        );
                    break;
                case OBJ.FUR:
                    if (rnd(100) < 30)
                        add_object(
                            OBJ.FLESH_TRACE,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            0,
                            0,
                            OBJ_ANIM.FLESH_TRACE,
                            0
                        );
                    if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 0) {
                        objects[c1].y_add += 3072;
                        if (objects[c1].y_add > 196608) objects[c1].y_add = 196608;
                    } else if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 2) {
                        if (objects[c1].x_add < 0) {
                            if (objects[c1].x_add < -65536) objects[c1].x_add = -65536;
                            objects[c1].x_add += 1024;
                            if (objects[c1].x_add > 0) objects[c1].x_add = 0;
                        } else {
                            if (objects[c1].x_add > 65536) objects[c1].x_add = 65536;
                            objects[c1].x_add -= 1024;
                            if (objects[c1].x_add < 0) objects[c1].x_add = 0;
                        }
                        objects[c1].y_add += 1024;
                        if (objects[c1].y_add < -65536) objects[c1].y_add = -65536;
                        if (objects[c1].y_add > 65536) objects[c1].y_add = 65536;
                    }
                    objects[c1].x += objects[c1].x_add;
                    if (
                        objects[c1].y >> 16 > 0 &&
                        (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 1 ||
                            GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 3)
                    ) {
                        if (objects[c1].x_add < 0) {
                            objects[c1].x = (((objects[c1].x >> 16) + 16) & 0xfff0) << 16;
                            objects[c1].x_add = -objects[c1].x_add >> 2;
                        } else {
                            objects[c1].x = ((((objects[c1].x >> 16) - 16) & 0xfff0) + 15) << 16;
                            objects[c1].x_add = -objects[c1].x_add >> 2;
                        }
                    }
                    objects[c1].y += objects[c1].y_add;
                    if (objects[c1].x >> 16 < -5 || objects[c1].x >> 16 > 405 || objects[c1].y >> 16 > 260)
                        objects[c1].used = 0;
                    if (objects[c1].y >> 16 > 0 && GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 0) {
                        if (objects[c1].y_add < 0) {
                            if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 2) {
                                objects[c1].y = (((objects[c1].y >> 16) + 16) & 0xfff0) << 16;
                                objects[c1].x_add >>= 2;
                                objects[c1].y_add = -objects[c1].y_add >> 2;
                            }
                        } else {
                            if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 1) {
                                if (objects[c1].y_add > 131072) {
                                    objects[c1].y = ((((objects[c1].y >> 16) - 16) & 0xfff0) + 15) << 16;
                                    objects[c1].x_add >>= 2;
                                    objects[c1].y_add = -objects[c1].y_add >> 2;
                                } else objects[c1].used = 0;
                            } else if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 3) {
                                objects[c1].y = ((((objects[c1].y >> 16) - 16) & 0xfff0) + 15) << 16;
                                if (objects[c1].y_add > 131072) objects[c1].y_add = -objects[c1].y_add >> 2;
                                else objects[c1].y_add = 0;
                            }
                        }
                    }
                    if (objects[c1].x_add < 0 && objects[c1].x_add > -16384) objects[c1].x_add = -16384;
                    if (objects[c1].x_add > 0 && objects[c1].x_add < 16384) objects[c1].x_add = 16384;
                    if (objects[c1].used == 1) {
                        s1 = Math.floor((Math.atan2(objects[c1].y_add, objects[c1].x_add) * 4) / Math.PI);
                        if (s1 < 0) s1 = s1 + 8;
                        if (s1 < 0) s1 = 0;
                        if (s1 > 7) s1 = 7;

                        if (!Number.isInteger(objects[c1].frame + s1)) {
                            throw new Error('Invalid image: ' + objects[c1].frame + ' + ' + s1);
                        }
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].frame + s1,
                            object_gobs
                        );
                    }
                    break;
                case OBJ.FLESH:
                    if (rnd(100) < 30) {
                        if (objects[c1].frame == 76)
                            add_object(
                                OBJ.FLESH_TRACE,
                                objects[c1].x >> 16,
                                objects[c1].y >> 16,
                                0,
                                0,
                                OBJ_ANIM.FLESH_TRACE,
                                1
                            );
                        else if (objects[c1].frame == 77)
                            add_object(
                                OBJ.FLESH_TRACE,
                                objects[c1].x >> 16,
                                objects[c1].y >> 16,
                                0,
                                0,
                                OBJ_ANIM.FLESH_TRACE,
                                2
                            );
                        else if (objects[c1].frame == 78)
                            add_object(
                                OBJ.FLESH_TRACE,
                                objects[c1].x >> 16,
                                objects[c1].y >> 16,
                                0,
                                0,
                                OBJ_ANIM.FLESH_TRACE,
                                3
                            );
                    }
                    if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 0) {
                        objects[c1].y_add += 3072;
                        if (objects[c1].y_add > 196608) objects[c1].y_add = 196608;
                    } else if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 2) {
                        if (objects[c1].x_add < 0) {
                            if (objects[c1].x_add < -65536) objects[c1].x_add = -65536;
                            objects[c1].x_add += 1024;
                            if (objects[c1].x_add > 0) objects[c1].x_add = 0;
                        } else {
                            if (objects[c1].x_add > 65536) objects[c1].x_add = 65536;
                            objects[c1].x_add -= 1024;
                            if (objects[c1].x_add < 0) objects[c1].x_add = 0;
                        }
                        objects[c1].y_add += 1024;
                        if (objects[c1].y_add < -65536) objects[c1].y_add = -65536;
                        if (objects[c1].y_add > 65536) objects[c1].y_add = 65536;
                    }
                    objects[c1].x += objects[c1].x_add;
                    if (
                        objects[c1].y >> 16 > 0 &&
                        (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 1 ||
                            GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 3)
                    ) {
                        if (objects[c1].x_add < 0) {
                            objects[c1].x = (((objects[c1].x >> 16) + 16) & 0xfff0) << 16;
                            objects[c1].x_add = -objects[c1].x_add >> 2;
                        } else {
                            objects[c1].x = ((((objects[c1].x >> 16) - 16) & 0xfff0) + 15) << 16;
                            objects[c1].x_add = -objects[c1].x_add >> 2;
                        }
                    }
                    objects[c1].y += objects[c1].y_add;
                    if (objects[c1].x >> 16 < -5 || objects[c1].x >> 16 > 405 || objects[c1].y >> 16 > 260)
                        objects[c1].used = 0;
                    if (objects[c1].y >> 16 > 0 && GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 0) {
                        if (objects[c1].y_add < 0) {
                            if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) != 2) {
                                objects[c1].y = (((objects[c1].y >> 16) + 16) & 0xfff0) << 16;
                                objects[c1].x_add >>= 2;
                                objects[c1].y_add = -objects[c1].y_add >> 2;
                            }
                        } else {
                            if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 1) {
                                if (objects[c1].y_add > 131072) {
                                    objects[c1].y = ((((objects[c1].y >> 16) - 16) & 0xfff0) + 15) << 16;
                                    objects[c1].x_add >>= 2;
                                    objects[c1].y_add = -objects[c1].y_add >> 2;
                                } else {
                                    if (rnd(100) < 10) {
                                        s1 = rnd(4) - 2;
                                        add_leftovers(
                                            0,
                                            objects[c1].x >> 16,
                                            (objects[c1].y >> 16) + s1,
                                            objects[c1].frame,
                                            object_gobs
                                        );
                                    }
                                    objects[c1].used = 0;
                                }
                            } else if (GET_BAN_MAP_TILE(objects[c1].y >> 20, objects[c1].x >> 20) == 3) {
                                objects[c1].y = ((((objects[c1].y >> 16) - 16) & 0xfff0) + 15) << 16;
                                if (objects[c1].y_add > 131072) objects[c1].y_add = -objects[c1].y_add >> 2;
                                else objects[c1].y_add = 0;
                            }
                        }
                    }
                    if (objects[c1].x_add < 0 && objects[c1].x_add > -16384) objects[c1].x_add = -16384;
                    if (objects[c1].x_add > 0 && objects[c1].x_add < 16384) objects[c1].x_add = 16384;
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].frame,
                            object_gobs
                        );
                    break;
                case OBJ.FLESH_TRACE:
                    objects[c1].ticks--;
                    if (objects[c1].ticks <= 0) {
                        objects[c1].frame++;
                        if (objects[c1].frame >= object_anims[objects[c1].anim].num_frames) objects[c1].used = 0;
                        else {
                            objects[c1].ticks = object_anims[objects[c1].anim].frame[objects[c1].frame].ticks;
                            objects[c1].image = object_anims[objects[c1].anim].frame[objects[c1].frame].image;
                        }
                    }
                    if (objects[c1].used == 1)
                        add_pob(
                            main_info.draw_page,
                            objects[c1].x >> 16,
                            objects[c1].y >> 16,
                            objects[c1].image,
                            object_gobs
                        );
                    break;
            }
        }
    }
}

async function init_level(level: number, pal: Uint8ClampedArray): Promise<number> {
    init_level_scene(pal);

    local_sim().state.rng = Math.floor(Math.random() * 0xffffffff) >>> 0 || 1;
    local_sim().init_players();

    return 0;
}

/** Loads the level graphics and places the springs and butterflies (everything but the players). */
export function init_level_scene(pal: Uint8ClampedArray) {
    const objects = ctx.objects;
    let c1, c2;
    let s1, s2;

    let background_pic = read_pcx('level.pcx', pal);
    let mask_pic = read_pcx('mask.pcx', null);

    register_background(background_pic, pal);
    register_mask(mask_pic, pal);

    for (c1 = 0; c1 < NUM.OBJECTS; c1++) objects[c1].used = 0;

    for (c1 = 0; c1 < 16; c1++) {
        for (c2 = 0; c2 < 22; c2++) {
            if (GET_BAN_MAP_TILE(c1, c2) == BAN.SPRING) {
                add_object(OBJ.SPRING, c2 << 4, c1 << 4, 0, 0, OBJ_ANIM.SPRING, 5);
            }
        }
    }

    while (1) {
        s1 = rnd(22);
        s2 = rnd(16);
        if (GET_BAN_MAP_TILE(s2, s1) == BAN.VOID) {
            add_object(
                OBJ.YEL_BUTFLY,
                (s1 << 4) + 8,
                (s2 << 4) + 8,
                (rnd(65535) - 32768) * 2,
                (rnd(65535) - 32768) * 2,
                0,
                0
            );
            break;
        }
    }
    while (1) {
        s1 = rnd(22);
        s2 = rnd(16);
        if (GET_BAN_MAP_TILE(s2, s1) == BAN.VOID) {
            add_object(
                OBJ.YEL_BUTFLY,
                (s1 << 4) + 8,
                (s2 << 4) + 8,
                (rnd(65535) - 32768) * 2,
                (rnd(65535) - 32768) * 2,
                0,
                0
            );
            break;
        }
    }
    while (1) {
        s1 = rnd(22);
        s2 = rnd(16);
        if (GET_BAN_MAP_TILE(s2, s1) == BAN.VOID) {
            add_object(
                OBJ.PINK_BUTFLY,
                (s1 << 4) + 8,
                (s2 << 4) + 8,
                (rnd(65535) - 32768) * 2,
                (rnd(65535) - 32768) * 2,
                0,
                0
            );
            break;
        }
    }
    while (1) {
        s1 = rnd(22);
        s2 = rnd(16);
        if (GET_BAN_MAP_TILE(s2, s1) == BAN.VOID) {
            add_object(
                OBJ.PINK_BUTFLY,
                (s1 << 4) + 8,
                (s2 << 4) + 8,
                (rnd(65535) - 32768) * 2,
                (rnd(65535) - 32768) * 2,
                0,
                0
            );
            break;
        }
    }
}

function deinit_level() {
    dj_set_nosound(1);
    dj_stop_mod();
}

export function init_program(canvas: HTMLCanvasElement, datafile: ArrayBuffer, pal: Uint8ClampedArray) {
    const player = ctx.player;
    const main_info = ctx.info;
    let c1 = 0;

    gfx_init(canvas);
    init_renderer();

    // TODO set flags here?

    /** It should not be necessary to assign a default player number here. The
	server assigns one in init_server, the client gets one assigned by the server,
	all provided the user didn't choose one on the commandline. */
    if (is_net) {
        if (client_player_num < 0) client_player_num = 0;
        player[client_player_num].enabled = true;
    }

    preread_datafile(datafile);
    read_pcx('menu.pcx', pal);

    // Load Gobs
    register_gob(read_gob('rabbit.gob'));
    register_gob(read_gob('objects.gob'));
    register_gob(read_gob('font.gob'));
    register_gob(read_gob('numbers.gob'));

    SET_BAN_MAP(read_level());

    dj_init();

    // Load audio even when muted: the in-game switches can enable it without restarting the level.
    {
        dj_load_mod('jump.mod', MOD.MENU);
        dj_load_mod('bump.mod', MOD.GAME);
        dj_load_mod('scores.mod', MOD.SCORES);

        dj_load_sfx('death.smp', SFX.DEATH);
        dj_load_sfx('fly.smp', SFX.FLY);
        dj_load_sfx('jump.smp', SFX.JUMP);
        dj_load_sfx('spring.smp', SFX.SPRING);
        dj_load_sfx('splash.smp', SFX.SPLASH);

        dj_set_sfx_settings(SFX.FLY, {
            loop: true,
            default_freq: SFX_FREQ.FLY,
        });
    }

    /* fix dark font */
    for (c1 = 0; c1 < 16; c1++) {
        pal[(240 + c1) * 3 + 0] = c1 << 2;
        pal[(240 + c1) * 3 + 1] = c1 << 2;
        pal[(240 + c1) * 3 + 2] = c1 << 2;
    }

    setpalette(0, 256, pal);

    // if (is_net) {
    // 	if (is_server) {
    // 		init_server(netarg);
    // 	} else {
    // 		connect_to_server(netarg);
    // 	}
    // }

    reset_cheats();
    init_controls_listener();

    return 0;
}

export function deinit_program() {
    dj_stop();
    dj_deinit();
    deinit_controls_listener();
}
