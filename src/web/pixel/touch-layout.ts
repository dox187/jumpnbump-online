/** Maximize the native-aspect display while keeping every touch target outside it. */
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';

export type ButtonId = 'left' | 'right' | 'jump' | 'back' | 'full';
export type Rect = { x: number; y: number; w: number; h: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type ShellLayout = {
    mode: 'plain' | 'sides' | 'bottom' | 'compact';
    /** Game bounds in CSS pixels; never rounded to the control artwork grid. */
    box: Rect;
    /** All control outlines and icons use this one native pixel size. */
    pixel_scale: number;
    view: { w: number; h: number };
    /** Touch targets and their artwork share integer coordinates on the control grid. */
    buttons: Partial<Record<ButtonId, Rect>>;
};

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const MIN_TARGET = 48;
const PREFERRED_TARGET = 72;
const GAP = 6;
const EPSILON = 1e-7;

function fit(area: Rect): Rect {
    const scale = Math.max(0, Math.min(area.w / SCREEN_WIDTH, area.h / SCREEN_HEIGHT));
    const w = SCREEN_WIDTH * scale,
        h = SCREEN_HEIGHT * scale;
    return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

export function screen_layout(
    width: number,
    height: number,
    dpr: number,
    mobile: boolean,
    touch: boolean,
    safe: Insets = NO_INSETS
): ShellLayout {
    const area = { x: safe.left, y: safe.top, w: width - safe.left - safe.right, h: height - safe.top - safe.bottom };
    const plain = (box: Rect): ShellLayout => ({
        mode: 'plain',
        box,
        pixel_scale: 1,
        view: { w: 0, h: 0 },
        buttons: {},
    });
    if (!mobile) {
        const available = Math.min((width * dpr) / SCREEN_WIDTH, (height * dpr) / SCREEN_HEIGHT);
        const scale = (available >= 1 ? Math.floor(available) : available) / dpr;
        const w = SCREEN_WIDTH * scale,
            h = SCREEN_HEIGHT * scale;
        return plain({ x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h });
    }
    if (!touch) return plain(fit(area));

    // One art pixel is about two CSS pixels, always an integer number of physical pixels.
    const scale = Math.max(1, Math.round(2 * dpr)) / dpr;
    const up = (css: number) => Math.ceil(css / scale - EPSILON);
    const down = (css: number) => Math.floor(css / scale + EPSILON);
    const left = up(safe.left),
        right = down(width - safe.right),
        top = up(safe.top),
        bottom = down(height - safe.bottom);
    const key = up(MIN_TARGET),
        preferred = up(PREFERRED_TARGET),
        gap = up(GAP);
    const grid_w = right - left,
        grid_h = bottom - top;
    type Candidate = { mode: 'sides' | 'bottom' | 'compact'; rows: number; box: Rect };
    const candidates: Candidate[] = [];
    for (const rows of [1, 2]) {
        const columns = rows === 1 ? 5 : 3;
        const limit = (bottom - rows * (key + gap)) * scale;
        if (grid_w >= columns * key + (columns - 1) * gap && limit > area.y)
            candidates.push({ mode: 'bottom', rows, box: fit({ ...area, h: limit - area.y }) });
    }
    if (grid_h >= 3 * key + 2 * gap && grid_w > 2 * (key + gap)) {
        const start = (left + key + gap) * scale;
        const end = (right - key - gap) * scale;
        candidates.push({ mode: 'sides', rows: 0, box: fit({ ...area, x: start, w: end - start }) });
    }
    // Short, narrow viewports can keep the utility keys beside the game and the three movement keys below.
    if (grid_w >= 3 * key + 2 * gap && grid_h >= 2 * key + gap) {
        const start = (left + key + gap) * scale;
        const end = (right - key - gap) * scale;
        candidates.push({
            mode: 'compact',
            rows: 1,
            box: fit({ x: start, y: area.y, w: end - start, h: (bottom - key - gap) * scale - area.y }),
        });
    }
    // A very small embedded viewport may not fit five usable touch targets at all.
    if (!candidates.length) return plain(fit(area));
    const best = candidates.reduce((a, b) => (b.box.w > a.box.w + EPSILON ? b : a));
    const { box, mode } = best;
    const buttons: ShellLayout['buttons'] = {};
    const square = (x: number, y: number, size: number): Rect => ({
        x: Math.round(x),
        y: Math.round(y),
        w: size,
        h: size,
    });
    if (mode === 'sides') {
        const left_end = down(box.x) - gap,
            right_start = up(box.x + box.w) + gap;
        const left_w = left_end - left,
            right_w = right - right_start;
        const pad = Math.min(gap, Math.floor((grid_h - 3 * key - 2 * gap) / 2));
        const utility_y = top + pad;
        const main_top = utility_y + key + gap,
            main_bottom = bottom - pad;
        const horizontal = left_w >= 2 * key + gap;
        const size = Math.min(
            preferred,
            horizontal ? Math.floor((left_w - gap) / 2) : left_w,
            horizontal ? main_bottom - main_top : Math.floor((main_bottom - main_top - gap) / 2)
        );
        const group_w = horizontal ? size * 2 + gap : size;
        const group_h = horizontal ? size : size * 2 + gap;
        const center_y = Math.max(main_top + group_h / 2, Math.min(top + grid_h * 0.67, main_bottom - group_h / 2));
        const x = left + Math.floor((left_w - group_w) / 2),
            y = Math.round(center_y - group_h / 2);
        buttons.left = square(x, y, size);
        buttons.right = square(x + (horizontal ? size + gap : 0), y + (horizontal ? 0 : size + gap), size);
        const jump = Math.min(preferred, right_w, main_bottom - main_top);
        buttons.jump = square(right_start + Math.floor((right_w - jump) / 2), center_y - jump / 2, jump);
        buttons.back = square(left + Math.floor((left_w - key) / 2), utility_y, key);
        buttons.full = square(right_start + Math.floor((right_w - key) / 2), utility_y, key);
    } else if (mode === 'compact') {
        const size = Math.min(
            preferred,
            Math.floor((grid_w - 2 * gap) / 3),
            bottom - Math.max(up(box.y + box.h), top + key) - gap
        );
        buttons.left = square(left, bottom - size, size);
        buttons.right = square(left + size + gap, bottom - size, size);
        buttons.jump = square(right - size, bottom - size, size);
        buttons.back = square(left, top, key);
        buttons.full = square(right - key, top, key);
    } else {
        const screen_bottom = up(box.y + box.h);
        const rows = best.rows;
        const columns = rows === 1 ? 5 : 3;
        const pad = Math.min(gap, Math.floor((grid_w - columns * key - (columns - 1) * gap) / 2));
        const x0 = left + pad,
            x1 = right - pad;
        const utility_space = rows === 1 ? 2 * key + 4 * gap : 2 * gap;
        const row_bottom = rows === 1 ? bottom : bottom - key - gap;
        // Enlarge the movement keys only into space the maximum-size screen already leaves unused.
        const size = Math.min(preferred, Math.floor((x1 - x0 - utility_space) / 3), row_bottom - screen_bottom - gap);
        const y = row_bottom - size;
        buttons.left = square(x0, y, size);
        buttons.right = square(x0 + size + gap, y, size);
        buttons.jump = square(x1 - size, y, size);
        const center = rows === 1 ? (buttons.right.x + size + buttons.jump.x) / 2 : (left + right) / 2;
        const utility_y = rows === 1 ? y + Math.floor((size - key) / 2) : bottom - key;
        const utility_x = Math.round(center - (key * 2 + gap) / 2);
        buttons.back = square(utility_x, utility_y, key);
        buttons.full = square(utility_x + key + gap, utility_y, key);
    }
    return {
        mode,
        box,
        pixel_scale: scale,
        view: { w: Math.ceil(width / scale), h: Math.ceil(height / scale) },
        buttons,
    };
}
