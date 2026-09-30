/**
 * The frame around the game screen. The screen is always 4:3, like the monitors the game was made for: the
 * 400x256 game fills it with slightly tall pixels, as it did on a CRT, and the menu uses the same pixel shape.
 *
 * On a computer the screen sits on black. On phones and tablets it is set into a handheld console carved from
 * wood (a pixel-art Game Boy that fills the whole display) when held upright, and in landscape when the touch
 * buttons are on; the touch buttons sit beside or below the screen so they never cover it.
 */
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { touch_input } from '../../extra-input';
import { is_mobile_device, touch_enabled, useOnlineSettings } from '../hooks/online-settings';
import { font_ready, layout_text } from './font';

/** The screen of the handheld, in body pixels: 4:3. */
const SCREEN_W = 480;
const SCREEN_H = 360;

/** Wood that has been carved away around the screen, in body pixels. */
const BEZEL = 8;
/** Room for the engraved name under the screen (upright). */
const LOGO_H = 30;

export type ButtonId = 'left' | 'right' | 'jump' | 'back' | 'full';
type Rect = { x: number; y: number; w: number; h: number };

export type ShellLayout = {
    mode: 'plain' | 'landscape' | 'portrait';
    /** The 4:3 screen in CSS pixels, and where it is on the page. */
    box: Rect;
    /** CSS pixels per body pixel of the wooden frame (handheld modes). */
    body_scale: number;
    /** The whole display in body pixels (handheld modes). */
    view: { w: number; h: number };
    /** The screen in body pixels (handheld modes). */
    screen: Rect;
    logo: Rect | null;
    speaker: Rect | null;
    buttons: Partial<Record<ButtonId, Rect>>;
};

type Insets = { top: number; right: number; bottom: number; left: number };

/** The safe area of phones with notches and rounded corners, in CSS pixels. */
function safe_insets(): Insets {
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const insets = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
    };
    probe.remove();
    return insets;
}

/** Rounds CSS pixels down to whole device pixels. */
function device_floor(css: number) {
    const dpr = window.devicePixelRatio || 1;
    return Math.floor(css * dpr) / dpr;
}

const round = Math.round;
const NO_FRAME = { body_scale: 1, view: { w: 0, h: 0 }, screen: { x: 0, y: 0, w: 0, h: 0 }, logo: null, speaker: null };

function compute_layout(touch: boolean): ShellLayout {
    if (typeof window === 'undefined') {
        return { mode: 'plain', box: { x: 0, y: 0, w: 640, h: 480 }, buttons: {}, ...NO_FRAME };
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const mobile = is_mobile_device();
    const portrait = H > W;
    if (!mobile || (!portrait && !touch)) {
        // The largest 4:3 screen that fits
        const w = device_floor(Math.min(W, (H * 4) / 3));
        const h = device_floor((w * 3) / 4);
        return { mode: 'plain', box: { x: (W - w) / 2, y: (H - h) / 2, w, h }, buttons: {}, ...NO_FRAME };
    }

    const safe = safe_insets();
    if (portrait) {
        // The screen block (screen, carved bezel, engraving) on top, at least this much room for the buttons below
        const controls_css = touch ? Math.min(280, Math.max(190, H * 0.3)) : 60;
        const fit_w = (W - safe.left - safe.right - 12) / (SCREEN_W + 2 * BEZEL);
        const fit_h = (H - safe.top - safe.bottom - controls_css - 12) / (SCREEN_H + 2 * BEZEL + LOGO_H);
        const scale = Math.min(fit_w, fit_h);
        const view = { w: W / scale, h: H / scale };
        const px = (css: number) => round(css / scale);
        const screen = {
            x: round((view.w - SCREEN_W) / 2),
            y: px(safe.top) + BEZEL + px(10),
            w: SCREEN_W,
            h: SCREEN_H,
        };
        const logo = { x: screen.x, y: screen.y + SCREEN_H + BEZEL + 5, w: SCREEN_W, h: LOGO_H - 8 };
        const top = screen.y + SCREEN_H + BEZEL + LOGO_H;
        const bottom = Math.floor(view.h - px(safe.bottom) - 6);
        const area = bottom - top;
        const pill = { w: px(58), h: px(26) };
        const arrow = Math.min(px(80), round(view.w * 0.21));
        const jump = Math.min(px(112), round(view.w * 0.3));
        const gap = px(8);
        const cy = top + round((area - pill.h - px(16)) * 0.45);
        const left_cx = round(view.w * 0.27);
        const right_cx = round(view.w * 0.74);
        const pills_y = bottom - pill.h - px(10);
        return {
            mode: 'portrait',
            box: { x: screen.x * scale, y: screen.y * scale, w: SCREEN_W * scale, h: SCREEN_H * scale },
            body_scale: scale,
            view,
            screen,
            logo,
            speaker: { x: round(view.w - px(96)), y: bottom - px(64), w: px(70), h: px(46) },
            buttons: touch
                ? {
                      left: { x: left_cx - arrow - round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
                      right: { x: left_cx + round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
                      jump: { x: right_cx - round(jump / 2), y: cy - round(jump / 2), w: jump, h: jump },
                      back: { x: round(view.w / 2) - pill.w - gap, y: pills_y, w: pill.w, h: pill.h },
                      full: document.fullscreenEnabled
                          ? { x: round(view.w / 2) + gap, y: pills_y, w: pill.w, h: pill.h }
                          : undefined,
                  }
                : {},
        };
    }

    // Landscape: the screen in the middle, a column of wood with buttons on either side
    const side_css = Math.max(112, W * 0.12);
    const fit_w = (W - safe.left - safe.right - 2 * side_css) / (SCREEN_W + 2 * BEZEL);
    const fit_h = (H - safe.top - safe.bottom - 8) / (SCREEN_H + 2 * BEZEL);
    const scale = Math.min(fit_w, fit_h);
    const view = { w: W / scale, h: H / scale };
    const px = (css: number) => round(css / scale);
    const screen = { x: round((view.w - SCREEN_W) / 2), y: round((view.h - SCREEN_H) / 2), w: SCREEN_W, h: SCREEN_H };
    const left_col = { x: px(safe.left), w: screen.x - BEZEL - px(safe.left) };
    const right_col = { x: screen.x + SCREEN_W + BEZEL, w: view.w - px(safe.right) - (screen.x + SCREEN_W + BEZEL) };
    const gap = px(8);
    const arrow = Math.max(px(40), Math.min(px(72), round((left_col.w - 3 * gap) / 2)));
    const jump = Math.max(px(56), Math.min(px(104), right_col.w - 2 * gap));
    const pill = { w: Math.min(px(58), left_col.w - 2 * gap), h: px(26) };
    const cy = round(view.h * 0.62);
    const left_cx = left_col.x + round(left_col.w / 2);
    const right_cx = right_col.x + round(right_col.w / 2);
    const pills_y = screen.y + px(6);
    return {
        mode: 'landscape',
        box: { x: screen.x * scale, y: screen.y * scale, w: SCREEN_W * scale, h: SCREEN_H * scale },
        body_scale: scale,
        view,
        screen,
        logo: null,
        speaker: null,
        buttons: {
            left: { x: left_cx - arrow - round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
            right: { x: left_cx + round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
            jump: { x: right_cx - round(jump / 2), y: cy - round(jump / 2), w: jump, h: jump },
            back: { x: left_cx - round(pill.w / 2), y: pills_y, w: pill.w, h: pill.h },
            full: document.fullscreenEnabled
                ? { x: right_cx - round(pill.w / 2), y: pills_y, w: pill.w, h: pill.h }
                : undefined,
        },
    };
}

/** The layout for the current window; recomputed once a resize or rotation has settled. */
export function useShellLayout(): ShellLayout {
    const [settings] = useOnlineSettings();
    const touch = touch_enabled(settings);
    const [layout, setLayout] = useState(() => compute_layout(touch));
    useEffect(() => {
        let timer = 0;
        let late = 0;
        const update = () => setLayout(compute_layout(touch));
        // A rotation fires a burst of resize events; lay out once when they stop
        const schedule = () => {
            clearTimeout(timer);
            timer = window.setTimeout(update, 80);
        };
        // Some phones report the new size only a moment after the rotation event
        const rotated = () => {
            schedule();
            clearTimeout(late);
            late = window.setTimeout(update, 400);
        };
        update();
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', rotated);
        return () => {
            clearTimeout(timer);
            clearTimeout(late);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('orientationchange', rotated);
        };
    }, [touch]);
    return layout;
}

/* ---------- Pixels ---------- */

const WOOD = {
    outline: '#120802',
    deep: '#2a1506',
    stain: '#3a2210',
    darker: '#5a3210',
    dark: '#74461f',
    grain: '#8e5a2c',
    base: '#a06634',
    light: '#b8783e',
    lighter: '#c48648',
    shine: '#e0a868',
};

const packed_colors = new Map<string, number>();
/** A colour as one little-endian RGBA word for a Uint32Array view of ImageData. */
function pack(color: string) {
    let value = packed_colors.get(color);
    if (value === undefined) {
        const n = parseInt(color.slice(1), 16);
        value = (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
        packed_colors.set(color, value);
    }
    return value;
}

/** A repeatable pseudo random number for a pixel. */
function hash(x: number, y: number, seed = 0) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Radii = [number, number, number, number];

/**
 * How far a pixel is inside a w x h rectangle with rounded corners (top-left, top-right, bottom-right,
 * bottom-left), and whether that nearest edge faces up-left (lit) or down-right (shaded). Negative: outside.
 */
function edge_of(x: number, y: number, w: number, h: number, r: Radii): [distance: number, lit: boolean] {
    let cx = -1;
    let cy = -1;
    let radius = 0;
    if (x < r[0] && y < r[0]) [cx, cy, radius] = [r[0], r[0], r[0]];
    else if (x > w - 1 - r[1] && y < r[1]) [cx, cy, radius] = [w - 1 - r[1], r[1], r[1]];
    else if (x > w - 1 - r[2] && y > h - 1 - r[2]) [cx, cy, radius] = [w - 1 - r[2], h - 1 - r[2], r[2]];
    else if (x < r[3] && y > h - 1 - r[3]) [cx, cy, radius] = [r[3], h - 1 - r[3], r[3]];
    if (radius > 0) return [radius - Math.hypot(x - cx, y - cy), x - cx + (y - cy) < 0];
    const left = x;
    const top = y;
    const right = w - 1 - x;
    const bottom = h - 1 - y;
    const d = Math.min(left, top, right, bottom);
    return [d, d === left || d === top];
}

/** A pixel canvas written through a Uint32Array; `set` ignores pixels outside it or already transparent. */
class Pixels {
    readonly data: Uint32Array;
    constructor(
        readonly image: ImageData,
        readonly w: number,
        readonly h: number
    ) {
        this.data = new Uint32Array(image.data.buffer);
    }
    set(x: number, y: number, color: string) {
        x = round(x);
        y = round(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = y * this.w + x;
        if (this.data[i]) this.data[i] = pack(color);
    }
    /** Like set, also on transparent pixels. */
    put(x: number, y: number, color: string) {
        x = round(x);
        y = round(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        this.data[y * this.w + x] = pack(color);
    }
}

/* ---------- Wood ---------- */

const SINE_SIZE = 4096;
const SINE = Float32Array.from({ length: SINE_SIZE }, (_, i) => Math.sin((i / SINE_SIZE) * Math.PI * 2));
const fast_sin = (x: number) => SINE[((x * (SINE_SIZE / (Math.PI * 2))) | 0) & (SINE_SIZE - 1)];

type Knot = { x: number; y: number; r: number };

/** Fills the body with wood: wide bands of grain along the long side, a few knots. */
function paint_wood(p: Pixels, along_x: boolean, radii: Radii) {
    const { w, h } = p;
    const knots: Knot[] = [
        { x: round(w * 0.18), y: round(h * 0.82), r: 7 },
        { x: round(w * 0.86), y: round(h * 0.14), r: 5 },
    ];
    const tones = {
        dark: pack(WOOD.dark),
        grain: pack(WOOD.grain),
        base: pack(WOOD.base),
        light: pack(WOOD.light),
    };
    const long = along_x ? w : h;
    const wave = new Float32Array(long);
    for (let u = 0; u < long; u++) wave[u] = 10 * Math.sin(u * 0.0055 + 1.3);
    const corner = Math.max(...radii);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if ((x < corner || x >= w - corner) && (y < corner || y >= h - corner) && edge_of(x, y, w, h, radii)[0] < 0)
                continue;
            const u = along_x ? x : y;
            const v = along_x ? y : x;
            let value = v + wave[u] + 3.5 * fast_sin(u * 0.019 + v * 0.011) + 1.2 * fast_sin(u * 0.06 + v * 0.04);
            let color = -1;
            for (const knot of knots) {
                const kx = (x - knot.x) / (along_x ? 2.6 : 1);
                const ky = (y - knot.y) / (along_x ? 1 : 2.6);
                if (Math.abs(kx) > knot.r * 3 || Math.abs(ky) > knot.r * 3) continue;
                const d = Math.sqrt(kx * kx + ky * ky);
                if (d < knot.r * 0.3) color = d < knot.r * 0.15 ? pack(WOOD.darker) : tones.dark;
                else if (d < knot.r) value = d * 3.2;
                else if (d < knot.r * 3) value += (knot.r * 3 - d) * 0.9;
            }
            if (color < 0) {
                const ring = (((value / 22) % 1) + 1) % 1;
                const speck = hash(x, y);
                if (speck < 0.003) color = tones.grain;
                else if (ring < 0.045) color = tones.dark;
                else if (ring < 0.1) color = tones.grain;
                else if (ring > 0.42 && ring < 0.5) color = tones.light;
                else if (ring > 0.5 && ring < 0.53) color = speck < 0.5 ? tones.light : tones.base;
                else if (ring > 0.74 && ring < 0.77) color = tones.grain;
                else color = tones.base;
            }
            p.data[y * w + x] = color;
        }
    }
    // The rounded bevel along the outer edge of the block
    const bevel = (x: number, y: number) => {
        const [d, lit] = edge_of(x, y, w, h, radii);
        if (d < 0 || d >= 3) return;
        p.set(x, y, d < 1 ? WOOD.outline : lit ? (d < 2 ? WOOD.shine : WOOD.lighter) : WOOD.darker);
    };
    const band = corner + 3;
    for (let y = 0; y < h; y++) {
        if (y < band || y >= h - band) for (let x = 0; x < w; x++) bevel(x, y);
        else {
            for (let x = 0; x < 3; x++) bevel(x, y);
            for (let x = w - 3; x < w; x++) bevel(x, y);
        }
    }
}

/** A rectangular ring cut into the wood: shadow on the upper and left walls, light on the lower and right. */
function carve_frame(p: Pixels, r: Rect, depth: number, width: number) {
    for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
            const dl = x - r.x;
            const dt = y - r.y;
            const dr = r.x + r.w - 1 - x;
            const db = r.y + r.h - 1 - y;
            const edge = Math.min(dl, dt, dr, db);
            if (edge >= width) {
                x = r.x + r.w - width - 1;
                continue;
            }
            if (edge >= depth) {
                p.set(x, y, WOOD.stain);
                continue;
            }
            const lit = db === edge || (dr === edge && dt !== edge);
            p.set(x, y, edge === 0 ? (lit ? WOOD.shine : WOOD.outline) : lit ? WOOD.lighter : WOOD.darker);
        }
    }
}

/** A round hollow for a button. */
function carve_round(p: Pixels, r: Rect, pad: number) {
    const cx = r.x + r.w / 2 - 0.5;
    const cy = r.y + r.h / 2 - 0.5;
    const rx = r.w / 2 + pad;
    const ry = r.h / 2 + pad;
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
        for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (d > 1) continue;
            const upper = x - cx + (y - cy) < 0;
            p.set(x, y, d > 0.82 ? (upper ? WOOD.darker : WOOD.lighter) : upper ? WOOD.stain : WOOD.deep);
        }
    }
}

/** A pill-shaped hollow around a small button. */
function carve_pill(p: Pixels, r: Rect) {
    const radius = Math.floor(r.h / 2);
    const radii: Radii = [radius, radius, radius, radius];
    for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
            const [d, lit] = edge_of(x, y, r.w, r.h, radii);
            if (d < 0) continue;
            p.set(r.x + x, r.y + y, d < 1 ? (lit ? WOOD.darker : WOOD.lighter) : WOOD.deep);
        }
    }
}

/** Letters cut into the wood with the game font, each font pixel `zoom` x `zoom` body pixels. */
function engrave(p: Pixels, text: string, cx: number, top: number, zoom = 2) {
    if (!font_ready()) return false;
    const { width, items } = layout_text(text);
    const x0 = round(cx - (width * zoom) / 2);
    for (const pass of [0, 1]) {
        for (const { glyph, x } of items) {
            for (let gy = 0; gy < glyph.height; gy++) {
                for (let gx = 0; gx < glyph.width; gx++) {
                    if (glyph.data[gy * glyph.width + gx] < 4) continue;
                    for (let zy = 0; zy < zoom; zy++) {
                        for (let zx = 0; zx < zoom; zx++) {
                            const px = x0 + (x + gx) * zoom + zx;
                            const py = top + (glyph.top + gy) * zoom + zy;
                            if (pass === 0) p.set(px + 1, py + 1, WOOD.shine);
                            else p.set(px, py, WOOD.stain);
                        }
                    }
                }
            }
        }
    }
    return true;
}

const body_cache = new Map<string, ImageData>();

/** The whole console body as an image; null while the engraving still waits for the font. */
function body_image(layout: ShellLayout): ImageData | null {
    const w = Math.ceil(layout.view.w);
    const h = Math.ceil(layout.view.h);
    const key = JSON.stringify([w, h, layout.mode, layout.screen, layout.logo, layout.speaker, layout.buttons]);
    const cached = body_cache.get(key);
    if (cached) return cached;
    if (layout.logo && !font_ready()) return null;

    const image = new ImageData(w, h);
    const p = new Pixels(image, w, h);
    const radii: Radii = layout.mode === 'portrait' ? [12, 12, 44, 12] : [20, 20, 20, 20];
    paint_wood(p, layout.mode === 'landscape', radii);

    const s = layout.screen;
    carve_frame(p, { x: s.x - BEZEL, y: s.y - BEZEL, w: s.w + 2 * BEZEL, h: s.h + 2 * BEZEL }, 2, BEZEL + 1);
    // A small red light at the upper left of the bezel, like on the handheld this imitates
    for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++)
            p.set(s.x - BEZEL + 3 + dx, s.y + 10 + dy, dx + dy === 0 ? '#ff9a80' : '#d62818');
    if (layout.logo) engrave(p, "JUMP 'N BUMP", layout.logo.x + layout.logo.w / 2, layout.logo.y);
    for (const id of ['left', 'right', 'jump'] as const) {
        const r = layout.buttons[id];
        if (r) carve_round(p, r, 3);
    }
    for (const id of ['back', 'full'] as const) {
        const r = layout.buttons[id];
        if (r) carve_pill(p, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
    }
    if (layout.speaker) {
        const sp = layout.speaker;
        const slots = 6;
        const slot_gap = Math.max(4, Math.floor(sp.w / slots));
        for (let i = 0; i < slots; i++) {
            for (let t = 0; t < sp.h; t++) {
                const x = sp.x + i * slot_gap + round(t * 0.5);
                p.set(x, sp.y + t, WOOD.outline);
                p.set(x + 1, sp.y + t, WOOD.deep);
                p.set(x + 2, sp.y + t, WOOD.lighter);
            }
        }
    }
    if (body_cache.size > 6) body_cache.delete(body_cache.keys().next().value!);
    body_cache.set(key, image);
    return image;
}

/* ---------- Buttons ---------- */

const LABELS: Partial<Record<ButtonId, string>> = { jump: 'JUMP', back: 'BACK', full: 'FULL' };
const button_cache = new Map<string, HTMLCanvasElement>();

/** A wooden (or red) button as pixel art, raised or pressed in. */
function button_sprite(id: ButtonId, w: number, h: number, pressed: boolean) {
    const font = font_ready();
    const key = `${id}|${w}|${h}|${pressed}|${font}`;
    const cached = button_cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const image = new ImageData(canvas.width, canvas.height);
    const p = new Pixels(image, canvas.width, canvas.height);
    const round_button = id === 'jump' || id === 'left' || id === 'right';
    const cx = w / 2 - 0.5;
    const cy = h / 2 - 0.5;
    const r = Math.min(w, h) / 2;
    const corner = round(h / 2.2);
    const radii: Radii = [corner, corner, corner, corner];
    const bevel = Math.max(2, round(Math.min(w, h) / 14));
    const face = id === 'jump' ? ['#c83a22', '#e0664a', '#8a2010'] : [WOOD.light, WOOD.shine, WOOD.darker];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let d: number;
            let lit: boolean;
            if (round_button) {
                d = r - Math.hypot(x - cx, y - cy);
                lit = x - cx + (y - cy) < 0;
            } else [d, lit] = edge_of(x, y, w, h, radii);
            if (d < 0) continue;
            let color = face[0];
            if (d < 1) color = WOOD.outline;
            else if (d < bevel) color = lit !== pressed ? face[1] : face[2];
            else if (hash(x, y, id.length) < 0.05) color = face[2];
            p.put(x, y, color);
        }
    }
    const shift = pressed ? 1 : 0;
    const ink = id === 'jump' ? '#5a1008' : WOOD.stain;
    const hilite = id === 'jump' ? '#f08a70' : WOOD.shine;
    if (id === 'left' || id === 'right') {
        // A carved triangle with its tip towards the direction and a flat back
        const size = round(Math.min(w, h) * 0.22);
        const half = round(size / 2);
        for (const [offset, color] of [
            [1, hilite],
            [0, ink],
        ] as const) {
            for (let dy = -size; dy <= size; dy++) {
                for (let d = Math.abs(dy); d <= size; d++) {
                    const x = round(cx) + (id === 'left' ? -half + d : half - d) + shift;
                    p.set(x + offset, round(cy) + dy + shift + offset, color);
                }
            }
        }
    }
    const label = LABELS[id];
    if (label && font) {
        const { width, items } = layout_text(label);
        const x0 = round(cx - width / 2) + shift;
        const y0 = round(cy - 5) + shift;
        for (const pass of [0, 1]) {
            for (const { glyph, x } of items) {
                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (glyph.data[gy * glyph.width + gx] < 4) continue;
                        const offset = pass === 0 ? 1 : 0;
                        p.set(x0 + x + gx + offset, y0 + glyph.top + gy + offset, pass === 0 ? hilite : ink);
                    }
                }
            }
        }
    }
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    if (button_cache.size > 40) button_cache.delete(button_cache.keys().next().value!);
    button_cache.set(key, canvas);
    return canvas;
}

/** Positions in body pixels as CSS. */
const bp = (n: number) => `calc(var(--bp) * ${n})`;

function useFontReady() {
    const [ready, setReady] = useState(font_ready());
    useEffect(() => {
        if (ready) return;
        const timer = setInterval(() => font_ready() && setReady(true), 300);
        return () => clearInterval(timer);
    }, [ready]);
    return ready;
}

function ButtonSprite({ id, rect, pressed }: { id: ButtonId; rect: Rect; pressed: boolean }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const font = useFontReady();
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const source = button_sprite(id, rect.w, rect.h, pressed);
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d')!.drawImage(source, 0, 0);
    }, [id, rect.w, rect.h, pressed, font]);
    return (
        <div
            className="gp-touch-button"
            data-button={id}
            aria-hidden="true"
            style={{ left: bp(rect.x), top: bp(rect.y), width: bp(rect.w), height: bp(rect.h) }}
        >
            <canvas ref={ref} />
        </div>
    );
}

/** Like a tap on ESC; held for a few frames, since the original game looks at the key state once a frame. */
function press_escape() {
    const key = (type: string) =>
        window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
    key('keydown');
    setTimeout(() => key('keyup'), 100);
}

function toggle_fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** The touch buttons: several fingers at once, and a finger may slide from one button to another. */
function TouchControls({ layout, root }: { layout: ShellLayout; root: { current: HTMLDivElement | null } }) {
    const [held, setHeld] = useState<Set<ButtonId>>(new Set());
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    useEffect(() => {
        const element = root.current;
        if (!element) return;
        const pointers = new Map<number, ButtonId>();
        const hit = (x: number, y: number): ButtonId | null => {
            const { buttons, body_scale } = layoutRef.current;
            const slack = 8;
            for (const [id, r] of Object.entries(buttons) as [ButtonId, Rect | undefined][]) {
                if (!r) continue;
                if (
                    x >= r.x * body_scale - slack &&
                    x <= (r.x + r.w) * body_scale + slack &&
                    y >= r.y * body_scale - slack &&
                    y <= (r.y + r.h) * body_scale + slack
                )
                    return id;
            }
            return null;
        };
        const apply = () => {
            const now = new Set(pointers.values());
            touch_input.left = now.has('left');
            touch_input.right = now.has('right');
            touch_input.jump = now.has('jump');
            setHeld(now);
        };
        const down = (event: PointerEvent) => {
            const id = hit(event.clientX, event.clientY);
            if (!id) return;
            event.preventDefault();
            pointers.set(event.pointerId, id);
            if (id === 'back') press_escape();
            if (id === 'full') toggle_fullscreen();
            apply();
        };
        const move = (event: PointerEvent) => {
            const current = pointers.get(event.pointerId);
            if (!current || current === 'back' || current === 'full') return;
            const id = hit(event.clientX, event.clientY);
            // Slide between the movement buttons; leaving them releases
            const next = id === 'left' || id === 'right' || id === 'jump' ? id : null;
            if (next === current) return;
            if (next) pointers.set(event.pointerId, next);
            else pointers.delete(event.pointerId);
            apply();
        };
        const up = (event: PointerEvent) => {
            if (pointers.delete(event.pointerId)) apply();
        };
        // No magnifier, text selection or long-press menu on the buttons
        const touch_start = (event: TouchEvent) => {
            if ((event.target as Element | null)?.closest?.('.gp-touch-button')) event.preventDefault();
        };
        const release = () => {
            pointers.clear();
            apply();
        };
        element.addEventListener('pointerdown', down);
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', up);
        element.addEventListener('pointercancel', up);
        element.addEventListener('touchstart', touch_start, { passive: false });
        window.addEventListener('blur', release);
        document.addEventListener('visibilitychange', release);
        return () => {
            element.removeEventListener('pointerdown', down);
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', up);
            element.removeEventListener('pointercancel', up);
            element.removeEventListener('touchstart', touch_start);
            window.removeEventListener('blur', release);
            document.removeEventListener('visibilitychange', release);
            touch_input.left = touch_input.right = touch_input.jump = false;
        };
    }, []);

    return (
        <>
            {(Object.entries(layout.buttons) as [ButtonId, Rect | undefined][]).map(
                ([id, rect]) => rect && <ButtonSprite key={id} id={id} rect={rect} pressed={held.has(id)} />
            )}
        </>
    );
}

function WoodBody({ layout }: { layout: ShellLayout }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const font = useFontReady();
    useLayoutEffect(() => {
        const canvas = ref.current;
        const image = body_image(layout);
        if (!canvas || !image) return;
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d')!.putImageData(image, 0, 0);
    }, [layout, font]);
    return (
        <canvas
            ref={ref}
            className="gp-body"
            aria-hidden="true"
            style={{ width: bp(Math.ceil(layout.view.w)), height: bp(Math.ceil(layout.view.h)) }}
        />
    );
}

/** No long-press menu (copy, search, image search) anywhere in the game, except in text fields. */
function block_context_menu(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();
}

/**
 * The 4:3 screen showing content of `width` x `height` game pixels, with its frame. `style` gives the CSS
 * variables of the pixel components for a scale (CSS pixels per game pixel); `stageRef` gets the element
 * the content is laid out in.
 */
export function Shell({
    width,
    height,
    style,
    stageRef,
    children,
}: {
    width: number;
    height: number;
    style: (scale: number) => JSX.CSSProperties;
    stageRef?: Ref<HTMLDivElement>;
    children: ComponentChildren;
}) {
    const layout = useShellLayout();
    const root = useRef<HTMLDivElement>(null);
    // Prerendered pages are hydrated without fixing attributes, so the layout (which depends on the window)
    // is only rendered once the page runs in the browser
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    useEffect(() => {
        const element = root.current;
        if (!element) return;
        element.addEventListener('contextmenu', block_context_menu);
        return () => element.removeEventListener('contextmenu', block_context_menu);
    }, [mounted, layout.mode]);
    const content = useMemo(() => {
        const px = layout.box.w / width;
        // Game pixels are drawn a little taller than wide, so that the content fills the 4:3 screen
        const stretch = layout.box.h / height / px;
        return { px, stretch };
    }, [layout.box.w, layout.box.h, width, height]);
    if (!mounted) return <div className="gp-root" />;

    const stage = (
        <div
            ref={stageRef}
            className="gp-stage"
            style={{
                ...style(content.px),
                width: `${width * content.px}px`,
                height: `${height * content.px}px`,
                transform: `scaleY(${content.stretch})`,
            }}
        >
            {children}
        </div>
    );
    const box = layout.box;
    if (layout.mode === 'plain') {
        return (
            <div ref={root} className="gp-root">
                <div
                    className="gp-screen"
                    style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
                >
                    {stage}
                </div>
            </div>
        );
    }
    return (
        <div
            ref={root}
            className="gp-root gp-handheld"
            style={{ '--bp': `${layout.body_scale}px` } as JSX.CSSProperties}
        >
            <WoodBody layout={layout} />
            <div
                className="gp-screen"
                style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
            >
                {stage}
            </div>
            <TouchControls layout={layout} root={root} />
        </div>
    );
}
