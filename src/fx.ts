import { get_gob } from './assets';
import { rnd } from './c';
import ctx from './context';
import { add_object, add_score } from './renderer';
import type { SimFx } from './sim/sim';
import { dj_play_sfx } from './sdl/sound';

/** Draws a player's two-digit score next to their portrait in the level's side panel. */
export function show_score(player_num: number, bumps: number) {
    const number_gobs = get_gob('numbers');
    const s1 = bumps % 100;
    add_score(player_num, 0, 360, 34 + player_num * 64, Math.floor(s1 / 10), number_gobs);
    add_score(player_num, 1, 376, 34 + player_num * 64, s1 % 10, number_gobs);
}

/** Cosmetic effects of the simulation, rendered into the global context. */
export const local_fx: SimFx = {
    get objects() {
        return ctx.objects;
    },
    get no_gore() {
        return ctx.info.no_gore;
    },
    rnd,
    add_object,
    dj_play_sfx,
    add_score: show_score,
};
