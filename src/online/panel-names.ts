import { SCREEN_WIDTH } from '../constants';
import { panel_name_layouts } from './panel-layouts';
export const PANEL_NAME_WIDTH = 35;

/** Compact pixel outlines; the renderer varies their height and lean like the hand-lettered panel names. */
const LETTERS: Record<string, string> = {
    A: '0110/1001/1001/1111/1001/1001',
    B: '1110/1001/1110/1001/1001/1110',
    C: '0111/1000/1000/1000/1000/0111',
    D: '1110/1001/1001/1001/1001/1110',
    E: '1111/1000/1110/1000/1000/1111',
    F: '1111/1000/1110/1000/1000/1000',
    G: '0111/1000/1000/1011/1001/0111',
    H: '1001/1001/1111/1001/1001/1001',
    I: '111/010/010/010/010/111',
    J: '001/001/001/001/101/010',
    K: '1001/1010/1100/1010/1001/1001',
    L: '1000/1000/1000/1000/1000/1111',
    M: '10001/11011/10101/10001/10001/10001',
    N: '1001/1101/1101/1011/1011/1001',
    O: '0110/1001/1001/1001/1001/0110',
    P: '1110/1001/1001/1110/1000/1000',
    Q: '0110/1001/1001/1001/1011/0111',
    R: '1110/1001/1001/1110/1010/1001',
    S: '0111/1000/0110/0001/0001/1110',
    T: '11111/00100/00100/00100/00100/00100',
    U: '1001/1001/1001/1001/1001/0110',
    V: '10001/10001/10001/01010/01010/00100',
    W: '10001/10001/10001/10101/11011/10001',
    X: '1001/1001/0110/0110/1001/1001',
    Y: '10001/01010/00100/00100/00100/00100',
    Z: '1111/0001/0010/0100/1000/1111',
    '0': '0110/1001/1011/1101/1001/0110',
    '1': '010/110/010/010/010/111',
    '2': '0110/1001/0001/0010/0100/1111',
    '3': '1110/0001/0110/0001/0001/1110',
    '4': '1001/1001/1111/0001/0001/0001',
    '5': '1111/1000/1110/0001/0001/1110',
    '6': '0111/1000/1110/1001/1001/0110',
    '7': '1111/0001/0010/0100/0100/0100',
    '8': '0110/1001/0110/1001/1001/0110',
    '9': '0110/1001/1001/0111/0001/1110',
    '.': '0/0/0/0/0/1',
    '-': '000/000/111/000/000/000',
    _: '000/000/000/000/000/111',
    '!': '1/1/1/1/0/1',
    '?': '110/001/010/010/000/010',
    ' ': '00/00/00/00/00/00',
};

/** The flat panel material, rather than a single sample that may land on a letter or a portrait. */
function panel_color(pixels: Uint8ClampedArray, top: number, left: number, first: number, right: number, last: number) {
    const counts = new Uint16Array(256);
    let color = 0;
    for (let y = first; y <= last; y++) {
        for (let x = left; x <= right; x++) {
            const pixel = pixels[(top + y) * SCREEN_WIDTH + 352 + x];
            if (++counts[pixel] > counts[color]) color = pixel;
        }
    }
    return color;
}

/** Remove the baked-in labels in palette space, retaining the portraits, stone edges and score recesses. */
export function clear_panel_names(pixels: Uint8ClampedArray, level: string) {
    const layouts = panel_name_layouts(level);
    for (let slot = 0; slot < 4; slot++) {
        const top = slot * 64;
        const { erase } = layouts[slot];
        if (erase) {
            // Read from the untouched artwork: a source column may itself be inside another cleared row.
            const original = pixels.slice(top * SCREEN_WIDTH, (top + 64) * SCREEN_WIDTH);
            for (const [left, first, right, last, source_x, source_y] of erase) {
                const material = panel_color(original, 0, left, first, right, last);
                for (let row = first; row <= last; row++) {
                    const color =
                        source_x === undefined ? material : original[(source_y ?? row) * SCREEN_WIDTH + 352 + source_x];
                    pixels.fill(
                        color,
                        (top + row) * SCREEN_WIDTH + 352 + left,
                        (top + row) * SCREEN_WIDTH + 353 + right
                    );
                }
            }
            continue;
        }
        const stone = panel_color(pixels, top, 6, 25, 37, 31);
        for (let row = 22; row <= 31; row++) {
            // The portraits extend into the upper right corner of the label area.
            const right = row < 24 || (row === 24 && slot === 0) ? 370 : 387;
            const y = top + row;
            pixels.fill(stone, y * SCREEN_WIDTH + 358, y * SCREEN_WIDTH + right + 1);
        }
    }
}

/** Highlight and body colours, following the original shaded lettering. */
const COLORS = [
    ['#ece8dc', '#b8b4a8'],
    ['#f8ce70', '#c89440'],
    ['#cccccc', '#989898'],
    ['#e8c8b0', '#bc987c'],
];

/** A tall initial, uneven small capitals and occasional leaning stems give each panel its original rhythm. */
const HEIGHTS = [
    [7, 5, 6, 5],
    [6, 6, 5, 6, 5],
    [7, 6, 5, 4],
    [7, 6, 5, 6, 6],
];

/** Preserve the caps, crossbars and baseline when shortening a six-row outline. */
const GLYPH_ROWS: Record<number, number[]> = {
    4: [0, 2, 3, 5],
    5: [0, 1, 2, 3, 5],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 2, 3, 4, 5],
};

export function render_panel_name(name: string, slot: number, max_width = PANEL_NAME_WIDTH): HTMLCanvasElement {
    const glyphs = Array.from(name.normalize('NFC').toUpperCase(), (letter, index) => {
        const [base, ...accents] = Array.from(letter.normalize('NFD'));
        const rows = (LETTERS[base] ?? LETTERS['?']).split('/');
        const alphabetic = base >= 'A' && base <= 'Z';
        const heights = HEIGHTS[slot];
        const height = alphabetic ? heights[index % heights.length] : 6;
        return {
            rows,
            accents,
            height: accents.length ? Math.min(5, height) : height,
            lean: alphabetic && index % 3 !== 0 ? 1 : 0,
        };
    });
    const width = () => glyphs.reduce((sum, glyph) => sum + glyph.rows[0].length + glyph.lean + 1, 0);
    if (width() > max_width) {
        while (glyphs.length && width() + 4 > max_width) glyphs.pop();
        const dot = { rows: LETTERS['.'].split('/'), accents: [], height: 6, lean: 0 };
        glyphs.push(dot, dot);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width());
    canvas.height = 9;
    const context = canvas.getContext('2d')!;
    const points: [number, number, boolean][] = [];
    let x = 0;
    for (const { rows, accents, height, lean } of glyphs) {
        const top = 7 - height;
        for (let y = 0; y < height; y++) {
            const row = rows[GLYPH_ROWS[height][y]];
            const shift = y < Math.ceil(height / 2) ? lean : 0;
            for (let col = 0; col < row.length; col++) {
                if (row[col] === '1') points.push([x + col + shift, top + y, y === 0 || col === 0]);
            }
        }
        if (accents.length) {
            const middle = x + lean + Math.floor(rows[0].length / 2);
            points.push([middle, top - 2, true]);
            if (accents.includes('\u0308') || accents.includes('\u030b'))
                points.push([Math.max(x, middle - 2), top - 2, true]);
            else points.push([middle - 1, top - 1, true]);
        }
        x += rows[0].length + lean + 1;
    }
    context.fillStyle = '#24201c';
    for (const [x, y] of points) context.fillRect(x + 1, y + 1, 1, 1);
    for (const [x, y, highlight] of points) {
        context.fillStyle = COLORS[slot][highlight ? 0 : 1];
        context.fillRect(x, y, 1, 1);
    }
    return canvas;
}
