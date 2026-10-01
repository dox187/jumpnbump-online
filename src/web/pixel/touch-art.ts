/** Translucent controls drawn directly on one shared pixel grid, without bitmap resizing. */
import { BOT_BUTTONS, type ButtonId, type Rect, type ShellLayout } from './touch-layout';
import { BOT_MODE_COLORS, type BotMode } from '../../local-controls';

const ICONS: Record<ButtonId, string[]> = {
    bot1: ['.#.', '##.', '.#.', '.#.', '###'],
    bot2: ['###', '..#', '###', '#..', '###'],
    bot3: ['###', '..#', '.##', '..#', '###'],
    bot4: ['#.#', '#.#', '###', '..#', '..#'],
    score: ['###', '#.#', '###', '..#', '###'],
    music: [
        '....#########',
        '....#########',
        '....#.......#',
        '....#.......#',
        '....#.......#',
        '....#.......#',
        '....#.......#',
        '.####....####',
        '#####...#####',
        '.###.....###.',
    ],
    effects: [
        '.....#.......',
        '....##....#..',
        '...###.....#.',
        '######..#...#',
        '######...#..#',
        '######...#..#',
        '######...#..#',
        '######..#...#',
        '...###.....#.',
        '....##....#..',
        '.....#.......',
    ],
    left: [
        '....##.....',
        '...###.....',
        '..####.....',
        '.##########',
        '###########',
        '.##########',
        '..####.....',
        '...###.....',
        '....##.....',
    ],
    right: [
        '.....##....',
        '.....###...',
        '.....####..',
        '##########.',
        '###########',
        '##########.',
        '.....####..',
        '.....###...',
        '.....##....',
    ],
    jump: [
        '.....#.....',
        '....###....',
        '...#####...',
        '..#######..',
        '.#########.',
        '###########',
        '...#####...',
        '...#####...',
        '...#####...',
        '...#####...',
    ],
    back: ['###.###..###', '#...#....#..', '##..###..#..', '#.....#..#..', '###.###..###'],
    full: [
        '#####...#####',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '.............',
        '.............',
        '.............',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#####...#####',
    ],
};

/** A stepped corner is a series of whole pixels, including at fractional device-pixel ratios. */
function inside(x: number, y: number, size: number) {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const dx = Math.min(x, size - 1 - x),
        dy = Math.min(y, size - 1 - y);
    return dx + dy >= 4;
}

export function draw_touch_controls(
    context: CanvasRenderingContext2D,
    layout: ShellLayout,
    held: Set<ButtonId>,
    muted: Set<ButtonId>,
    bot_modes: readonly BotMode[] = []
) {
    context.clearRect(0, 0, layout.view.w, layout.view.h);
    for (const [id, rect] of Object.entries(layout.buttons) as [ButtonId, Rect][]) {
        const pressed = held.has(id);
        for (let y = 0; y < rect.h; y++)
            for (let x = 0; x < rect.w; x++) {
                if (!inside(x, y, rect.w)) continue;
                const edge =
                    !inside(x - 1, y, rect.w) ||
                    !inside(x + 1, y, rect.w) ||
                    !inside(x, y - 1, rect.w) ||
                    !inside(x, y + 1, rect.w);
                context.fillStyle = edge
                    ? `rgba(255,255,255,${pressed ? 0.8 : 0.32})`
                    : `rgba(255,255,255,${pressed ? 0.22 : 0.09})`;
                context.fillRect(rect.x + x, rect.y + y, 1, 1);
            }
        const icon = ICONS[id];
        const ox = rect.x + Math.floor((rect.w - icon[0].length) / 2),
            oy = rect.y + Math.floor((rect.h - icon.length) / 2);
        context.fillStyle = `rgba(255,255,255,${pressed ? 1 : 0.7})`;
        const bot = (BOT_BUTTONS as readonly string[]).indexOf(id);
        if (bot >= 0) context.fillStyle = BOT_MODE_COLORS[bot_modes[bot] ?? 0];
        if (id === 'score') context.fillStyle = '#ffffff';
        for (let y = 0; y < icon.length; y++)
            for (let x = 0; x < icon[y].length; x++) if (icon[y][x] === '#') context.fillRect(ox + x, oy + y, 1, 1);
        if (muted.has(id)) {
            // Clear a one-pixel halo so the mute slash remains legible over either icon.
            const sx = rect.x + Math.floor((rect.w - 13) / 2),
                sy = rect.y + Math.floor((rect.h - 13) / 2);
            for (let i = 0; i < 13; i++) context.clearRect(sx - 1 + i, sy + 11 - i, 3, 3);
            context.fillStyle = 'rgba(255,255,255,0.9)';
            for (let i = 0; i < 13; i++) context.fillRect(sx + i, sy + 12 - i, 1, 1);
        }
    }
}
