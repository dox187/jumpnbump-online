// Changed by dox187 on 2026-10-01 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import crc32 from 'crc/calculators/crc32';

type Sprite = {
    key: string;
    width: number;
    height: number;
    data: Uint8ClampedArray;
    alphaColor?: number;
    /** Score digits are drawn over the level's foreground. Other sprites remain behind it. */
    masked?: boolean;
};

type PositionedSprite = Sprite & {
    x: number;
    y: number;
};

/** A sprite in screen colours, with a 32-bit view for copying whole pixels. */
type RenderedImage = {
    image: ImageData;
    pixels: Uint32Array;
};

/**
 * Only the latest palettes are kept: a fade sets a new palette every frame, and keeping a full screen
 * background and mask for each of those steps held tens of megabytes.
 */
const KEPT_PALETTES = 2;

class PalettedCache {
    cache: Map<string, Map<string, RenderedImage>> = new Map();
    paletteKey: string = '';

    updatePaletteKey(key: string) {
        this.paletteKey = key;
        if (this.cache.has(key)) return;
        this.cache.set(key, new Map());
        for (const old of this.cache.keys()) {
            if (this.cache.size <= KEPT_PALETTES) break;
            if (old !== key) this.cache.delete(old);
        }
    }

    purgeForKey(key: string) {
        for (const images of this.cache.values()) images.delete(key);
    }

    get(key: string): RenderedImage | undefined {
        return this.cache.get(this.paletteKey)?.get(key);
    }

    set(key: string, data: RenderedImage) {
        let images = this.cache.get(this.paletteKey);
        if (!images) {
            images = new Map();
            this.cache.set(this.paletteKey, images);
        }
        images.set(key, data);
    }
}

const findBestAlphaColor = (data: Uint8ClampedArray): number => {
    const colorUsed: Record<number, number> = {};
    for (let i = 0; i < data.length; i++) {
        const color = data[i];
        colorUsed[color] = 1;
    }
    for (let i = 0; i < 256; i++) {
        if (!colorUsed[i]) {
            return i;
        }
    }
    // fallback to 0
    return 0;
};

type MaskExtractData = {
    data: Uint8ClampedArray;
    alphaColor: number;
};

function extractMaskFromBackground(background: Uint8ClampedArray, mask: Uint8ClampedArray): MaskExtractData {
    const maskData = Uint8ClampedArray.from(mask);
    const alphaColor = findBestAlphaColor(background);
    for (let i = 0; i < mask.length; i++) {
        if (maskData[i] > 0) {
            maskData[i] = background[i];
        } else {
            maskData[i] = alphaColor;
        }
    }

    return {
        data: maskData,
        alphaColor,
    };
}

function rendered(image: ImageData): RenderedImage {
    return { image, pixels: new Uint32Array(image.data.buffer, image.data.byteOffset, image.width * image.height) };
}

/**
 * Draws the paletted screen of the original game: background and sprites in the order they were put. The mask
 * keeps the level's foreground in front of masked sprites; score digits can draw over it.
 *
 * Every frame starts from a cached copy of the background with the mask already applied. Masked sprites skip
 * foreground pixels while drawing. The frame buffer is reused, so drawing allocates nothing per frame.
 */
export class PalettedRenderer {
    imageCache: PalettedCache = new PalettedCache();
    width: number;
    height: number;
    background: Sprite;
    mask: Sprite;
    currentObjects: PositionedSprite[];
    palette: Uint8ClampedArray;
    frame: RenderedImage;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.palette = new Uint8ClampedArray(256 * 3);
        this.currentObjects = [];
        this.frame = rendered(new ImageData(width, height));
        this.background = {
            key: 'background',
            data: new Uint8ClampedArray(width * height * 3),
            width: this.width,
            height: this.height,
        };
        this.mask = {
            key: 'mask',
            data: new Uint8ClampedArray(width * height * 3),
            width: this.width,
            height: this.height,
            alphaColor: 0,
        };
    }

    setPalette(palette: Uint8ClampedArray): void {
        this.palette = palette;
        this.imageCache.updatePaletteKey(crc32(palette as any).toString(16));
    }

    registerBackground(background: Uint8ClampedArray): void {
        this.imageCache.purgeForKey(this.background.key);
        this.imageCache.purgeForKey('composed');
        this.background.data = background;
        const image = this.#renderPixels(background, this.width, this.height);
        this.imageCache.set(this.background.key, image);
    }

    registerMask(mask: Uint8ClampedArray): void {
        this.imageCache.purgeForKey(this.mask.key);
        this.imageCache.purgeForKey('composed');
        const extractData = extractMaskFromBackground(this.background.data, mask);
        this.mask.data = extractData.data;
        this.mask.alphaColor = extractData.alphaColor;
        const image = this.#renderPixels(this.mask.data, this.width, this.height, this.mask.alphaColor);
        this.imageCache.set(this.mask.key, image);
    }

    #getRendered({ key, data, width, height, alphaColor }: Sprite): RenderedImage {
        const cached = this.imageCache.get(key);
        if (cached) {
            return cached;
        }
        const image = this.#renderPixels(data, width, height, alphaColor);
        this.imageCache.set(key, image);
        return image;
    }

    getImage(sprite: Sprite): ImageData {
        return this.#getRendered(sprite).image;
    }

    putObject(x: number, y: number, sprite: Sprite): void {
        // Rendered in the palette that is current when the frame is drawn
        this.currentObjects.push({ x, y, ...sprite });
    }

    #renderPixels(pixels: Uint8ClampedArray, width: number, height: number, alphaColor?: number): RenderedImage {
        // Each palette colour once as a whole pixel, opaque and transparent
        const colors = new Uint8ClampedArray(256 * 4 * 2);
        for (let c = 0; c < 256; c++) {
            for (let n = 0; n < 2; n++) {
                const i = (n * 256 + c) * 4;
                colors[i] = this.palette[c * 3];
                colors[i + 1] = this.palette[c * 3 + 1];
                colors[i + 2] = this.palette[c * 3 + 2];
                colors[i + 3] = n === 0 ? 255 : 0;
            }
        }
        const lookup = new Uint32Array(colors.buffer);
        const image = rendered(new ImageData(width, height));
        const out = image.pixels;
        const count = Math.min(pixels.length, out.length);
        for (let i = 0; i < count; i++) {
            const color = pixels[i];
            out[i] = lookup[color === alphaColor ? 256 + color : color];
        }
        return image;
    }

    /** The background with the mask drawn over it. */
    #composed(): RenderedImage {
        const cached = this.imageCache.get('composed');
        if (cached) return cached;
        const background = this.#getRendered(this.background).pixels;
        const mask = this.#getRendered(this.mask);
        const alpha = mask.image.data;
        const image = rendered(new ImageData(this.width, this.height));
        const out = image.pixels;
        for (let i = 0; i < out.length; i++) out[i] = alpha[i * 4 + 3] === 0 ? background[i] : mask.pixels[i];
        this.imageCache.set('composed', image);
        return image;
    }

    render(): ImageData {
        const frame = this.frame.pixels;
        const screenWidth = this.width;
        frame.set(this.#composed().pixels);
        const maskAlpha = this.#getRendered(this.mask).image.data;

        for (const object of this.currentObjects) {
            // Sprites are placed on whole pixels (all callers shift fixed-point positions or use integers)
            if (!Number.isInteger(object.x) || !Number.isInteger(object.y)) continue;
            const sprite = this.#getRendered(object);
            const width = sprite.image.width;
            const height = sprite.image.height;
            const left = Math.max(0, object.x);
            const right = Math.min(screenWidth, object.x + width);
            const top = Math.max(0, object.y);
            const bottom = Math.min(this.height, object.y + height);
            if (left >= right || top >= bottom) continue;
            const alpha = sprite.image.data;
            const pixels = sprite.pixels;
            const masked = object.masked !== false;
            for (let y = top; y < bottom; y++) {
                const source = (y - object.y) * width - object.x;
                const target = y * screenWidth;
                for (let x = left; x < right; x++) {
                    if (alpha[(source + x) * 4 + 3] !== 0 && (!masked || maskAlpha[(target + x) * 4 + 3] === 0))
                        frame[target + x] = pixels[source + x];
                }
            }
        }

        this.currentObjects = [];
        return this.frame.image;
    }
}
