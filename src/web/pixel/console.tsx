/**
 * The frame around the game screen. On a desktop the screen simply sits on black. On a phone held upright,
 * and in landscape when the touch buttons are on, the screen is set into a handheld console carved from
 * wood (a pixel-art Game Boy that fills the whole display), with the touch buttons beside or below the
 * screen so they never cover it. Menu and match use the same 480x288 screen there, so both scale alike.
 */
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { touch_input } from '../../extra-input';
import { touch_enabled, useOnlineSettings } from '../hooks/online-settings';
import { font_ready, layout_text } from './font';

export const SCREEN_W = 480;
export const SCREEN_H = 288;

/** Wood that has been carved away around the screen, in game pixels. */
const BEZEL = 8;
/** Room for the engraved name under the screen (upright). */
const LOGO_H = 30;

export type ButtonId = 'left' | 'right' | 'jump' | 'back' | 'full';
type Rect = { x: number; y: number; w: number; h: number };

export type ShellLayout = {
    mode: 'plain' | 'landscape' | 'portrait';
    /** CSS pixels per game pixel. */
    scale: number;
    /** The whole display in game pixels (handheld modes). */
    view: { w: number; h: number };
    /** The 480x288 screen (handheld modes). */
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

/** The largest whole number of device pixels per game pixel that fits width x height game pixels. */
export function compute_scale(width: number, height: number) {
    if (typeof window === 'undefined') return 1;
    const dpr = window.devicePixelRatio || 1;
    const n = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / width, (window.innerHeight * dpr) / height)));
    return n / dpr;
}

/**
 * CSS pixels per game pixel for a handheld layout. Whole device pixels keep pixel art crisp on ordinary
 * screens; phone screens are dense enough to use every last pixel of width instead.
 */
function handheld_scale(css_per_gp: number) {
    const dpr = window.devicePixelRatio || 1;
    const device = css_per_gp * dpr;
    return (dpr >= 2 ? device : Math.max(1, Math.floor(device))) / dpr;
}

const round = Math.round;

function compute_layout(width: number, height: number, touch: boolean): ShellLayout {
    const empty = { view: { w: 0, h: 0 }, screen: { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, logo: null, speaker: null };
    if (typeof window === 'undefined') return { mode: 'plain', scale: 1, buttons: {}, ...empty };
    const W = window.innerWidth;
    const H = window.innerHeight;
    const portrait = H > W;
    if (!portrait && !touch) return { mode: 'plain', scale: compute_scale(width, height), buttons: {}, ...empty };

    const safe = safe_insets();
    if (portrait) {
        // The screen block (screen, carved bezel, engraving) on top, at least this much room for the buttons below
        const controls_css = Math.min(280, Math.max(190, H * 0.3));
        const fit_w = (W - safe.left - safe.right - 12) / (SCREEN_W + 2 * BEZEL);
        const fit_h = (H - safe.top - safe.bottom - controls_css - 12) / (SCREEN_H + 2 * BEZEL + LOGO_H);
        const scale = handheld_scale(Math.min(fit_w, fit_h));
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
            scale,
            view,
            screen,
            logo,
            speaker: { x: round(view.w - px(96)), y: bottom - px(64), w: px(70), h: px(46) },
            buttons: {
                left: { x: left_cx - arrow - round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
                right: { x: left_cx + round(gap / 2), y: cy - round(arrow / 2), w: arrow, h: arrow },
                jump: { x: right_cx - round(jump / 2), y: cy - round(jump / 2), w: jump, h: jump },
                back: { x: round(view.w / 2) - pill.w - gap, y: pills_y, w: pill.w, h: pill.h },
                full: document.fullscreenEnabled
                    ? { x: round(view.w / 2) + gap, y: pills_y, w: pill.w, h: pill.h }
                    : undefined,
            },
        };
    }

    // Landscape: the screen in the middle, a column of wood with buttons on either side
    const side_css = Math.max(112, W * 0.12);
    const fit_w = (W - safe.left - safe.right - 2 * side_css) / (SCREEN_W + 2 * BEZEL);
    const fit_h = (H - safe.top - safe.bottom - 8) / (SCREEN_H + 2 * BEZEL);
    const scale = handheld_scale(Math.min(fit_w, fit_h));
    const view = { w: W / scale, h: H / scale };
    const px = (css: number) => round(css / scale);
    const screen = { x: round((view.w - SCREEN_W) / 2), y: round((view.h - SCREEN_H) / 2), w: SCREEN_W, h: SCREEN_H };
    const left_col = { x: px(safe.left), w: screen.x - BEZEL - px(safe.left) };
    const right_col = { x: screen.x + SCREEN_W + BEZEL, w: view.w - px(safe.right) - (screen.x + SCREEN_W + BEZEL) };
    const gap = px(8);
    const arrow = Math.max(px(40), Math.min(px(70), round((left_col.w - 3 * gap) / 2)));
    const jump = Math.max(px(56), Math.min(px(100), right_col.w - 2 * gap));
    const pill = { w: Math.min(px(58), left_col.w - 2 * gap), h: px(26) };
    const cy = round(view.h * 0.62);
    const left_cx = left_col.x + round(left_col.w / 2);
    const right_cx = right_col.x + round(right_col.w / 2);
    const pills_y = screen.y + px(6);
    return {
        mode: 'landscape',
        scale,
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

/** The layout for the current window, recomputed on resizes and rotations. */
export function useShellLayout(width: number, height: number): ShellLayout {
    const [settings] = useOnlineSettings();
    const touch = touch_enabled(settings);
    const [layout, setLayout] = useState(() => compute_layout(width, height, touch));
    useEffect(() => {
        const update = () => setLayout(compute_layout(width, height, touch));
        update();
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
        window.visualViewport?.addEventListener('resize', update);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
            window.visualViewport?.removeEventListener('resize', update);
        };
    }, [width, height, touch]);
    return layout;
}

/* ---------- Wood ---------- */

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

/** A repeatable pseudo random number for a pixel. */
function hash(x: number, y: number, seed = 0) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Knot = { x: number; y: number; r: number };

/** The colour of the plain wood at a pixel: wide bands of grain along `u`, a few knots. */
function wood_color(x: number, y: number, along_x: boolean, knots: Knot[]) {
    const u = along_x ? x : y;
    const v = along_x ? y : x;
    let value =
        v +
        10 * Math.sin(u * 0.0055 + 1.3) +
        3.5 * Math.sin(u * 0.019 + v * 0.011) +
        1.2 * Math.sin(u * 0.06 + v * 0.04);
    for (const knot of knots) {
        const dx = (x - knot.x) / (along_x ? 2.6 : 1);
        const dy = (y - knot.y) / (along_x ? 1 : 2.6);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < knot.r) {
            if (d < knot.r * 0.3) return d < knot.r * 0.15 ? WOOD.darker : WOOD.dark;
            value = d * 3.2;
        } else if (d < knot.r * 3) {
            value += (knot.r * 3 - d) * 0.9;
        }
    }
    const ring = (((value / 22) % 1) + 1) % 1;
    const speck = hash(x, y);
    if (speck < 0.003) return WOOD.grain;
    if (ring < 0.045) return WOOD.dark;
    if (ring < 0.1) return WOOD.grain;
    if (ring > 0.42 && ring < 0.5) return WOOD.light;
    if (ring > 0.5 && ring < 0.53) return speck < 0.5 ? WOOD.light : WOOD.base;
    if (ring > 0.74 && ring < 0.77) return WOOD.grain;
    return WOOD.base;
}

/** Inside a rectangle with rounded corners (radii for top-left, top-right, bottom-right, bottom-left). */
function inside_rounded(x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
    const corners: [number, number, number][] = [
        [r[0], r[0], r[0]],
        [w - 1 - r[1], r[1], r[1]],
        [w - 1 - r[2], h - 1 - r[2], r[2]],
        [r[3], h - 1 - r[3], r[3]],
    ];
    for (let i = 0; i < 4; i++) {
        const [cx, cy, radius] = corners[i];
        const in_corner = (i === 0 || i === 3 ? x < cx : x > cx) && (i < 2 ? y < cy : y > cy);
        if (in_corner && (x - cx) ** 2 + (y - cy) ** 2 > radius * radius) return false;
    }
    return x >= 0 && y >= 0 && x < w && y < h;
}

type Painter = {
    set: (x: number, y: number, color: string) => void;
    get: (x: number, y: number) => string | null;
};

/** A rectangle cut into the wood: shadow on the upper and left walls, light on the lower and right ones. */
function carve_rect(p: Painter, r: Rect, depth: number, fill: string | null) {
    for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
            const dl = x - r.x;
            const dt = y - r.y;
            const dr = r.x + r.w - 1 - x;
            const db = r.y + r.h - 1 - y;
            const edge = Math.min(dl, dt, dr, db);
            if (edge >= depth) {
                if (fill) p.set(x, y, fill);
                continue;
            }
            const lit = db === edge || (dr === edge && dt !== edge);
            p.set(x, y, edge === 0 ? (lit ? WOOD.shine : WOOD.outline) : lit ? WOOD.lighter : WOOD.darker);
        }
    }
}

/** A round hollow for a button. */
function carve_round(p: Painter, r: Rect, pad: number) {
    const cx = r.x + r.w / 2 - 0.5;
    const cy = r.y + r.h / 2 - 0.5;
    const rx = r.w / 2 + pad;
    const ry = r.h / 2 + pad;
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
        for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (d > 1) continue;
            const edge = d > 0.82;
            const upper = x - cx + (y - cy) < 0;
            p.set(x, y, edge ? (upper ? WOOD.darker : WOOD.lighter) : upper ? WOOD.stain : WOOD.deep);
        }
    }
}

/** A pill-shaped hollow around a small button. */
function carve_pill(p: Painter, r: Rect) {
    const radius = Math.floor(r.h / 2);
    const radii: [number, number, number, number] = [radius, radius, radius, radius];
    for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
            if (!inside_rounded(x, y, r.w, r.h, radii)) continue;
            const rim = !inside_rounded(x - 1, y, r.w, r.h, radii) || !inside_rounded(x, y - 1, r.w, r.h, radii);
            const lip = !inside_rounded(x + 1, y, r.w, r.h, radii) || !inside_rounded(x, y + 1, r.w, r.h, radii);
            p.set(r.x + x, r.y + y, rim ? WOOD.darker : lip ? WOOD.lighter : WOOD.deep);
        }
    }
}

/** Letters cut into the wood with the game font, each font pixel `zoom` x `zoom` game pixels. */
function engrave(p: Painter, text: string, cx: number, top: number, zoom = 2) {
    if (!font_ready()) return false;
    const { width, items } = layout_text(text);
    const x0 = Math.round(cx - (width * zoom) / 2);
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

/** Paints the whole console body; returns false if the engraving still waits for the font. */
function paint_body(canvas: HTMLCanvasElement, layout: ShellLayout) {
    const w = Math.ceil(layout.view.w);
    const h = Math.ceil(layout.view.h);
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(w, h);
    const colors = new Map<string, number[]>();
    const rgb = (color: string) => {
        let value = colors.get(color);
        if (!value) {
            const n = parseInt(color.slice(1), 16);
            value = [n >> 16, (n >> 8) & 255, n & 255];
            colors.set(color, value);
        }
        return value;
    };
    const painter: Painter = {
        set: (x, y, color) => {
            x = Math.round(x);
            y = Math.round(y);
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const o = (y * w + x) * 4;
            if (!image.data[o + 3]) return;
            const [r, g, b] = rgb(color);
            image.data[o] = r;
            image.data[o + 1] = g;
            image.data[o + 2] = b;
        },
        get: () => null,
    };

    const along_x = layout.mode === 'landscape';
    const knots: Knot[] = [
        { x: Math.round(w * 0.18), y: Math.round(h * 0.82), r: 7 },
        { x: Math.round(w * 0.86), y: Math.round(h * 0.14), r: 5 },
    ];
    const radii: [number, number, number, number] = layout.mode === 'portrait' ? [12, 12, 44, 12] : [20, 20, 20, 20];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!inside_rounded(x, y, w, h, radii)) continue;
            const [r, g, b] = rgb(wood_color(x, y, along_x, knots));
            const o = (y * w + x) * 4;
            image.data[o] = r;
            image.data[o + 1] = g;
            image.data[o + 2] = b;
            image.data[o + 3] = 255;
        }
    }
    // A rounded bevel along the outer edge of the block
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!inside_rounded(x, y, w, h, radii)) continue;
            let edge = 0;
            while (
                edge < 3 &&
                inside_rounded(x - edge - 1, y, w, h, radii) &&
                inside_rounded(x + edge + 1, y, w, h, radii) &&
                inside_rounded(x, y - edge - 1, w, h, radii) &&
                inside_rounded(x, y + edge + 1, w, h, radii)
            )
                edge++;
            if (edge >= 3) continue;
            const lit = !inside_rounded(x - edge - 1, y, w, h, radii) || !inside_rounded(x, y - edge - 1, w, h, radii);
            painter.set(x, y, edge === 0 ? WOOD.outline : lit ? (edge === 1 ? WOOD.shine : WOOD.lighter) : WOOD.darker);
        }
    }

    const s = layout.screen;
    carve_rect(painter, { x: s.x - BEZEL, y: s.y - BEZEL, w: s.w + 2 * BEZEL, h: s.h + 2 * BEZEL }, 2, WOOD.stain);
    // A small red light at the upper left of the bezel, like on the handheld this imitates
    const led = { x: s.x - BEZEL + 3, y: s.y + 10 };
    for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) painter.set(led.x + dx, led.y + dy, dx + dy === 0 ? '#ff9a80' : '#d62818');

    let font_waiting = false;
    if (layout.logo) font_waiting = !engrave(painter, "JUMP 'N BUMP", layout.logo.x + layout.logo.w / 2, layout.logo.y);
    for (const id of ['left', 'right', 'jump'] as const) {
        const r = layout.buttons[id];
        if (r) carve_round(painter, r, 3);
    }
    for (const id of ['back', 'full'] as const) {
        const r = layout.buttons[id];
        if (r) carve_pill(painter, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
    }
    if (layout.speaker) {
        const sp = layout.speaker;
        const slots = 6;
        const slot_gap = Math.max(4, Math.floor(sp.w / slots));
        for (let i = 0; i < slots; i++) {
            for (let t = 0; t < sp.h; t++) {
                const x = sp.x + i * slot_gap + Math.round(t * 0.5);
                const y = sp.y + t;
                painter.set(x, y, WOOD.outline);
                painter.set(x + 1, y, WOOD.deep);
                painter.set(x + 2, y, WOOD.lighter);
            }
        }
    }
    context.putImageData(image, 0, 0);
    return !font_waiting;
}

/* ---------- Buttons ---------- */

const LABELS: Partial<Record<ButtonId, string>> = { jump: 'JUMP', back: 'BACK', full: 'FULL' };

/** A wooden button as pixel art, `size` game pixels, raised or pressed in. */
function paint_button(id: ButtonId, w: number, h: number, pressed: boolean) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const context = canvas.getContext('2d')!;
    const round_button = id === 'jump' || id === 'left' || id === 'right';
    const cx = w / 2 - 0.5;
    const cy = h / 2 - 0.5;
    const r = Math.min(w, h) / 2;
    const corner = Math.round(h / 2.2);
    const inside = (x: number, y: number) =>
        round_button
            ? (x - cx) ** 2 + (y - cy) ** 2 <= r * r
            : inside_rounded(x, y, w, h, [corner, corner, corner, corner]);
    const bevel = Math.max(2, Math.round(Math.min(w, h) / 14));
    const put = (x: number, y: number, color: string) => {
        context.fillStyle = color;
        context.fillRect(x, y, 1, 1);
    };
    const face = id === 'jump' ? ['#c83a22', '#e0664a', '#8a2010'] : [WOOD.light, WOOD.shine, WOOD.darker];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!inside(x, y)) continue;
            // Distance to the outline, looking a few pixels up-left and down-right
            let edge = false;
            let lit = false;
            let dark = false;
            for (let k = 1; k <= bevel; k++) {
                if (!inside(x, y - k) || !inside(x - k, y)) lit = true;
                if (!inside(x, y + k) || !inside(x + k, y)) dark = true;
            }
            if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) edge = true;
            let color = face[0];
            if (edge) color = WOOD.outline;
            else if (lit && !dark) color = pressed ? face[2] : face[1];
            else if (dark && !lit) color = pressed ? face[1] : face[2];
            else if (hash(x, y, id.length) < 0.05) color = face[2];
            put(x, y, color);
        }
    }
    const shift = pressed ? 1 : 0;
    const ink = id === 'jump' ? '#5a1008' : WOOD.stain;
    const hilite = id === 'jump' ? '#f08a70' : WOOD.shine;
    if (id === 'left' || id === 'right') {
        // A carved arrow
        const size = Math.round(Math.min(w, h) * 0.22);
        const half = Math.round(size / 2);
        // A triangle with its tip towards the direction and a flat back
        const arrow_pixels = (paint: (x: number, y: number) => void) => {
            for (let dy = -size; dy <= size; dy++) {
                const from = Math.abs(dy);
                for (let d = from; d <= size; d++) {
                    const x = Math.round(cx) + (id === 'left' ? -half + d : half - d) + shift;
                    paint(x, Math.round(cy) + dy + shift);
                }
            }
        };
        arrow_pixels((x, y) => put(x + 1, y + 1, hilite));
        arrow_pixels((x, y) => put(x, y, ink));
    }
    const label = LABELS[id];
    if (label && font_ready()) {
        const { width, items } = layout_text(label);
        const x0 = Math.round(cx - width / 2) + shift;
        const y0 = Math.round(cy - 5) + shift;
        for (const pass of [0, 1]) {
            for (const { glyph, x } of items) {
                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (glyph.data[gy * glyph.width + gx] < 4) continue;
                        const px = x0 + x + gx + (pass === 0 ? 1 : 0);
                        const py = y0 + glyph.top + gy + (pass === 0 ? 1 : 0);
                        put(px, py, pass === 0 ? hilite : ink);
                    }
                }
            }
        }
    }
    return canvas;
}

function ButtonSprite({ id, rect, pressed }: { id: ButtonId; rect: Rect; pressed: boolean }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [font, setFont] = useState(font_ready());
    useEffect(() => {
        if (font) return;
        const timer = setInterval(() => font_ready() && setFont(true), 300);
        return () => clearInterval(timer);
    }, [font]);
    const sprites = useMemo(
        () => [paint_button(id, rect.w, rect.h, false), paint_button(id, rect.w, rect.h, true)],
        [id, rect.w, rect.h, font]
    );
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const source = sprites[pressed ? 1 : 0];
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d')!.drawImage(source, 0, 0);
    }, [sprites, pressed]);
    return (
        <div
            className="gp-touch-button"
            data-button={id}
            aria-hidden="true"
            style={{
                left: `calc(var(--px) * ${rect.x})`,
                top: `calc(var(--px) * ${rect.y})`,
                width: `calc(var(--px) * ${rect.w})`,
                height: `calc(var(--px) * ${rect.h})`,
            }}
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
            const { buttons, scale } = layoutRef.current;
            const slack = 8;
            for (const [id, r] of Object.entries(buttons) as [ButtonId, Rect | undefined][]) {
                if (!r) continue;
                if (
                    x >= r.x * scale - slack &&
                    x <= (r.x + r.w) * scale + slack &&
                    y >= r.y * scale - slack &&
                    y <= (r.y + r.h) * scale + slack
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
        const release = () => {
            pointers.clear();
            apply();
        };
        element.addEventListener('pointerdown', down);
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', up);
        element.addEventListener('pointercancel', up);
        window.addEventListener('blur', release);
        document.addEventListener('visibilitychange', release);
        return () => {
            element.removeEventListener('pointerdown', down);
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', up);
            element.removeEventListener('pointercancel', up);
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
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        if (paint_body(canvas, layout)) return;
        // The engraving needs the game font, which the page loads with the other graphics
        const timer = setInterval(() => {
            if (font_ready() && paint_body(canvas, layout)) clearInterval(timer);
        }, 300);
        return () => clearInterval(timer);
    }, [layout]);
    return (
        <canvas
            ref={ref}
            className="gp-body"
            aria-hidden="true"
            style={{
                width: `calc(var(--px) * ${Math.ceil(layout.view.w)})`,
                height: `calc(var(--px) * ${Math.ceil(layout.view.h)})`,
            }}
        />
    );
}

/**
 * The screen of `width` x `height` game pixels with its frame. `stageRef` gets the element the content is
 * laid out in.
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
    /** CSS variables for the pixel components (--px is set here). */
    style: (scale: number) => JSX.CSSProperties;
    stageRef?: Ref<HTMLDivElement>;
    children: ComponentChildren;
}) {
    const layout = useShellLayout(width, height);
    const root = useRef<HTMLDivElement>(null);
    // Prerendered pages are hydrated without fixing attributes, so the layout (which depends on the window)
    // is only rendered once the page runs in the browser
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return <div className="gp-root" />;
    const stage_style = {
        width: `calc(var(--px) * ${width})`,
        height: `calc(var(--px) * ${height})`,
    };

    if (layout.mode === 'plain') {
        return (
            <div className="gp-root" style={style(layout.scale)} data-scale={layout.scale}>
                <div ref={stageRef} className="gp-stage" style={stage_style}>
                    {children}
                </div>
            </div>
        );
    }
    const s = layout.screen;
    return (
        <div ref={root} className="gp-root gp-handheld" style={style(layout.scale)} data-scale={layout.scale}>
            <WoodBody layout={layout} />
            <div
                className="gp-screen"
                style={{
                    left: `calc(var(--px) * ${s.x})`,
                    top: `calc(var(--px) * ${s.y})`,
                    width: `calc(var(--px) * ${s.w})`,
                    height: `calc(var(--px) * ${s.h})`,
                }}
            >
                <div
                    ref={stageRef}
                    className="gp-stage"
                    style={{
                        ...stage_style,
                        position: 'absolute',
                        left: `calc(var(--px) * ${(SCREEN_W - width) / 2})`,
                        top: `calc(var(--px) * ${(SCREEN_H - height) / 2})`,
                        margin: 0,
                    }}
                >
                    {children}
                </div>
            </div>
            <TouchControls layout={layout} root={root} />
        </div>
    );
}
