/** Illustrated wooden shells and controls, composed on one native pixel grid. */
import { engrave, logo_engraving, name_engraving } from './engraving';
import type { ButtonId, ShellLayout } from './console';
import portrait_url from './handheld-art/portrait.png';
import landscape_url from './handheld-art/landscape.png';
import portrait_body_url from './handheld-art/portrait-body.png';
import landscape_body_url from './handheld-art/landscape-body.png';
import logo_url from './handheld-art/original-logo.png';

type Rect = { x: number; y: number; w: number; h: number };
type Point = [number, number];
type ControlId = 'rocker' | 'jump' | 'back' | 'full';
type Control = {
    bounds: Rect;
    outline: Point[];
    /** Optical center and tilt of the front wood face, excluding the button's thick lower edge. */
    label?: { center: Point; angle: number };
};
type Skin = {
    url: string;
    body_url: string;
    w: number;
    h: number;
    opening: Rect;
    controls: Record<ControlId, Control>;
};
const CONTROL_IDS: ControlId[] = ['rocker', 'jump', 'back', 'full'];
const PORTRAIT: Skin = {
    url: portrait_url,
    body_url: portrait_body_url,
    w: 200,
    h: 432,
    opening: { x: 17, y: 78, w: 166, h: 129 },
    controls: {
        rocker: {
            bounds: { x: 5, y: 237, w: 123, h: 67 },
            outline: [
                [6, 261],
                [12, 249],
                [24, 242],
                [46, 238],
                [67, 243],
                [87, 240],
                [104, 241],
                [118, 250],
                [125, 264],
                [127, 284],
                [118, 296],
                [105, 303],
                [85, 300],
                [64, 295],
                [42, 303],
                [25, 300],
                [11, 288],
                [5, 276],
            ],
        },
        jump: {
            bounds: { x: 130, y: 224, w: 62, h: 84 },
            outline: [
                [144, 226],
                [163, 224],
                [175, 233],
                [184, 249],
                [191, 272],
                [192, 290],
                [182, 302],
                [165, 308],
                [147, 306],
                [132, 298],
                [130, 285],
                [132, 252],
            ],
        },
        back: {
            bounds: { x: 49, y: 313, w: 45, h: 40 },
            label: { center: [72, 330], angle: 8 },
            outline: [
                [50, 324],
                [60, 315],
                [74, 313],
                [87, 319],
                [93, 332],
                [90, 346],
                [79, 352],
                [60, 351],
                [50, 341],
            ],
        },
        full: {
            bounds: { x: 109, y: 313, w: 51, h: 40 },
            label: { center: [134, 330], angle: -8 },
            outline: [
                [110, 329],
                [120, 317],
                [135, 313],
                [149, 317],
                [159, 330],
                [158, 342],
                [148, 351],
                [130, 353],
                [115, 348],
                [109, 339],
            ],
        },
    },
};
const LANDSCAPE: Skin = {
    url: landscape_url,
    body_url: landscape_body_url,
    w: 432,
    h: 200,
    opening: { x: 110, y: 35, w: 214, h: 118 },
    controls: {
        rocker: {
            bounds: { x: 3, y: 76, w: 101, h: 68 },
            outline: [
                [4, 100],
                [12, 87],
                [27, 80],
                [42, 77],
                [60, 84],
                [77, 78],
                [94, 84],
                [103, 98],
                [104, 122],
                [98, 137],
                [82, 144],
                [60, 137],
                [43, 144],
                [22, 138],
                [8, 124],
                [3, 113],
            ],
        },
        jump: {
            bounds: { x: 331, y: 77, w: 88, h: 76 },
            outline: [
                [337, 96],
                [356, 82],
                [382, 77],
                [402, 79],
                [414, 90],
                [419, 116],
                [416, 139],
                [406, 151],
                [383, 153],
                [351, 140],
                [332, 123],
                [331, 108],
            ],
        },
        back: {
            bounds: { x: 42, y: 47, w: 38, h: 34 },
            label: { center: [60, 61], angle: 10 },
            outline: [
                [44, 56],
                [53, 48],
                [66, 47],
                [77, 53],
                [80, 66],
                [76, 76],
                [65, 81],
                [52, 79],
                [44, 72],
                [42, 63],
            ],
        },
        full: {
            bounds: { x: 352, y: 47, w: 48, h: 34 },
            label: { center: [376, 61], angle: -16 },
            outline: [
                [354, 58],
                [365, 51],
                [382, 47],
                [394, 51],
                [399, 60],
                [400, 69],
                [391, 77],
                [374, 81],
                [360, 77],
                [352, 67],
            ],
        },
    },
};

function skin_for(layout: ShellLayout) {
    return layout.mode === 'landscape' ? LANDSCAPE : PORTRAIT;
}

function axis(value: number, source: number[], destination: number[]) {
    for (let i = 0; i < source.length - 1; i++) {
        if (value <= source[i + 1]) {
            const t = (value - source[i]) / (source[i + 1] - source[i]);
            return Math.round(destination[i] + t * (destination[i + 1] - destination[i]));
        }
    }
    return destination[destination.length - 1];
}

function mapping(layout: ShellLayout) {
    const skin = skin_for(layout),
        from = skin.opening,
        to = layout.screen;
    const sx = [0, from.x, from.x + from.w, skin.w];
    const sy = [0, from.y, from.y + from.h, skin.h];
    const dx = [0, to.x, to.x + to.w, layout.view.w];
    const dy = [0, to.y, to.y + to.h, layout.view.h];
    const cx = [layout.insets.left, to.x, to.x + to.w, layout.view.w - layout.insets.right];
    const cy = [layout.insets.top, to.y, to.y + to.h, layout.view.h - layout.insets.bottom];
    const control = (id: ControlId): Rect => {
        const r = skin.controls[id].bounds;
        const left = axis(r.x, sx, cx),
            right = axis(r.x + r.w, sx, cx);
        const top = axis(r.y, sy, cy),
            bottom = axis(r.y + r.h, sy, cy);
        // Controls retain their proportions as the available space changes around the 4:3 screen.
        const scale = Math.min((right - left) / r.w, (bottom - top) / r.h);
        const w = Math.max(1, Math.round(r.w * scale)),
            h = Math.max(1, Math.round(r.h * scale));
        return { x: Math.round((left + right - w) / 2), y: Math.round((top + bottom - h) / 2), w, h };
    };
    return { skin, sx, sy, dx, dy, control };
}

/** The hit areas come from the same drawing coordinates as the visible controls. */
export function artwork_buttons(layout: ShellLayout): ShellLayout['buttons'] {
    const { control } = mapping(layout);
    const rocker = control('rocker'),
        split = Math.floor(rocker.w / 2);
    return {
        left: { ...rocker, w: split },
        right: { ...rocker, x: rocker.x + split, w: rocker.w - split },
        jump: control('jump'),
        back: control('back'),
        full: control('full'),
    };
}

type Source = { body: HTMLImageElement; controls: Map<ControlId, HTMLCanvasElement> };
const sources = new Map<Skin, Source>();
let logo: HTMLCanvasElement | null = null;
let loading: Promise<void> | null = null;
export function art_ready() {
    return sources.size === 2 && logo !== null;
}

async function load_image(url: string) {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
}

/** An integer-pixel mask keeps the sprite edges on the same raster as the rest of the shell. */
function inside(x: number, y: number, outline: Point[]) {
    let hit = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const [xi, yi] = outline[i],
            [xj, yj] = outline[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

function sprite(image: HTMLImageElement, control: Control) {
    const r = control.bounds;
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = r.h;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, -r.x, -r.y);
    const pixels = context.getImageData(0, 0, r.w, r.h);
    for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++)
            if (!inside(x + r.x + 0.5, y + r.y + 0.5, control.outline)) pixels.data[(y * r.w + x) * 4 + 3] = 0;
    context.putImageData(pixels, 0, 0);
    return canvas;
}

async function load_logo() {
    const image = await load_image(logo_url);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    logo = canvas;
}

export function load_handheld_art(): Promise<void> {
    if (!loading)
        loading = Promise.all([
            load_logo(),
            ...[PORTRAIT, LANDSCAPE].map(async (skin) => {
                const [atlas, body] = await Promise.all([load_image(skin.url), load_image(skin.body_url)]);
                sources.set(skin, {
                    body,
                    controls: new Map(CONTROL_IDS.map((id) => [id, sprite(atlas, skin.controls[id])])),
                });
            }),
        ]).then(() => {});
    return loading;
}

const frames = new Map<string, HTMLCanvasElement>();
function base_frame(layout: ShellLayout) {
    const key = JSON.stringify([layout.mode, layout.view, layout.screen]);
    const cached = frames.get(key);
    if (cached) return cached;
    const { skin, sx, sy, dx, dy, control } = mapping(layout);
    const source = sources.get(skin);
    if (!source || !logo) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layout.view.w;
    canvas.height = layout.view.h;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    // Reflow the uninterrupted wood around the strictly 4:3 display; never repeat it as a tile.
    for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
            if (x === 1 && y === 1) continue;
            context.drawImage(
                source.body,
                sx[x],
                sy[y],
                sx[x + 1] - sx[x],
                sy[y + 1] - sy[y],
                dx[x],
                dy[y],
                dx[x + 1] - dx[x],
                dy[y + 1] - dy[y]
            );
        }
    context.fillStyle = '#000';
    context.fillRect(layout.screen.x, layout.screen.y, layout.screen.w, layout.screen.h);
    // The small original logo is cut into the wood directly beside the display.
    const portrait = layout.mode === 'portrait';
    const w = Math.min(portrait ? 55 : 58, layout.screen.w - 12);
    const h = Math.round((w * logo.height) / logo.width);
    const x = layout.screen.x + Math.round((layout.screen.w - w) / 2);
    const screen_bottom = layout.screen.y + layout.screen.h;
    const controls_top = Math.min(control('rocker').y, control('jump').y);
    const y = portrait
        ? screen_bottom + Math.max(3, Math.floor((controls_top - screen_bottom - h) / 2))
        : layout.insets.top + 7;
    engrave(context, logo_engraving(logo, w, h), x, y);
    if (frames.size >= 8) frames.delete(frames.keys().next().value!);
    frames.set(key, canvas);
    return canvas;
}

const controls = new Map<string, HTMLCanvasElement>();
function control_art(skin: Skin, id: ControlId, r: Rect, pressed: boolean) {
    const key = `${skin.url}:${id}:${r.w}:${r.h}:${pressed}`;
    const cached = controls.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = r.h;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(sources.get(skin)!.controls.get(id)!, 0, 0, r.w, r.h);
    const face = skin.controls[id].label;
    if (face) {
        const bounds = skin.controls[id].bounds;
        const text = name_engraving(id, face.angle);
        const x = ((face.center[0] - bounds.x) * r.w) / bounds.w;
        const y = ((face.center[1] - bounds.y) * r.h) / bounds.h;
        engrave(context, text, Math.round(x - text.width / 2), Math.round(y - text.height / 2));
    }
    if (pressed) {
        context.globalCompositeOperation = 'source-atop';
        context.fillStyle = 'rgba(24,12,2,0.18)';
        context.fillRect(0, 0, r.w, r.h);
    }
    if (controls.size >= 64) controls.delete(controls.keys().next().value!);
    controls.set(key, canvas);
    return canvas;
}

export function draw_handheld(context: CanvasRenderingContext2D, layout: ShellLayout, held: Set<ButtonId>) {
    const base = base_frame(layout);
    if (!base) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(base, 0, 0);
    const { skin, control } = mapping(layout);
    for (const id of CONTROL_IDS) {
        if (!layout.buttons[id === 'rocker' ? 'left' : id]) continue;
        const r = control(id);
        const direction = id === 'rocker' ? Number(held.has('right')) - Number(held.has('left')) : Number(held.has(id));
        const sprite = control_art(skin, id, r, direction !== 0);
        if (id === 'rocker' && direction) {
            for (let x = 0; x < r.w; x++) {
                const shift = Math.round(direction * (x / (r.w - 1) - 0.5) * 4);
                context.drawImage(sprite, x, 0, 1, r.h, r.x + x, r.y + shift, 1, r.h);
            }
        } else context.drawImage(sprite, r.x, r.y + direction);
    }
}
