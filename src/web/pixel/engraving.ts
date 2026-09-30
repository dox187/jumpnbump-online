/** Native-raster lettering cut into the surrounding wood, with charred grooves and a lit upper lip. */
import { render_panel_name } from '../../online/panel-names';

type Point = { x: number; y: number };
export type Engraving = { width: number; height: number; pixels: Uint8Array };
const names = new Map<string, Engraving>();
const logos = new Map<string, Engraving>();

/** Keep the original logo's letter faces; its blue extrusion and green shadow are not part of a wood cut. */
export function logo_engraving(source: HTMLCanvasElement, width: number, height: number): Engraving {
    const key = `${width}:${height}`;
    const cached = logos.get(key);
    if (cached) return cached;
    const image = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
    const mask: Engraving = { width, height, pixels: new Uint8Array(width * height) };
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const left = (x * source.width) / width,
                right = ((x + 1) * source.width) / width;
            const top = (y * source.height) / height,
                bottom = ((y + 1) * source.height) / height;
            let covered = 0;
            for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++)
                for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
                    const p = (sy * source.width + sx) * 4;
                    const light = (image.data[p] * 3 + image.data[p + 1] * 6 + image.data[p + 2]) / 10;
                    if (!image.data[p + 3] || light < 175) continue;
                    covered +=
                        (Math.min(right, sx + 1) - Math.max(left, sx)) * (Math.min(bottom, sy + 1) - Math.max(top, sy));
                }
            // Keep the counters and spaces between stems open on the reduced native grid.
            mask.pixels[y * width + x] = Number(covered / ((right - left) * (bottom - top)) >= 0.62);
        }
    logos.set(key, mask);
    return mask;
}

/** Turn the original name glyphs and reconnect neighbouring stroke pixels after rasterization. */
export function name_engraving(text: string, angle: number): Engraving {
    const key = `${text}:${angle}`;
    const cached = names.get(key);
    if (cached) return cached;
    const name = render_panel_name(text, 0);
    const image = name.getContext('2d')!.getImageData(0, 0, name.width, name.height);
    const radians = (angle * Math.PI) / 180,
        half = Math.tan(radians / 2),
        sin = Math.sin(radians);
    const points = new Map<number, Point>();
    for (let sy = 0; sy < name.height; sy++)
        for (let sx = 0; sx < name.width; sx++) {
            const p = (sy * name.width + sx) * 4;
            // Only the glyph face is cut; discard the score panel's original drop shadow.
            if (!image.data[p + 3] || image.data[p] < 128) continue;
            let x = sx - Math.floor(name.width / 2),
                y = sy - Math.floor(name.height / 2);
            x -= Math.round(y * half);
            y += Math.round(x * sin);
            x -= Math.round(y * half);
            points.set(sy * name.width + sx, { x, y });
        }
    const turned = [...points.values()];
    const left = Math.min(...turned.map((p) => p.x)),
        right = Math.max(...turned.map((p) => p.x));
    const top = Math.min(...turned.map((p) => p.y)),
        bottom = Math.max(...turned.map((p) => p.y));
    const width = right - left + 1,
        height = bottom - top + 1;
    const mask: Engraving = { width, height, pixels: new Uint8Array(width * height) };
    const put = (x: number, y: number) => {
        mask.pixels[(y - top) * width + x - left] = 1;
    };
    for (const [index, point] of points) {
        put(point.x, point.y);
        const sx = index % name.width,
            sy = Math.floor(index / name.width);
        for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [1, 1],
            [-1, 1],
        ]) {
            if (sx + dx < 0 || sx + dx >= name.width || sy + dy >= name.height) continue;
            const next = points.get((sy + dy) * name.width + sx + dx);
            if (!next) continue;
            let { x, y } = point;
            // A connected source stroke stays connected even where a rotated one-pixel line crosses a cell corner.
            while (x !== next.x || y !== next.y) {
                if (Math.abs(next.x - x) >= Math.abs(next.y - y) && x !== next.x) x += Math.sign(next.x - x);
                else y += Math.sign(next.y - y);
                put(x, y);
            }
        }
    }
    names.set(key, mask);
    return mask;
}

/** Shade the actual wood pixels: a dark recessed wall, textured char and a narrow highlight above the cut. */
export function engrave(context: CanvasRenderingContext2D, mask: Engraving, x: number, y: number) {
    const image = context.getImageData(x - 1, y - 1, mask.width + 2, mask.height + 2);
    const cut = (px: number, py: number) =>
        px >= 0 && py >= 0 && px < mask.width && py < mask.height && mask.pixels[py * mask.width + px] !== 0;
    for (let py = -1; py <= mask.height; py++)
        for (let px = -1; px <= mask.width; px++) {
            const p = ((py + 1) * image.width + px + 1) * 4;
            if (!image.data[p + 3]) continue;
            const r = image.data[p],
                g = image.data[p + 1],
                b = image.data[p + 2];
            const above = cut(px, py - 1),
                below = cut(px, py + 1);
            if (cut(px, py)) {
                // Char retains the grain of the real surface instead of tinting a pasted-on logo layer.
                const lip = above && !below ? 12 : 0;
                image.data[p] = 19 + Math.round(r * 0.2) + lip;
                image.data[p + 1] = 7 + Math.round(g * 0.18) + Math.round(lip / 2);
                image.data[p + 2] = 2 + Math.round(b * 0.12);
            } else if (below) {
                image.data[p] = Math.min(222, 124 + Math.round(r * 0.48));
                image.data[p + 1] = Math.min(151, 63 + Math.round(g * 0.56));
                image.data[p + 2] = Math.min(78, 24 + Math.round(b * 0.56));
            } else if (above) {
                image.data[p] = Math.round(r * 0.7);
                image.data[p + 1] = Math.round(g * 0.65);
                image.data[p + 2] = Math.round(b * 0.6);
            }
        }
    context.putImageData(image, x - 1, y - 1);
}
