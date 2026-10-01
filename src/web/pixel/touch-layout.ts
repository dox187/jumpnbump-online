/** Fit the native-aspect display around comfortable thumb positions and safe utility corners. */
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';

export const BOT_BUTTONS = ['bot1', 'bot2', 'bot3', 'bot4'] as const;
export type ButtonId =
    | 'left'
    | 'right'
    | 'jump'
    | 'back'
    | 'full'
    | 'music'
    | 'effects'
    | 'score'
    | (typeof BOT_BUTTONS)[number];
export type Rect = { x: number; y: number; w: number; h: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type ShellLayout = {
    mode: 'plain' | 'sides' | 'bottom';
    safe: Insets;
    /** Game bounds in CSS pixels; never rounded to the control artwork grid. */
    box: Rect;
    /** All control outlines and icons use this one native pixel size. */
    pixel_scale: number;
    view: { w: number; h: number };
    /** Touch targets and their artwork share integer coordinates on the control grid. */
    buttons: Partial<Record<ButtonId, Rect>>;
};

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const EPSILON = 1e-7;

function fit(area: Rect): Rect {
    const scale = Math.max(0, Math.min(area.w / SCREEN_WIDTH, area.h / SCREEN_HEIGHT));
    const w = SCREEN_WIDTH * scale,
        h = SCREEN_HEIGHT * scale;
    return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** Utility buttons also remain available with a mouse or with movement touch controls switched off. */
function plain_layout(
    area: Rect,
    width: number,
    height: number,
    dpr: number,
    mobile: boolean,
    safe: Insets
): ShellLayout {
    const fit_screen = (space: Rect) => {
        if (mobile) return fit(space);
        const available = Math.min((space.w * dpr) / SCREEN_WIDTH, (space.h * dpr) / SCREEN_HEIGHT);
        const scale = Math.max(0, (available >= 1 ? Math.floor(available) : available) / dpr);
        const w = SCREEN_WIDTH * scale,
            h = SCREEN_HEIGHT * scale;
        return { x: space.x + Math.round((space.w - w) / 2), y: space.y + Math.round((space.h - h) / 2), w, h };
    };
    const scale = Math.max(1, Math.round((mobile ? 2 : 1.5) * dpr)) / dpr;
    const up = (css: number) => Math.ceil(css / scale - EPSILON);
    const down = (css: number) => Math.floor(css / scale + EPSILON);
    const size = up(mobile ? 48 : 36),
        gap = up(8);
    const left = up(area.x) + gap,
        right = down(area.x + area.w) - gap;
    const top = up(area.y) + gap;
    let box = fit_screen(area);
    let buttons: ShellLayout['buttons'];
    const square = (x: number, y: number): Rect => ({ x, y, w: size, h: size });
    if (area.x + area.w - box.x - box.w >= (size + 2 * gap) * scale && area.h >= (3 * size + 4 * gap) * scale) {
        buttons = {
            full: square(right - size, top),
            music: square(right - size, top + size + gap),
            effects: square(right - size, top + 2 * (size + gap)),
        };
    } else {
        const header = (top + size + gap) * scale;
        if (box.y < header) box = fit_screen({ ...area, y: header, h: Math.max(0, area.y + area.h - header) });
        buttons = {
            music: square(left, top),
            effects: square(left + size + gap, top),
            full: square(right - size, top),
        };
    }
    return {
        mode: 'plain',
        safe,
        box,
        buttons,
        pixel_scale: scale,
        view: { w: Math.ceil(width / scale), h: Math.ceil(height / scale) },
    };
}

function base_layout(
    width: number,
    height: number,
    dpr: number,
    mobile: boolean,
    touch: boolean,
    safe: Insets = NO_INSETS
): ShellLayout {
    const area = { x: safe.left, y: safe.top, w: width - safe.left - safe.right, h: height - safe.top - safe.bottom };
    if (!mobile || !touch) return plain_layout(area, width, height, dpr, mobile, safe);

    // One art pixel is about two CSS pixels, always an integer number of physical pixels.
    const scale = Math.max(1, Math.round(2 * dpr)) / dpr;
    const up = (css: number) => Math.ceil(css / scale - EPSILON);
    const down = (css: number) => Math.floor(css / scale + EPSILON);
    const left = up(safe.left),
        right = down(width - safe.right);
    const top = up(safe.top),
        bottom = down(height - safe.bottom);
    const gw = right - left,
        gh = bottom - top;
    const utility = up(48),
        gap = area.w < 280 ? Math.max(2, down(6)) : up(12),
        corner = Math.max(up(4), Math.min(up(12), Math.floor((gw - 4 * utility - 3 * gap) / 2))),
        screen_gap = up(16);
    // Leave room for the grip and system gestures, in addition to the hardware safe area.
    const edge = up(gw * scale < 340 ? 16 : 24);
    const portrait = area.h >= area.w;
    const square = (x: number, y: number, size: number): Rect => ({
        x: Math.round(x),
        y: Math.round(y),
        w: size,
        h: size,
    });
    type Candidate = { mode: 'sides' | 'bottom'; box: Rect; buttons: ShellLayout['buttons'] };
    const candidates: Candidate[] = [];
    const utilities = (stacked: boolean): ShellLayout['buttons'] => ({
        back: square(left + corner, top + corner, utility),
        full: square(right - corner - utility, top + corner, utility),
        music: square(
            left + corner + (stacked ? 0 : utility + gap),
            top + corner + (stacked ? utility + gap : 0),
            utility
        ),
        effects: square(
            right - corner - utility - (stacked ? 0 : utility + gap),
            top + corner + (stacked ? utility + gap : 0),
            utility
        ),
    });

    // A horizontal direction pair on the left, jump on the right. No vertically stacked arrows.
    if (!portrait) {
        const key = up(area.h < 500 ? 56 : 72);
        const start = left + edge + 2 * key + gap + screen_gap;
        const end = right - edge - key - screen_gap;
        const min_y = top + corner + 2 * utility + gap + screen_gap;
        const max_y = bottom - up(32) - key;
        if (end > start && max_y >= min_y) {
            const y = Math.round(Math.max(min_y, Math.min(top + gh * 0.64 - key / 2, max_y)));
            candidates.push({
                mode: 'sides',
                box: fit({ x: start * scale, y: area.y, w: (end - start) * scale, h: area.h }),
                buttons: {
                    ...utilities(true),
                    left: square(left + edge, y, key),
                    right: square(left + edge + key + gap, y, key),
                    jump: square(right - edge - key, y, key),
                },
            });
        }
    }

    // In portrait the thumb row sits around 72% of the safe height, not at the foot of the phone.
    // On wider tablets it leaves a substantial grip margin while preserving more of the game display.
    const key = Math.min(up(72), Math.floor((gw - 2 * edge - gap - up(32)) / 3));
    const lift = up(Math.max(40, Math.min(80, area.h * 0.12)));
    const y = Math.round(
        Math.min(top + gh * (portrait ? 0.72 : 1) - (portrait ? key / 2 : key + lift), bottom - lift - key)
    );
    const movement = {
        left: square(left + edge, y, key),
        right: square(left + edge + key + gap, y, key),
        jump: square(right - edge - key, y, key),
    };
    if (key >= up(48)) {
        const header = top + corner + utility + gap;
        if (gw >= 2 * corner + 4 * utility + 3 * gap && y - screen_gap > header) {
            candidates.push({
                mode: 'bottom',
                box: fit({ x: area.x, y: header * scale, w: area.w, h: (y - screen_gap - header) * scale }),
                buttons: { ...utilities(false), ...movement },
            });
        }
        // Utility corners can use the side margins of a tablet, freeing the top of the game.
        const inset = corner + utility + gap;
        if (!portrait && gw > 2 * inset && y >= top + corner + 2 * utility + gap + screen_gap) {
            candidates.push({
                mode: 'bottom',
                box: fit({
                    x: (left + inset) * scale,
                    y: area.y,
                    w: (gw - 2 * inset) * scale,
                    h: (y - screen_gap) * scale - area.y,
                }),
                buttons: { ...utilities(true), ...movement },
            });
        }
    }
    // Only tiny embedded windows fail to fit seven usable targets with separate grip space.
    if (!candidates.length) return plain_layout(area, width, height, dpr, mobile, safe);
    const best = candidates.reduce((a, b) => (b.box.w > a.box.w + EPSILON ? b : a));
    return { ...best, safe, pixel_scale: scale, view: { w: Math.ceil(width / scale), h: Math.ceil(height / scale) } };
}

/** Add half-size local number keys in free space, leaving the game and existing controls clear. */
export function screen_layout(
    width: number,
    height: number,
    dpr: number,
    mobile: boolean,
    touch: boolean,
    safe: Insets = NO_INSETS,
    bots = false,
    score = false
): ShellLayout {
    let layout = base_layout(width, height, dpr, mobile, touch, safe);
    if (!mobile || (!bots && !score)) return layout;
    const local_buttons: ButtonId[] = [...(bots ? BOT_BUTTONS : []), ...(score ? (['score'] as const) : [])];
    const scale = layout.pixel_scale;
    const size = Math.max(6, Math.floor(layout.buttons.full!.w / 2));
    const gap = Math.ceil(8 / scale);
    const left = Math.ceil(safe.left / scale) + gap;
    const top = Math.ceil(safe.top / scale) + gap;
    const right = Math.floor((width - safe.right) / scale) - gap;
    const bottom = Math.floor((height - safe.bottom) / scale) - gap;
    const obstacles: Rect[] = [
        ...Object.values(layout.buttons),
        { x: layout.box.x / scale, y: layout.box.y / scale, w: layout.box.w / scale, h: layout.box.h / scale },
    ];
    let best: { x: number; y: number; columns: number; score: number } | null = null;
    for (const columns of new Set([local_buttons.length, Math.ceil(local_buttons.length / 2)])) {
        const rows = Math.ceil(local_buttons.length / columns);
        const w = columns * size + (columns - 1) * gap;
        const h = rows * size + (rows - 1) * gap;
        const xs = [
            left,
            right - w,
            ...obstacles.flatMap((r) => [Math.ceil(r.x + r.w + gap), Math.floor(r.x - w - gap)]),
        ];
        const ys = [
            top,
            bottom - h,
            ...obstacles.flatMap((r) => [Math.ceil(r.y + r.h + gap), Math.floor(r.y - h - gap)]),
        ];
        for (const x of xs)
            for (const y of ys) {
                if (x < left || x + w > right || y < top || y + h > bottom) continue;
                if (
                    obstacles.some(
                        (r) => x < r.x + r.w + gap && x + w > r.x - gap && y < r.y + r.h + gap && y + h > r.y - gap
                    )
                )
                    continue;
                const score = (y - top) * 2 + (x - left) * 0.1 + (rows - 1) * size;
                if (!best || score < best.score) best = { x, y, columns, score };
            }
    }
    if (!best) {
        // Very small windows reserve a separate header rather than cover the screen or another key.
        const columns = Math.max(1, Math.min(local_buttons.length, Math.floor((right - left + gap) / (size + gap))));
        const rows = Math.ceil(local_buttons.length / columns);
        layout = base_layout(width, height, dpr, mobile, touch, {
            ...safe,
            top: safe.top + (rows * size + (rows + 1) * gap) * scale,
        });
        layout.safe = safe;
        best = {
            x: Math.round((left + right - columns * size - (columns - 1) * gap) / 2),
            y: top,
            columns,
            score: 0,
        };
    }
    const buttons = { ...layout.buttons };
    local_buttons.forEach((id, slot) => {
        buttons[id] = {
            x: best.x + (slot % best.columns) * (size + gap),
            y: best.y + Math.floor(slot / best.columns) * (size + gap),
            w: size,
            h: size,
        };
    });
    return { ...layout, buttons };
}
