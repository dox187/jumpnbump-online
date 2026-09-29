import { readFile } from 'node:fs/promises';
import path from 'node:path';
import levels from '../src/web/levels.json';
import { preread_datafile, read_level } from '../src/data';
import { BanMap, create_ban_map } from '../src/sim/ban-map';

export type LevelInfo = { datFile: string; name: string };

const catalog = new Map<string, LevelInfo>(levels.map((l) => [l.datFile, { datFile: l.datFile, name: l.name }]));

export function level_info(dat_file: string): LevelInfo | undefined {
    return catalog.get(dat_file);
}

export function level_name(dat_file: string): string {
    return catalog.get(dat_file)?.name ?? dat_file;
}

const map_cache = new Map<string, Promise<BanMap>>();

/** Parses levelmap.txt out of a level's .dat file. The result is cached per file. */
export function load_level_map(levels_dir: string, dat_file: string): Promise<BanMap> {
    if (!catalog.has(dat_file)) return Promise.reject(new Error(`Unknown level: ${dat_file}`));

    let map = map_cache.get(dat_file);
    if (!map) {
        map = readFile(path.join(levels_dir, dat_file)).then((buffer) => {
            // data.ts keeps the current datafile in module state; parsing is synchronous, so this is safe
            preread_datafile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
            return create_ban_map(read_level());
        });
        map.catch(() => map_cache.delete(dat_file));
        map_cache.set(dat_file, map);
    }
    return map;
}
