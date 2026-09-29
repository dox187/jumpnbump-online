/**
 * The game's own bitmap font (font.gob), extended with a few hand-drawn glyphs and synthesized accents,
 * rendered into canvases with a choice of colour ramps.
 *
 * Glyph pixels are intensities 1-10 (the original stores them as palette indices 241-250, a grey ramp
 * that fades into black), so any colour can be applied by mapping the intensity onto a ramp.
 */
import type { Gob } from '../../assets';

/** Rows above the cap height that accents may use. */
const TOP = 2;
/** The row where capital letters start in a canvas from render_text. */
export const CAPS_TOP = TOP;
/** Height of a line in game pixels: accents, caps, x-height and descenders. */
export const LINE_HEIGHT = 15;
const SPACE_WIDTH = 4;
const LETTER_SPACING = 1;

const GOB_CHARS = '!"\'(),-./0123456789:;@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~äâÄÂöÖ';

type Glyph = {
    width: number;
    height: number;
    /** Row of the glyph's first line, relative to the top of the caps. */
    top: number;
    /** Intensity 0-10 per pixel. */
    data: Uint8Array;
};

/** Hand-drawn glyphs the original font lacks; digits are intensities, '.' is empty. */
const EXTRA_GLYPHS: Record<string, { top: number; rows: string[] }> = {
    '?': {
        top: 1,
        rows: [
            '..38a83',
            '.4a748a',
            '.46..6a',
            '.....a8',
            '...39a2',
            '...8a4.',
            '..3a4..',
            '.......',
            '.4a4...',
            '.5a3...',
        ],
    },
    '+': { top: 4, rows: ['...6a.', '...8a.', '6aaaa8', '.8a...', '.a8...'] },
    '=': { top: 5, rows: ['.6aaa8', '......', '8aaa6.'] },
    _: { top: 10, rows: ['6aaaa6'] },
    '<': { top: 4, rows: ['...36', '.39a3', '8a6..', '.8a61', '..36.'] },
    '>': { top: 4, rows: ['.63..', '.3a93', '...a8', '16a8.', '.63..'] },
    '*': { top: 2, rows: ['..6a.', '8a8a6', '.9a8.', '6a.a6'] },
    '#': { top: 3, rows: ['...a.a.', '.8aaaa8', '..a.a..', '.a.a...', '8aaaa8.', '.a.a...'] },
    '&': { top: 1, rows: ['...6a6.', '..a8.a.', '..8a8..', '.6a6a.a', '.a8.8a.', '8a88a8.', '.6a6.a.'] },
    '%': { top: 1, rows: ['.6a..a', '.a6.a.', '...a..', '..a.6a', '.a..a6'] },
    '|': { top: 1, rows: ['..a', '..a', '.a8', '.a.', '.a.', '8a.', 'a..', 'a..', 'a..'] },
    /** Password dot. */
    '\u2022': { top: 4, rows: ['.6a6', '6aaa', 'aaa6', '6a6.'] },
};

const ACUTE = ['..6a', '.8a2'];
const DOUBLE_ACUTE = ['..6a.6a', '.8a28a2'];
const DIAERESIS = ['.6a.6a'];

/** Accented letters built from a base glyph and an accent drawn above it. */
const ACCENTED: Record<string, [base: string, accent: string[]]> = {
    á: ['a', ACUTE],
    é: ['e', ACUTE],
    í: ['i', ACUTE],
    ó: ['o', ACUTE],
    ú: ['u', ACUTE],
    ő: ['o', DOUBLE_ACUTE],
    ű: ['u', DOUBLE_ACUTE],
    ü: ['u', DIAERESIS],
    Á: ['A', ACUTE],
    É: ['E', ACUTE],
    Í: ['I', ACUTE],
    Ó: ['O', ACUTE],
    Ú: ['U', ACUTE],
    Ő: ['O', DOUBLE_ACUTE],
    Ű: ['U', DOUBLE_ACUTE],
    Ü: ['U', DIAERESIS],
};

export type TextColor = 'white' | 'gold' | 'green' | 'red' | 'blue' | 'dim' | 'wood';

/** [darkest, brightest] colours of each ramp. */
const RAMPS: Record<TextColor, [number[], number[]]> = {
    white: [
        [24, 20, 16],
        [255, 250, 235],
    ],
    gold: [
        [40, 20, 0],
        [255, 214, 72],
    ],
    green: [
        [8, 28, 0],
        [182, 255, 74],
    ],
    red: [
        [40, 0, 0],
        [255, 104, 84],
    ],
    blue: [
        [0, 14, 40],
        [150, 204, 255],
    ],
    dim: [
        [16, 14, 12],
        [150, 140, 125],
    ],
    wood: [
        [30, 14, 2],
        [226, 170, 96],
    ],
};

let glyphs: Map<string, Glyph> | null = null;
const ramp_cache = new Map<TextColor, Uint8ClampedArray>();

function parse_rows(rows: string[], top: number): Glyph {
    const width = Math.max(...rows.map((r) => r.length));
    const data = new Uint8Array(width * rows.length);
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const c = row[x];
            if (c !== '.') data[y * width + x] = parseInt(c, 16);
        }
    });
    return { width, height: rows.length, top, data };
}

function with_accent(base: Glyph, accent: string[], is_i: boolean): Glyph {
    const mark = parse_rows(accent, 0);
    const lowercase = base.top >= 3;
    // Lowercase accents sit in the ascender space, capital accents above the caps
    const accent_top = lowercase ? 0 : -TOP;
    const top = Math.min(base.top, accent_top);
    let body = base;
    if (is_i) {
        // Drop the dot of the i before placing the accent
        const cut = 3;
        body = { ...base, top: base.top + cut, height: base.height - cut, data: base.data.slice(cut * base.width) };
    }
    const width = Math.max(body.width, mark.width + Math.max(0, Math.floor((body.width - mark.width) / 2) + 1));
    const height = Math.max(body.top + body.height, accent_top + mark.height) - top;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < body.height; y++) {
        for (let x = 0; x < body.width; x++) data[(y + body.top - top) * width + x] = body.data[y * body.width + x];
    }
    const offset = Math.max(0, Math.floor((body.width - mark.width) / 2) + 1);
    for (let y = 0; y < mark.height; y++) {
        for (let x = 0; x < mark.width; x++) {
            const v = mark.data[y * mark.width + x];
            if (v) data[(y + accent_top - top) * width + x + offset] = v;
        }
    }
    return { width, height, top, data };
}

/** Builds the glyph table from the game's font.gob. */
export function init_font(font: Gob) {
    const table = new Map<string, Glyph>();
    for (let i = 0; i < GOB_CHARS.length && i < font.num_images; i++) {
        const width = font.width[i];
        const height = font.height[i];
        const data = new Uint8Array(width * height);
        const source = font.data[i];
        for (let p = 0; p < data.length; p++) data[p] = source[p] ? Math.max(0, source[p] - 240) : 0;
        table.set(GOB_CHARS[i], { width, height, top: -font.hs_y[i], data });
    }
    for (const [ch, def] of Object.entries(EXTRA_GLYPHS)) table.set(ch, parse_rows(def.rows, def.top));
    for (const [ch, [base, accent]] of Object.entries(ACCENTED)) {
        const glyph = table.get(base);
        if (glyph) table.set(ch, with_accent(glyph, accent, base === 'i'));
    }
    table.set('[', table.get('(')!);
    table.set(']', table.get(')')!);
    table.set('`', table.get("'")!);
    glyphs = table;
}

export function font_ready() {
    return glyphs !== null;
}

/** Maps a character to one the font can draw: strips unknown accents, falls back to '?'. */
function resolve(ch: string): string {
    if (!glyphs || glyphs.has(ch) || ch === ' ') return ch;
    const plain = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (plain && glyphs.has(plain[0])) return plain[0];
    return '?';
}

export type TextLayout = { width: number; items: { glyph: Glyph; x: number }[] };

export function layout_text(text: string): TextLayout {
    const items: TextLayout['items'] = [];
    let x = 0;
    for (const raw of text) {
        const ch = resolve(raw);
        if (ch === ' ' || !glyphs) {
            x += SPACE_WIDTH;
            continue;
        }
        const glyph = glyphs.get(ch)!;
        items.push({ glyph, x });
        x += glyph.width + LETTER_SPACING;
    }
    return { width: Math.max(0, x - (items.length ? LETTER_SPACING : 0)), items };
}

export function text_width(text: string) {
    return layout_text(text).width;
}

/** Breaks text into lines of at most `max_width` game pixels, at spaces where possible. */
export function wrap_text(text: string, max_width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (text_width(candidate) <= max_width) {
            line = candidate;
            continue;
        }
        if (line) lines.push(line);
        line = text_width(word) <= max_width ? word : fit_text(word, max_width);
    }
    if (line) lines.push(line);
    return lines;
}

/** Cuts text so that it fits into `max_width` game pixels, adding '..' when shortened. */
export function fit_text(text: string, max_width: number) {
    if (text_width(text) <= max_width) return text;
    let cut = text;
    while (cut.length > 0 && text_width(cut + '..') > max_width) cut = cut.slice(0, -1);
    return cut + '..';
}

function ramp(color: TextColor): Uint8ClampedArray {
    let table = ramp_cache.get(color);
    if (!table) {
        const [dark, bright] = RAMPS[color];
        table = new Uint8ClampedArray(11 * 4);
        for (let k = 1; k <= 10; k++) {
            const t = Math.pow(k / 10, 0.8);
            for (let c = 0; c < 3; c++) table[k * 4 + c] = dark[c] + (bright[c] - dark[c]) * t;
            table[k * 4 + 3] = 255;
        }
        ramp_cache.set(color, table);
    }
    return table;
}

/** Draws text into a new canvas at native resolution (one canvas pixel per game pixel). */
export function render_text(text: string, color: TextColor, shadow = false): HTMLCanvasElement {
    const { width, items } = layout_text(text);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width + (shadow ? 1 : 0));
    canvas.height = LINE_HEIGHT + (shadow ? 1 : 0);
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    const colors = ramp(color);
    const put = (px: number, py: number, k: number, is_shadow: boolean) => {
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
        const o = (py * canvas.width + px) * 4;
        if (is_shadow) {
            if (image.data[o + 3]) return;
            image.data[o] = image.data[o + 1] = image.data[o + 2] = 0;
            image.data[o + 3] = 200;
            return;
        }
        image.data[o] = colors[k * 4];
        image.data[o + 1] = colors[k * 4 + 1];
        image.data[o + 2] = colors[k * 4 + 2];
        image.data[o + 3] = 255;
    };
    for (const { glyph, x } of items) {
        for (let y = 0; y < glyph.height; y++) {
            for (let gx = 0; gx < glyph.width; gx++) {
                const k = glyph.data[y * glyph.width + gx];
                if (k) put(x + gx, y + glyph.top + TOP, k, false);
            }
        }
    }
    if (shadow) {
        for (const { glyph, x } of items) {
            for (let y = 0; y < glyph.height; y++) {
                for (let gx = 0; gx < glyph.width; gx++) {
                    if (glyph.data[y * glyph.width + gx] >= 4) put(x + gx + 1, y + glyph.top + TOP + 1, 0, true);
                }
            }
        }
    }
    context.putImageData(image, 0, 0);
    return canvas;
}
