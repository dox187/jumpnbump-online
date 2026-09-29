/**
 * Deterministic game simulation shared by the local game, the online client and the online server.
 *
 * The code below is a straight transplant of the player physics from main.ts / network.ts (which in turn
 * are line-by-line ports of the SDL C sources). The only changes are:
 *  - state is passed in explicitly instead of living in the global context,
 *  - the gameplay random number generator (respawn positions) is seeded and part of the state,
 *  - cosmetic side effects (smoke, gore, sounds, spring animation, score sprites) go through `fx`,
 *    which is null while re-simulating frames, so re-simulation never touches the cosmetic RNG.
 */
import { object_anims, player_anims } from '../animation';
import { BAN, JNB_MAX_PLAYERS, NUM, OBJ, OBJ_ANIM, SFX, SFX_FREQ } from '../constants';
import type { BanMap } from './ban-map';

export type SimPlayer = {
    action_left: boolean;
    action_up: boolean;
    action_right: boolean;
    enabled: boolean;
    dead_flag: boolean;
    bumps: number;
    bumped: number[];
    x: number;
    y: number;
    x_add: number;
    y_add: number;
    direction: number;
    jump_ready: number;
    jump_abort: number;
    in_water: number;
    anim: number;
    frame: number;
    frame_tick: number;
    image: number;
};

export type SimState = {
    frame: number;
    rng: number;
    player: SimPlayer[];
    endscore_reached: boolean;
};

export type SimCheats = {
    pogostick: boolean;
    bunnies_in_space: boolean;
    jetpack: boolean;
    blood_is_thicker_than_water: boolean;
};

export const NO_CHEATS: SimCheats = Object.freeze({
    pogostick: false,
    bunnies_in_space: false,
    jetpack: false,
    blood_is_thicker_than_water: false,
});

type FxObject = {
    used: number;
    type: number;
    x: number;
    y: number;
    anim: number;
    frame: number;
    ticks: number;
    image: number;
};

/** Cosmetic side effects. Nothing in here may influence the simulation state. */
export type SimFx = {
    objects: FxObject[];
    no_gore: boolean;
    rnd: (max: number) => number;
    add_object: (type: number, x: number, y: number, x_add: number, y_add: number, anim: number, frame: number) => void;
    dj_play_sfx: (
        sfx_num: number,
        freq: number,
        volume: number,
        panning: number,
        delay: number,
        channel: number
    ) => void;
    add_score: (player_num: number, bumps: number) => void;
    /** Lets rollback suppress the gore and death sound of a kill that was already shown once. */
    allow_kill_fx?: (state: SimState, killer: number, victim: number) => boolean;
};

const MAX_SPAWN_ATTEMPTS = 10000;

export const INPUT_LEFT = 1;
export const INPUT_RIGHT = 2;
export const INPUT_UP = 4;
export const INPUT_BITS = 3;
export const INPUT_MASK = (1 << INPUT_BITS) - 1;

export function create_player(): SimPlayer {
    return {
        action_left: false,
        action_up: false,
        action_right: false,
        enabled: false,
        dead_flag: false,
        bumps: 0,
        bumped: new Array(JNB_MAX_PLAYERS).fill(0),
        x: 0,
        y: 0,
        x_add: 0,
        y_add: 0,
        direction: 0,
        jump_ready: 0,
        jump_abort: 0,
        in_water: 0,
        anim: 0,
        frame: 0,
        frame_tick: 0,
        image: 0,
    };
}

export function create_state(seed: number): SimState {
    const player: SimPlayer[] = [];
    for (let i = 0; i < JNB_MAX_PLAYERS; i++) player.push(create_player());
    return { frame: 0, rng: seed >>> 0 || 1, player, endscore_reached: false };
}

export function clone_state(state: SimState): SimState {
    return {
        frame: state.frame,
        rng: state.rng,
        endscore_reached: state.endscore_reached,
        player: state.player.map((p) => ({ ...p, bumped: p.bumped.slice() })),
    };
}

export function copy_state(target: SimState, source: SimState) {
    target.frame = source.frame;
    target.rng = source.rng;
    target.endscore_reached = source.endscore_reached;
    for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
        const bumped = target.player[i].bumped;
        Object.assign(target.player[i], source.player[i]);
        for (let j = 0; j < JNB_MAX_PLAYERS; j++) bumped[j] = source.player[i].bumped[j];
        target.player[i].bumped = bumped;
    }
}

const PLAYER_HASH_FIELDS: (keyof SimPlayer)[] = [
    'action_left',
    'action_up',
    'action_right',
    'enabled',
    'dead_flag',
    'bumps',
    'x',
    'y',
    'x_add',
    'y_add',
    'direction',
    'jump_ready',
    'jump_abort',
    'in_water',
    'anim',
    'frame',
    'frame_tick',
    'image',
];

/** FNV-1a over everything that influences future frames. Used to detect desyncs. */
export function hash_state(state: SimState): number {
    let h = 0x811c9dc5;
    const mix = (value: number) => {
        h ^= value | 0;
        h = Math.imul(h, 0x01000193);
    };
    mix(state.frame);
    mix(state.rng);
    mix(state.endscore_reached ? 1 : 0);
    for (const p of state.player) {
        for (const field of PLAYER_HASH_FIELDS) {
            const value = p[field] as number | boolean;
            mix(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }
        for (const b of p.bumped) mix(b);
    }
    return h >>> 0;
}

export function pack_inputs(masks: number[]): number {
    let packed = 0;
    for (let i = 0; i < JNB_MAX_PLAYERS; i++) packed |= (masks[i] & INPUT_MASK) << (i * INPUT_BITS);
    return packed;
}

export function unpack_input(packed: number, player_num: number): number {
    return (packed >> (player_num * INPUT_BITS)) & INPUT_MASK;
}

export class Sim {
    state: SimState;
    map: BanMap;
    cheats: SimCheats;
    fx: SimFx | null;
    /** 0 means the game never ends by score. */
    end_score: number;
    /** Diagnostics: how often position_player had to give up on the original random search. */
    spawn_fallbacks = 0;

    constructor(state: SimState, map: BanMap, cheats: SimCheats = NO_CHEATS, end_score = 0) {
        this.state = state;
        this.map = map;
        this.cheats = cheats;
        this.fx = null;
        this.end_score = end_score;
    }

    /** xorshift32; only used for respawn positions so every peer picks the same spot. */
    rnd(max_value: number) {
        let x = this.state.rng;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state.rng = x >>> 0;
        return this.state.rng % max_value;
    }

    /** Sets the action flags of every player from a packed input word. */
    apply_inputs(packed: number) {
        const player = this.state.player;
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) {
            const mask = unpack_input(packed, i);
            player[i].action_left = (mask & INPUT_LEFT) != 0;
            player[i].action_right = (mask & INPUT_RIGHT) != 0;
            player[i].action_up = (mask & INPUT_UP) != 0;
        }
    }

    /** One 60 Hz game tick for networked play: inputs, movement, collisions. */
    step(packed_inputs: number) {
        this.apply_inputs(packed_inputs);
        this.steer_players();
        this.collision_check();
        this.state.frame++;
    }

    /** Spawns every enabled player and resets the scores, as init_level does. */
    init_players() {
        const player = this.state.player;
        for (let c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            if (player[c1].enabled) {
                player[c1].bumps = 0;
                for (let c2 = 0; c2 < JNB_MAX_PLAYERS; c2++) player[c1].bumped[c2] = 0;
                this.position_player(c1);
                if (this.fx) this.fx.add_score(c1, 0);
            }
        }
    }

    player_kill(c1: number, c2: number) {
        const player = this.state.player;
        if (player[c1].y_add >= 0) {
            this.process_kill(c1, c2, player[c2].x, player[c2].y);
        } else {
            if (player[c2].y_add < 0) player[c2].y_add = 0;
        }
    }

    process_kill(c1: number, c2: number, x: number, y: number) {
        const player = this.state.player;
        let fx = this.fx;
        let c4 = 0;

        player[c1].y_add = -player[c1].y_add;
        if (player[c1].y_add > -262144) player[c1].y_add = -262144;
        player[c1].jump_abort = 1;
        player[c2].dead_flag = true;
        if (player[c2].anim != 6) {
            if (fx && fx.allow_kill_fx && !fx.allow_kill_fx(this.state, c1, c2)) fx = null;
            player[c2].anim = 6;
            player[c2].frame = 0;
            player[c2].frame_tick = 0;
            player[c2].image = player_anims[player[c2].anim].frame[player[c2].frame].image + player[c2].direction * 9;
            if (fx && !fx.no_gore) {
                const rnd = fx.rnd;
                for (c4 = 0; c4 < 6; c4++)
                    fx.add_object(
                        OBJ.FUR,
                        (x >> 16) + 6 + rnd(5),
                        (y >> 16) + 6 + rnd(5),
                        (rnd(65535) - 32768) * 3,
                        (rnd(65535) - 32768) * 3,
                        0,
                        44 + c2 * 8
                    );
                for (c4 = 0; c4 < 6; c4++)
                    fx.add_object(
                        OBJ.FLESH,
                        (x >> 16) + 6 + rnd(5),
                        (y >> 16) + 6 + rnd(5),
                        (rnd(65535) - 32768) * 3,
                        (rnd(65535) - 32768) * 3,
                        0,
                        76
                    );
                for (c4 = 0; c4 < 6; c4++)
                    fx.add_object(
                        OBJ.FLESH,
                        (x >> 16) + 6 + rnd(5),
                        (y >> 16) + 6 + rnd(5),
                        (rnd(65535) - 32768) * 3,
                        (rnd(65535) - 32768) * 3,
                        0,
                        77
                    );
                for (c4 = 0; c4 < 8; c4++)
                    fx.add_object(
                        OBJ.FLESH,
                        (x >> 16) + 6 + rnd(5),
                        (y >> 16) + 6 + rnd(5),
                        (rnd(65535) - 32768) * 3,
                        (rnd(65535) - 32768) * 3,
                        0,
                        78
                    );
                for (c4 = 0; c4 < 10; c4++)
                    fx.add_object(
                        OBJ.FLESH,
                        (x >> 16) + 6 + rnd(5),
                        (y >> 16) + 6 + rnd(5),
                        (rnd(65535) - 32768) * 3,
                        (rnd(65535) - 32768) * 3,
                        0,
                        79
                    );
            }
            if (fx) fx.dj_play_sfx(SFX.DEATH, to_short(SFX_FREQ.DEATH + fx.rnd(2000) - 1000), 64, 0, 0, -1);
            player[c1].bumps++;
            if (this.end_score > 0 && player[c1].bumps >= this.end_score) {
                this.state.endscore_reached = true;
            }
            player[c1].bumped[c2]++;
            if (fx) fx.add_score(c1, player[c1].bumps);
        }
    }

    collision_check() {
        const player = this.state.player;
        let c1 = 0,
            c2 = 0,
            c3 = 0;
        let l1;

        /* collision check */
        for (c3 = 0; c3 < 6; c3++) {
            if (c3 == 0) {
                c1 = 0;
                c2 = 1;
            } else if (c3 == 1) {
                c1 = 0;
                c2 = 2;
            } else if (c3 == 2) {
                c1 = 0;
                c2 = 3;
            } else if (c3 == 3) {
                c1 = 1;
                c2 = 2;
            } else if (c3 == 4) {
                c1 = 1;
                c2 = 3;
            } else if (c3 == 5) {
                c1 = 2;
                c2 = 3;
            }
            if (player[c1].enabled && player[c2].enabled) {
                if (
                    Math.abs(player[c1].x - player[c2].x) < 12 << 16 &&
                    Math.abs(player[c1].y - player[c2].y) < 12 << 16
                ) {
                    if (Math.abs(player[c1].y - player[c2].y) >> 16 > 5) {
                        if (player[c1].y < player[c2].y) {
                            this.player_kill(c1, c2);
                        } else {
                            this.player_kill(c2, c1);
                        }
                    } else {
                        if (player[c1].x < player[c2].x) {
                            if (player[c1].x_add > 0) {
                                player[c1].x = player[c2].x - (12 << 16);
                            } else if (player[c2].x_add < 0) {
                                player[c2].x = player[c1].x + (12 << 16);
                            } else {
                                player[c1].x -= player[c1].x_add;
                                player[c2].x -= player[c2].x_add;
                            }
                            l1 = player[c2].x_add;
                            player[c2].x_add = player[c1].x_add;
                            player[c1].x_add = l1;
                            if (player[c1].x_add > 0) player[c1].x_add = -player[c1].x_add;
                            if (player[c2].x_add < 0) player[c2].x_add = -player[c2].x_add;
                        } else {
                            if (player[c1].x_add > 0) {
                                player[c2].x = player[c1].x - (12 << 16);
                            } else if (player[c2].x_add < 0) {
                                player[c1].x = player[c2].x + (12 << 16);
                            } else {
                                player[c1].x -= player[c1].x_add;
                                player[c2].x -= player[c2].x_add;
                            }
                            l1 = player[c2].x_add;
                            player[c2].x_add = player[c1].x_add;
                            player[c1].x_add = l1;
                            if (player[c1].x_add < 0) player[c1].x_add = -player[c1].x_add;
                            if (player[c2].x_add > 0) player[c2].x_add = -player[c2].x_add;
                        }
                    }
                }
            }
        }
    }

    player_action_left(c1: number) {
        const player = this.state.player;
        const { xy: GET_BAN_MAP_XY } = this.map;
        const fx = this.fx;
        let s1 = 0,
            s2 = 0;
        let below_left, below, below_right;

        s1 = player[c1].x >> 16;
        s2 = player[c1].y >> 16;
        below_left = GET_BAN_MAP_XY(s1, s2 + 16);
        below = GET_BAN_MAP_XY(s1 + 8, s2 + 16);
        below_right = GET_BAN_MAP_XY(s1 + 15, s2 + 16);

        if (below == BAN.ICE) {
            if (player[c1].x_add > 0) player[c1].x_add -= 1024;
            else player[c1].x_add -= 768;
        } else if (
            (below_left != BAN.SOLID && below_right == BAN.ICE) ||
            (below_left == BAN.ICE && below_right != BAN.SOLID)
        ) {
            if (player[c1].x_add > 0) player[c1].x_add -= 1024;
            else player[c1].x_add -= 768;
        } else {
            if (player[c1].x_add > 0) {
                player[c1].x_add -= 16384;
                if (player[c1].x_add > -98304 && player[c1].in_water == 0 && below == BAN.SOLID && fx)
                    fx.add_object(
                        OBJ.SMOKE,
                        (player[c1].x >> 16) + 2 + fx.rnd(9),
                        (player[c1].y >> 16) + 13 + fx.rnd(5),
                        0,
                        -16384 - fx.rnd(8192),
                        OBJ_ANIM.SMOKE,
                        0
                    );
            } else player[c1].x_add -= 12288;
        }
        if (player[c1].x_add < -98304) player[c1].x_add = -98304;
        player[c1].direction = 1;
        if (player[c1].anim == 0) {
            player[c1].anim = 1;
            player[c1].frame = 0;
            player[c1].frame_tick = 0;
            player[c1].image = player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
        }
    }

    player_action_right(c1: number) {
        const player = this.state.player;
        const { xy: GET_BAN_MAP_XY } = this.map;
        const fx = this.fx;
        let s1 = 0,
            s2 = 0;
        let below_left, below, below_right;

        s1 = player[c1].x >> 16;
        s2 = player[c1].y >> 16;
        below_left = GET_BAN_MAP_XY(s1, s2 + 16);
        below = GET_BAN_MAP_XY(s1 + 8, s2 + 16);
        below_right = GET_BAN_MAP_XY(s1 + 15, s2 + 16);

        if (below == BAN.ICE) {
            if (player[c1].x_add < 0) player[c1].x_add += 1024;
            else player[c1].x_add += 768;
        } else if (
            (below_left != BAN.SOLID && below_right == BAN.ICE) ||
            (below_left == BAN.ICE && below_right != BAN.SOLID)
        ) {
            if (player[c1].x_add > 0) player[c1].x_add += 1024;
            else player[c1].x_add += 768;
        } else {
            if (player[c1].x_add < 0) {
                player[c1].x_add += 16384;
                if (player[c1].x_add < 98304 && player[c1].in_water == 0 && below == BAN.SOLID && fx)
                    fx.add_object(
                        OBJ.SMOKE,
                        (player[c1].x >> 16) + 2 + fx.rnd(9),
                        (player[c1].y >> 16) + 13 + fx.rnd(5),
                        0,
                        -16384 - fx.rnd(8192),
                        OBJ_ANIM.SMOKE,
                        0
                    );
            } else player[c1].x_add += 12288;
        }
        if (player[c1].x_add > 98304) player[c1].x_add = 98304;
        player[c1].direction = 0;
        if (player[c1].anim == 0) {
            player[c1].anim = 1;
            player[c1].frame = 0;
            player[c1].frame_tick = 0;
            player[c1].image = player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
        }
    }

    steer_players() {
        let c1, c2;
        let s1 = 0,
            s2 = 0;

        const player = this.state.player;
        const cheats = this.cheats;
        const fx = this.fx;
        const { xy: GET_BAN_MAP_XY, in_water: GET_BAN_MAP_IN_WATER } = this.map;

        for (c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
            if (player[c1].enabled) {
                if (!player[c1].dead_flag) {
                    if (player[c1].action_left && player[c1].action_right) {
                        if (player[c1].direction == 0) {
                            if (player[c1].action_right) {
                                this.player_action_right(c1);
                            }
                        } else {
                            if (player[c1].action_left) {
                                this.player_action_left(c1);
                            }
                        }
                    } else if (player[c1].action_left) {
                        this.player_action_left(c1);
                    } else if (player[c1].action_right) {
                        this.player_action_right(c1);
                    } else if (!player[c1].action_left && !player[c1].action_right) {
                        let below_left, below, below_right;

                        s1 = player[c1].x >> 16;
                        s2 = player[c1].y >> 16;
                        below_left = GET_BAN_MAP_XY(s1, s2 + 16);
                        below = GET_BAN_MAP_XY(s1 + 8, s2 + 16);
                        below_right = GET_BAN_MAP_XY(s1 + 15, s2 + 16);
                        if (
                            below == BAN.SOLID ||
                            below == BAN.SPRING ||
                            ((below_left == BAN.SOLID || below_left == BAN.SPRING) && below_right != BAN.ICE) ||
                            (below_left != BAN.ICE && (below_right == BAN.SOLID || below_right == BAN.SPRING))
                        ) {
                            if (player[c1].x_add < 0) {
                                player[c1].x_add += 16384;
                                if (player[c1].x_add > 0) player[c1].x_add = 0;
                            } else {
                                player[c1].x_add -= 16384;
                                if (player[c1].x_add < 0) player[c1].x_add = 0;
                            }
                            if (player[c1].x_add != 0 && GET_BAN_MAP_XY(s1 + 8, s2 + 16) == BAN.SOLID && fx)
                                fx.add_object(
                                    OBJ.SMOKE,
                                    (player[c1].x >> 16) + 2 + fx.rnd(9),
                                    (player[c1].y >> 16) + 13 + fx.rnd(5),
                                    0,
                                    -16384 - fx.rnd(8192),
                                    OBJ_ANIM.SMOKE,
                                    0
                                );
                        }
                        if (player[c1].anim == 1) {
                            player[c1].anim = 0;
                            player[c1].frame = 0;
                            player[c1].frame_tick = 0;
                            player[c1].image =
                                player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                        }
                    }
                    if (!cheats.jetpack) {
                        /* no jetpack */
                        if (cheats.pogostick || (player[c1].jump_ready == 1 && player[c1].action_up)) {
                            s1 = player[c1].x >> 16;
                            s2 = player[c1].y >> 16;
                            if (s2 < -16) s2 = -16;
                            /* jump */
                            if (
                                GET_BAN_MAP_XY(s1, s2 + 16) == BAN.SOLID ||
                                GET_BAN_MAP_XY(s1, s2 + 16) == BAN.ICE ||
                                GET_BAN_MAP_XY(s1 + 15, s2 + 16) == BAN.SOLID ||
                                GET_BAN_MAP_XY(s1 + 15, s2 + 16) == BAN.ICE
                            ) {
                                player[c1].y_add = -280000;
                                player[c1].anim = 2;
                                player[c1].frame = 0;
                                player[c1].frame_tick = 0;
                                player[c1].image =
                                    player_anims[player[c1].anim].frame[player[c1].frame].image +
                                    player[c1].direction * 9;
                                player[c1].jump_ready = 0;
                                player[c1].jump_abort = 1;
                                if (fx) {
                                    if (!cheats.pogostick) {
                                        fx.dj_play_sfx(SFX.JUMP, SFX_FREQ.JUMP + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                                    } else {
                                        fx.dj_play_sfx(SFX.SPRING, SFX_FREQ.SPRING + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                                    }
                                }
                            }
                            /* jump out of water */
                            if (GET_BAN_MAP_IN_WATER(s1, s2)) {
                                player[c1].y_add = -196608;
                                player[c1].in_water = 0;
                                player[c1].anim = 2;
                                player[c1].frame = 0;
                                player[c1].frame_tick = 0;
                                player[c1].image =
                                    player_anims[player[c1].anim].frame[player[c1].frame].image +
                                    player[c1].direction * 9;
                                player[c1].jump_ready = 0;
                                player[c1].jump_abort = 1;
                                if (fx) {
                                    if (!cheats.pogostick) {
                                        fx.dj_play_sfx(SFX.JUMP, SFX_FREQ.JUMP + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                                    } else {
                                        fx.dj_play_sfx(SFX.SPRING, SFX_FREQ.SPRING + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                                    }
                                }
                            }
                        }
                        /* fall down by gravity */
                        if (!cheats.pogostick && !player[c1].action_up) {
                            player[c1].jump_ready = 1;
                            if (player[c1].in_water == 0 && player[c1].y_add < 0 && player[c1].jump_abort == 1) {
                                if (!cheats.bunnies_in_space) {
                                    /* normal gravity */
                                    player[c1].y_add += 32768;
                                } else {
                                    /* light gravity */
                                    player[c1].y_add += 16384;
                                }
                                if (player[c1].y_add > 0) {
                                    player[c1].y_add = 0;
                                }
                            }
                        }
                    } else {
                        /* with jetpack */
                        if (player[c1].action_up) {
                            player[c1].y_add -= 16384;
                            if (player[c1].y_add < -400000) player[c1].y_add = -400000;
                            if (GET_BAN_MAP_IN_WATER(s1, s2)) player[c1].in_water = 0;
                            if (fx && fx.rnd(100) < 50)
                                fx.add_object(
                                    OBJ.SMOKE,
                                    (player[c1].x >> 16) + 6 + fx.rnd(5),
                                    (player[c1].y >> 16) + 10 + fx.rnd(5),
                                    0,
                                    16384 + fx.rnd(8192),
                                    OBJ_ANIM.SMOKE,
                                    0
                                );
                        }
                    }

                    player[c1].x += player[c1].x_add;
                    if (player[c1].x >> 16 < 0) {
                        player[c1].x = 0;
                        player[c1].x_add = 0;
                    }
                    if ((player[c1].x >> 16) + 15 > 351) {
                        player[c1].x = 336 << 16;
                        player[c1].x_add = 0;
                    }
                    {
                        if (player[c1].y > 0) {
                            s2 = player[c1].y >> 16;
                        } else {
                            /* check top line only */
                            s2 = 0;
                        }

                        s1 = player[c1].x >> 16;
                        if (
                            GET_BAN_MAP_XY(s1, s2) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1, s2) == BAN.ICE ||
                            GET_BAN_MAP_XY(s1, s2) == BAN.SPRING ||
                            GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1, s2 + 15) == BAN.ICE ||
                            GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SPRING
                        ) {
                            player[c1].x = ((s1 + 16) & 0xfff0) << 16;
                            player[c1].x_add = 0;
                        }

                        s1 = player[c1].x >> 16;
                        if (
                            GET_BAN_MAP_XY(s1 + 15, s2) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1 + 15, s2) == BAN.ICE ||
                            GET_BAN_MAP_XY(s1 + 15, s2) == BAN.SPRING ||
                            GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.ICE ||
                            GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SPRING
                        ) {
                            player[c1].x = (((s1 + 16) & 0xfff0) - 16) << 16;
                            player[c1].x_add = 0;
                        }
                    }

                    player[c1].y += player[c1].y_add;

                    s1 = player[c1].x >> 16;
                    s2 = player[c1].y >> 16;
                    if (s2 < 0) s2 = 0;
                    if (
                        GET_BAN_MAP_XY(s1 + 8, s2 + 15) == BAN.SPRING ||
                        (GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SPRING && GET_BAN_MAP_XY(s1 + 15, s2 + 15) != BAN.SOLID) ||
                        (GET_BAN_MAP_XY(s1, s2 + 15) != BAN.SOLID && GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SPRING)
                    ) {
                        player[c1].y = ((player[c1].y >> 16) & 0xfff0) << 16;
                        player[c1].y_add = -400000;
                        player[c1].anim = 2;
                        player[c1].frame = 0;
                        player[c1].frame_tick = 0;
                        player[c1].image =
                            player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                        player[c1].jump_ready = 0;
                        player[c1].jump_abort = 0;
                        if (fx) {
                            const objects = fx.objects;
                            for (c2 = 0; c2 < NUM.OBJECTS; c2++) {
                                if (objects[c2].used == 1 && objects[c2].type == OBJ.SPRING) {
                                    if (GET_BAN_MAP_XY(s1 + 8, s2 + 15) == BAN.SPRING) {
                                        if (
                                            objects[c2].x >> 20 == (s1 + 8) >> 4 &&
                                            objects[c2].y >> 20 == (s2 + 15) >> 4
                                        ) {
                                            objects[c2].frame = 0;
                                            objects[c2].ticks =
                                                object_anims[objects[c2].anim].frame[objects[c2].frame].ticks;
                                            objects[c2].image =
                                                object_anims[objects[c2].anim].frame[objects[c2].frame].image;
                                            break;
                                        }
                                    } else {
                                        if (GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SPRING) {
                                            if (
                                                objects[c2].x >> 20 == s1 >> 4 &&
                                                objects[c2].y >> 20 == (s2 + 15) >> 4
                                            ) {
                                                objects[c2].frame = 0;
                                                objects[c2].ticks =
                                                    object_anims[objects[c2].anim].frame[objects[c2].frame].ticks;
                                                objects[c2].image =
                                                    object_anims[objects[c2].anim].frame[objects[c2].frame].image;
                                                break;
                                            }
                                        } else if (GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SPRING) {
                                            if (
                                                objects[c2].x >> 20 == (s1 + 15) >> 4 &&
                                                objects[c2].y >> 20 == (s2 + 15) >> 4
                                            ) {
                                                objects[c2].frame = 0;
                                                objects[c2].ticks =
                                                    object_anims[objects[c2].anim].frame[objects[c2].frame].ticks;
                                                objects[c2].image =
                                                    object_anims[objects[c2].anim].frame[objects[c2].frame].image;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            fx.dj_play_sfx(SFX.SPRING, SFX_FREQ.SPRING + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                        }
                    }
                    s1 = player[c1].x >> 16;
                    s2 = player[c1].y >> 16;
                    if (s2 < 0) s2 = 0;
                    if (
                        GET_BAN_MAP_XY(s1, s2) == BAN.SOLID ||
                        GET_BAN_MAP_XY(s1, s2) == BAN.ICE ||
                        GET_BAN_MAP_XY(s1, s2) == BAN.SPRING ||
                        GET_BAN_MAP_XY(s1 + 15, s2) == BAN.SOLID ||
                        GET_BAN_MAP_XY(s1 + 15, s2) == BAN.ICE ||
                        GET_BAN_MAP_XY(s1 + 15, s2) == BAN.SPRING
                    ) {
                        player[c1].y = ((s2 + 16) & 0xfff0) << 16;
                        player[c1].y_add = 0;
                        player[c1].anim = 0;
                        player[c1].frame = 0;
                        player[c1].frame_tick = 0;
                        player[c1].image =
                            player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                    }
                    s1 = player[c1].x >> 16;
                    s2 = player[c1].y >> 16;
                    if (s2 < 0) s2 = 0;
                    if (GET_BAN_MAP_XY(s1 + 8, s2 + 8) == BAN.WATER) {
                        if (player[c1].in_water == 0) {
                            /* falling into water */
                            player[c1].in_water = 1;
                            player[c1].anim = 4;
                            player[c1].frame = 0;
                            player[c1].frame_tick = 0;
                            player[c1].image =
                                player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                            if (player[c1].y_add >= 32768 && fx) {
                                fx.add_object(
                                    OBJ.SPLASH,
                                    (player[c1].x >> 16) + 8,
                                    ((player[c1].y >> 16) & 0xfff0) + 15,
                                    0,
                                    0,
                                    OBJ_ANIM.SPLASH,
                                    0
                                );
                                if (!cheats.blood_is_thicker_than_water)
                                    fx.dj_play_sfx(SFX.SPLASH, SFX_FREQ.SPLASH + fx.rnd(2000) - 1000, 64, 0, 0, -1);
                                else fx.dj_play_sfx(SFX.SPLASH, SFX_FREQ.SPLASH + fx.rnd(2000) - 5000, 64, 0, 0, -1);
                            }
                        }
                        /* slowly move up to water surface */
                        player[c1].y_add -= 1536;
                        if (player[c1].y_add < 0 && player[c1].anim != 5) {
                            player[c1].anim = 5;
                            player[c1].frame = 0;
                            player[c1].frame_tick = 0;
                            player[c1].image =
                                player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                        }
                        if (player[c1].y_add < -65536) player[c1].y_add = -65536;
                        if (player[c1].y_add > 65535) player[c1].y_add = 65535;
                        if (
                            GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1, s2 + 15) == BAN.ICE ||
                            GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SOLID ||
                            GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.ICE
                        ) {
                            player[c1].y = (((s2 + 16) & 0xfff0) - 16) << 16;
                            player[c1].y_add = 0;
                        }
                    } else if (
                        GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SOLID ||
                        GET_BAN_MAP_XY(s1, s2 + 15) == BAN.ICE ||
                        GET_BAN_MAP_XY(s1, s2 + 15) == BAN.SPRING ||
                        GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SOLID ||
                        GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.ICE ||
                        GET_BAN_MAP_XY(s1 + 15, s2 + 15) == BAN.SPRING
                    ) {
                        player[c1].in_water = 0;
                        player[c1].y = (((s2 + 16) & 0xfff0) - 16) << 16;
                        player[c1].y_add = 0;
                        if (player[c1].anim != 0 && player[c1].anim != 1) {
                            player[c1].anim = 0;
                            player[c1].frame = 0;
                            player[c1].frame_tick = 0;
                            player[c1].image =
                                player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                        }
                    } else {
                        if (player[c1].in_water == 0) {
                            if (!cheats.bunnies_in_space) player[c1].y_add += 12288;
                            else player[c1].y_add += 6144;
                            if (player[c1].y_add > 327680) player[c1].y_add = 327680;
                        } else {
                            player[c1].y = (player[c1].y & 0xffff0000) + 0x10000;
                            player[c1].y_add = 0;
                        }
                        player[c1].in_water = 0;
                    }
                    if (player[c1].y_add > 36864 && player[c1].anim != 3 && !player[c1].in_water) {
                        player[c1].anim = 3;
                        player[c1].frame = 0;
                        player[c1].frame_tick = 0;
                        player[c1].image =
                            player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
                    }
                }

                player[c1].frame_tick++;
                if (player[c1].frame_tick >= player_anims[player[c1].anim].frame[player[c1].frame].ticks) {
                    player[c1].frame++;
                    if (player[c1].frame >= player_anims[player[c1].anim].num_frames) {
                        if (player[c1].anim != 6) player[c1].frame = player_anims[player[c1].anim].restart_frame;
                        else this.position_player(c1);
                    }
                    player[c1].frame_tick = 0;
                }
                player[c1].image =
                    player_anims[player[c1].anim].frame[player[c1].frame].image + player[c1].direction * 9;
            }
        }
    }

    position_player(player_num: number) {
        const player = this.state.player;
        const { tile: GET_BAN_MAP_TILE } = this.map;
        let c1;
        let s1, s2;
        let attempts = 0;

        const is_spawn_tile = (x: number, y: number) =>
            GET_BAN_MAP_TILE(y, x) == BAN.VOID &&
            (GET_BAN_MAP_TILE(y + 1, x) == BAN.SOLID || GET_BAN_MAP_TILE(y + 1, x) == BAN.ICE);

        while (1) {
            while (1) {
                s1 = this.rnd(22);
                s2 = this.rnd(16);
                if (is_spawn_tile(s1, s2)) break;
                if (++attempts > MAX_SPAWN_ATTEMPTS) break;
            }
            if (attempts > MAX_SPAWN_ATTEMPTS) {
                /* The original loops forever when a level has no free spawn tile
                   (e.g. more bunnies than spawn tiles); fall back to a fixed choice. */
                this.spawn_fallbacks++;
                if (!is_spawn_tile(s1, s2)) [s1, s2] = this.fallback_spawn_tile(is_spawn_tile);
                break;
            }
            for (c1 = 0; c1 < JNB_MAX_PLAYERS; c1++) {
                if (c1 != player_num && player[c1].enabled) {
                    if (
                        Math.abs((s1 << 4) - (player[c1].x >> 16)) < 32 &&
                        Math.abs((s2 << 4) - (player[c1].y >> 16)) < 32
                    )
                        break;
                }
            }
            if (c1 == JNB_MAX_PLAYERS) break;
            ++attempts;
        }

        player[player_num].x = s1 << 20;
        player[player_num].y = s2 << 20;
        player[player_num].x_add = player[player_num].y_add = 0;
        player[player_num].direction = 0;
        player[player_num].jump_ready = 1;
        player[player_num].in_water = 0;
        player[player_num].anim = 0;
        player[player_num].frame = 0;
        player[player_num].frame_tick = 0;
        player[player_num].image = player_anims[player[player_num].anim].frame[player[player_num].frame].image;
        player[player_num].dead_flag = false;
    }

    /** First spawn tile in reading order, else the first empty tile, else the top left corner. */
    fallback_spawn_tile(is_spawn_tile: (x: number, y: number) => boolean): [number, number] {
        const { tile: GET_BAN_MAP_TILE } = this.map;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 22; x++) if (is_spawn_tile(x, y)) return [x, y];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 22; x++) if (GET_BAN_MAP_TILE(y, x) == BAN.VOID) return [x, y];
        return [0, 0];
    }
}

function to_short(n: number) {
    return (n << 16) >> 16;
}
