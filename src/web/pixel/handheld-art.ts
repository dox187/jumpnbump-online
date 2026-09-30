/** Illustrated wooden shells and controls, composed on one native pixel grid. */
import { engrave, logo_engraving, name_engraving } from './engraving';
import type { ButtonId, ShellLayout } from './console';
import portrait_url from './handheld-art/portrait.png';
import landscape_url from './handheld-art/landscape.png';
import wood_url from './handheld-art/wood-material.png';
import logo_url from './handheld-art/original-logo.png';

type Rect = { x: number; y: number; w: number; h: number };
type Point = [number, number];
type ControlId = 'rocker' | 'jump' | 'back' | 'full';
type SpriteId = ControlId | 'left' | 'right';
type Control = {
    bounds: Rect;
    outline: Point[];
    /** Optical center and tilt of the front wood face, excluding the button's thick lower edge. */
    label?: { center: Point; angle: number };
};
type Skin = {
    url: string;
    controls: Record<ControlId, Control>;
};
const CONTROL_IDS: ControlId[] = ['rocker', 'jump', 'back', 'full'];
const PORTRAIT: Skin = {
    url: portrait_url,
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

/** Touch targets stay at least 48 CSS pixels across, independently of the game and artwork scales. */
export function artwork_buttons(layout: ShellLayout): ShellLayout['buttons'] {
    const { screen, view, insets, body_scale } = layout;
    const px = (css: number) => Math.ceil(css / body_scale);
    const key = px(48),
        gap = px(6);
    const left = insets.left,
        right = view.w - insets.right;
    const top = insets.top,
        bottom = view.h - insets.bottom;
    const rect = (x: number, y: number, w: number, h: number): Rect => ({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
    });
    if (layout.mode === 'landscape') {
        const left_rail = screen.x - left,
            right_rail = right - screen.x - screen.w;
        const rail = Math.floor(Math.min(left_rail, right_rail)) - gap * 2;
        const left_x = (w: number) => left + Math.max(0, Math.floor((left_rail - w) / 2));
        const right_x = (w: number) => right - w - Math.max(0, Math.floor((right_rail - w) / 2));
        const utility_y = top + Math.max(gap, Math.floor((bottom - top) * 0.08));
        const main_top = utility_y + key + gap;
        const main_bottom = bottom - gap;
        const center = (height: number) =>
            Math.max(main_top + height / 2, Math.min(top + (bottom - top) * 0.61, main_bottom - height / 2));
        let directions: ShellLayout['buttons'];
        if (rail >= key * 2) {
            const w = Math.min(px(176), rail),
                half = Math.floor(w / 2);
            const h = Math.max(key, Math.min(main_bottom - main_top, Math.round((w * 68) / 101)));
            directions = {
                left: rect(left_x(w), center(h) - h / 2, half, h),
                right: rect(left_x(w) + half, center(h) - h / 2, w - half, h),
            };
        } else {
            // Each half of the wooden rocker becomes a separate key on a narrow 16:9 side rail.
            // Only the few pixels needed for the minimum target may extend over the edge of the screen.
            const w = Math.max(key, Math.min(px(64), rail));
            const h = Math.max(
                key,
                Math.min(Math.round((w * 68) / 51), Math.floor((main_bottom - main_top - gap) / 2))
            );
            const y = center(h * 2 + gap);
            directions = {
                left: rect(left_x(w), y - h - gap / 2, w, h),
                right: rect(left_x(w), y + gap / 2, w, h),
            };
        }
        const jump_w = Math.max(key, Math.min(px(104), rail));
        const jump_h = Math.max(key, Math.min(main_bottom - main_top, Math.round((jump_w * 76) / 88)));
        const utility_w = Math.max(key, Math.min(px(84), rail));
        return {
            ...directions,
            jump: rect(right_x(jump_w), center(jump_h) - jump_h / 2, jump_w, jump_h),
            back: rect(left_x(utility_w), utility_y, utility_w, key),
            full: rect(right_x(utility_w), utility_y, utility_w, key),
        };
    }

    const start = Math.ceil(screen.y + screen.h);
    const available = bottom - start;
    const compact = available < px(150);
    const utility_w = px(76);
    const main_h = Math.min(px(112), available - (compact ? gap * 2 : key + gap * 4));
    const rocker_w = Math.min(Math.floor((right - left) * 0.54), Math.round((main_h * 123) / 67), px(208));
    const rocker_h = Math.max(key, Math.round((rocker_w * 67) / 123));
    const jump_h = Math.min(main_h, px(112)),
        jump_w = Math.max(key, Math.round((jump_h * 62) / 84));
    const height = Math.max(rocker_h, jump_h);
    const y = start + Math.max(gap, Math.floor((available - height - (compact ? 0 : key + gap * 2)) / 2));
    const half = Math.floor(rocker_w / 2);
    const center = (left + right) / 2;
    const utility_y = compact ? start + Math.floor((available - key) / 2) : y + height + gap * 2;
    return {
        left: rect(left + gap, y + (height - rocker_h) / 2, half, rocker_h),
        right: rect(left + gap + half, y + (height - rocker_h) / 2, rocker_w - half, rocker_h),
        jump: rect(right - gap - jump_w, y + (height - jump_h) / 2, jump_w, jump_h),
        back: rect(center - utility_w - gap, utility_y, utility_w, key),
        full: rect(center + gap, utility_y, utility_w, key),
    };
}

const sources = new Map<Skin, Map<SpriteId, HTMLCanvasElement>>();
let wood: HTMLImageElement | null = null;
let logo: HTMLCanvasElement | null = null;
let loading: Promise<void> | null = null;
export function art_ready() {
    return sources.size === 2 && logo !== null && wood !== null;
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
            load_image(wood_url).then((image) => {
                wood = image;
            }),
            ...[PORTRAIT, LANDSCAPE].map(async (skin) => {
                const atlas = await load_image(skin.url);
                const controls = new Map<SpriteId, HTMLCanvasElement>(
                    CONTROL_IDS.map((id) => [id, sprite(atlas, skin.controls[id])])
                );
                const rocker = controls.get('rocker')!;
                const split = Math.floor(rocker.width / 2);
                for (const id of ['left', 'right'] as const) {
                    const half = document.createElement('canvas');
                    half.width = id === 'left' ? split : rocker.width - split;
                    half.height = rocker.height;
                    half.getContext('2d')!.drawImage(rocker, id === 'left' ? 0 : -split, 0);
                    controls.set(id, half);
                }
                sources.set(skin, controls);
                prepare_controls(skin);
            }),
        ]).then(() => {});
    return loading;
}

const frames = new Map<string, HTMLCanvasElement>();
function base_frame(layout: ShellLayout) {
    const key = JSON.stringify([layout.mode, layout.view, layout.screen, layout.insets]);
    const cached = frames.get(key);
    if (cached) return cached;
    if (!wood || !logo) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layout.view.w;
    canvas.height = layout.view.h;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    // One continuous material at native size: a short header reveals a strip instead of squashing a tree.
    // Large tablets extend it by reflection, keeping both the edge colours and the pixel size continuous.
    for (let y = 0; y < canvas.height; y += wood.height)
        for (let x = 0; x < canvas.width; x += wood.width) {
            const flip_x = (x / wood.width) % 2 !== 0;
            const flip_y = (y / wood.height) % 2 !== 0;
            context.save();
            context.translate(x + (flip_x ? wood.width : 0), y + (flip_y ? wood.height : 0));
            context.scale(flip_x ? -1 : 1, flip_y ? -1 : 1);
            context.drawImage(wood, 0, 0);
            context.restore();
        }
    // The canvas sits over the screen so compact touch keys remain visible at its edges.
    context.clearRect(layout.screen.x, layout.screen.y, layout.screen.w, layout.screen.h);
    // Keep the decorative logo only when there is a real header, without reserving space for it.
    const w = Math.min(55, layout.screen.w - 12);
    const h = Math.round((w * logo.height) / logo.width);
    const x = Math.round(layout.screen.x + (layout.screen.w - w) / 2);
    const header = layout.screen.y - layout.insets.top;
    if (header >= h + 6) {
        const y = layout.insets.top + Math.floor((header - h) / 2);
        engrave(context, logo_engraving(logo, w, h), x, y);
    }
    if (frames.size >= 8) frames.delete(frames.keys().next().value!);
    frames.set(key, canvas);
    return canvas;
}

type ControlVariant = { normal: HTMLCanvasElement; pressed: HTMLCanvasElement };
const controls = new Map<Skin, Map<SpriteId, ControlVariant[]>>();

/** Prepare smaller native sprites once. Never enlarge source texels or resize a sprite while drawing it. */
function prepare_controls(skin: Skin) {
    const variants = new Map<SpriteId, ControlVariant[]>();
    for (const [id, source] of sources.get(skin)!) {
        const longest = Math.max(source.width, source.height);
        const sizes = new Set([longest]);
        for (let size = 16; size < longest; size += 2) sizes.add(size);
        const sprites: ControlVariant[] = [];
        for (const size of [...sizes].sort((a, b) => b - a)) {
            const normal = document.createElement('canvas');
            normal.width = Math.round((source.width * size) / longest);
            normal.height = Math.round((source.height * size) / longest);
            const context = normal.getContext('2d')!;
            context.imageSmoothingEnabled = false;
            context.drawImage(source, 0, 0, normal.width, normal.height);
            const control = id === 'left' || id === 'right' ? skin.controls.rocker : skin.controls[id];
            if (control.label) {
                const { center, angle } = control.label;
                const text = name_engraving(id, angle);
                const x = ((center[0] - control.bounds.x) * normal.width) / control.bounds.w;
                const y = ((center[1] - control.bounds.y) * normal.height) / control.bounds.h;
                engrave(context, text, Math.round(x - text.width / 2), Math.round(y - text.height / 2));
            }
            const pressed = document.createElement('canvas');
            pressed.width = normal.width;
            pressed.height = normal.height;
            const down = pressed.getContext('2d')!;
            down.drawImage(normal, 0, 0);
            down.globalCompositeOperation = 'source-atop';
            down.fillStyle = 'rgba(24,12,2,0.18)';
            down.fillRect(0, 0, pressed.width, pressed.height);
            sprites.push({ normal, pressed });
        }
        variants.set(id, sprites);
    }
    controls.set(skin, variants);
}

export function draw_handheld(context: CanvasRenderingContext2D, layout: ShellLayout, held: Set<ButtonId>) {
    const base = base_frame(layout);
    if (!base) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(base, 0, 0);
    const skin = skin_for(layout);
    const { left, right } = layout.buttons;
    const draw = (id: SpriteId, target: Rect) => {
        const variant = controls
            .get(skin)
            ?.get(id)
            ?.find(({ normal }) => normal.width <= target.w && normal.height <= target.h);
        if (!variant) return;
        const direction = id === 'rocker' ? Number(held.has('right')) - Number(held.has('left')) : Number(held.has(id));
        const sprite = direction ? variant.pressed : variant.normal;
        const { width: w, height: h } = sprite;
        const x = Math.round(target.x + (target.w - w) / 2),
            y = Math.round(target.y + (target.h - h) / 2);
        if (id === 'rocker' && direction) {
            for (let column = 0; column < w; column++) {
                const shift = Math.round(direction * (column / (w - 1) - 0.5) * 4);
                context.drawImage(sprite, column, 0, 1, h, x + column, y + shift, 1, h);
            }
        } else context.drawImage(sprite, x, y + direction);
    };
    if (left && right) {
        if (left.y === right.y) draw('rocker', { ...left, w: left.w + right.w });
        else {
            draw('left', left);
            draw('right', right);
        }
    }
    for (const id of ['jump', 'back', 'full'] as const) if (layout.buttons[id]) draw(id, layout.buttons[id]);
}
