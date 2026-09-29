/**
 * Graphics taken from the original game data (jumpbump.dat) for the pixel-art lobby:
 * the menu background, the font and the rabbit and object sprites, all in the menu palette.
 */
import type { Gob } from '../../assets';
import { preread_datafile, read_gob, read_pcx } from '../../data';
import { init_font } from './font';

export type Sprite = {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    hs_x: number;
    hs_y: number;
};

export type GameAssets = {
    /** The 400x256 menu screen with the forest and the logo. */
    menu: HTMLCanvasElement;
    /** The parts of the menu screen in front of the bunnies (menumask.pcx: the log's front end), transparent elsewhere. */
    menu_front: HTMLCanvasElement;
    rabbit: Sprite[];
    objects: Sprite[];
};

let promise: Promise<GameAssets> | null = null;
let loaded: GameAssets | null = null;

function to_rgb(palette: Uint8ClampedArray, index: number, out: Uint8ClampedArray, offset: number) {
    out[offset] = palette[index * 3] << 2;
    out[offset + 1] = palette[index * 3 + 1] << 2;
    out[offset + 2] = palette[index * 3 + 2] << 2;
}

function sprites_of(gob: Gob, palette: Uint8ClampedArray): Sprite[] {
    const sprites: Sprite[] = [];
    for (let i = 0; i < gob.num_images; i++) {
        const width = gob.width[i];
        const height = gob.height[i];
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const context = canvas.getContext('2d')!;
        const image = context.createImageData(canvas.width, canvas.height);
        const data = gob.data[i];
        for (let p = 0; p < width * height; p++) {
            if (!data[p]) continue;
            to_rgb(palette, data[p], image.data, p * 4);
            image.data[p * 4 + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        sprites.push({ canvas, width, height, hs_x: gob.hs_x[i], hs_y: gob.hs_y[i] });
    }
    return sprites;
}

/** Loads and decodes the game graphics once; later calls share the same promise. */
export function load_game_assets(): Promise<GameAssets> {
    if (!promise) {
        promise = fetch('/levels/jumpbump.dat')
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.arrayBuffer();
            })
            .then((dat) => {
                preread_datafile(dat);
                const palette = new Uint8ClampedArray(768);
                const pixels = read_pcx('menu.pcx', palette);
                const menu = document.createElement('canvas');
                menu.width = 400;
                menu.height = 256;
                const context = menu.getContext('2d')!;
                const image = context.createImageData(400, 256);
                for (let p = 0; p < 400 * 256; p++) {
                    to_rgb(palette, pixels[p], image.data, p * 4);
                    image.data[p * 4 + 3] = 255;
                }
                context.putImageData(image, 0, 0);

                const mask = read_pcx('menumask.pcx', null);
                const menu_front = document.createElement('canvas');
                menu_front.width = 400;
                menu_front.height = 256;
                const front_context = menu_front.getContext('2d')!;
                const front = front_context.createImageData(400, 256);
                for (let p = 0; p < 400 * 256; p++) {
                    if (!mask[p]) continue;
                    to_rgb(palette, pixels[p], front.data, p * 4);
                    front.data[p * 4 + 3] = 255;
                }
                front_context.putImageData(front, 0, 0);

                init_font(read_gob('font.gob'));
                loaded = {
                    menu,
                    menu_front,
                    rabbit: sprites_of(read_gob('rabbit.gob'), palette),
                    objects: sprites_of(read_gob('objects.gob'), palette),
                };
                return loaded;
            })
            .catch((error) => {
                promise = null;
                throw error;
            });
    }
    return promise;
}

export function game_assets(): GameAssets | null {
    return loaded;
}

const thumbnails = new Map<string, Promise<HTMLCanvasElement>>();

/** A level preview shrunk onto the game's pixel grid, so it scales up as crisply as the rest of the UI. */
export function level_thumbnail(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
    const key = `${url}@${width}x${height}`;
    let thumbnail = thumbnails.get(key);
    if (!thumbnail) {
        thumbnail = new Promise<HTMLCanvasElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d')!;
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
                context.drawImage(image, 0, 0, width, height);
                resolve(canvas);
            };
            image.onerror = () => {
                thumbnails.delete(key);
                reject(new Error(`Could not load ${url}`));
            };
            image.src = url;
        });
        thumbnails.set(key, thumbnail);
    }
    return thumbnail;
}
