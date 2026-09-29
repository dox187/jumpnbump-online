import { BAN } from '../constants';

const LEVEL_SCALE_FACTOR = 4;

export type BanMap = {
    tiles: number[][];
    xy: (x: number, y: number) => number;
    tile: (pos_y: number, pos_x: number) => number;
    in_water: (s1: number, s2: number) => boolean;
};

/**
 * Accessors for one level's collision map (17 rows x 22 columns of BAN values).
 * The functions are closures so the simulation can destructure them without binding.
 */
export function create_ban_map(tiles: number[][]): BanMap {
    const xy = (x: number, y: number) => {
        if (y < 0) y = 0;
        try {
            return tiles[y >> LEVEL_SCALE_FACTOR][x >> LEVEL_SCALE_FACTOR];
        } catch (e) {
            throw new Error('GET_BAN_MAP_XY failed: ' + x + ',' + y);
        }
    };

    const tile = (pos_y: number, pos_x: number) => {
        if (pos_y < 0) pos_y = 0;
        return tiles[pos_y][pos_x];
    };

    const in_water = (s1: number, s2: number) =>
        (xy(s1, s2 + 7) == BAN.VOID || xy(s1 + 15, s2 + 7) == BAN.VOID) &&
        (xy(s1, s2 + 8) == BAN.WATER || xy(s1 + 15, s2 + 8) == BAN.WATER);

    return { tiles, xy, tile, in_water };
}
