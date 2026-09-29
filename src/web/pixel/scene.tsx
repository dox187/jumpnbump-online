/**
 * The animated menu scene behind the lobby: the original menu background, idle bunnies that hop now and
 * then, butterflies and the fly swarm, drawn at 60 Hz on a 480x288 canvas.
 */
import { useEffect, useRef } from 'preact/hooks';
import { object_anims } from '../../animation';
import { OBJ_ANIM } from '../../constants';
import { GameAssets, Sprite } from './assets';
import { STAGE_HEIGHT, STAGE_WIDTH, gp } from './components';

/** Where the 400x256 menu screen sits on the stage. */
export const SCENE_X = 40;
export const SCENE_Y = 16;

/** Standing spots of the four bunnies (stage coordinates of the 16x16 player box): on the grass and on the log. */
export const BUNNY_SPOTS: { x: number; y: number }[] = [
    { x: SCENE_X + 30, y: SCENE_Y + 160 },
    { x: SCENE_X + 110, y: SCENE_Y + 160 },
    { x: SCENE_X + 186, y: SCENE_Y + 138 },
    { x: SCENE_X + 266, y: SCENE_Y + 160 },
];

export type SceneBunny = {
    /** Which bunny (0-3): Dott, Jiffy, Fizz or Mijji. */
    slot: number;
    /** Stage position of the 16x16 player box; defaults to the bunny's spot in BUNNY_SPOTS. */
    x?: number;
    y?: number;
    /** A free slot: drawn as a dark silhouette. */
    ghost?: boolean;
};

type BunnyState = {
    slot: number;
    x: number;
    y: number;
    ghost: boolean;
    direction: number;
    dy: number;
    vy: number;
    fall_tick: number;
    next_hop: number;
};

type Butterfly = {
    x: number;
    y: number;
    x_add: number;
    y_add: number;
    x_acc: number;
    y_acc: number;
    pink: boolean;
    anim: number;
    frame: number;
    ticks: number;
};

const TICK_MS = 1000 / 60;
const GRAVITY = 12288 / 65536;
const FLIGHT = { left: SCENE_X + 16, right: SCENE_X + 384, top: SCENE_Y + 52, bottom: SCENE_Y + 176 };
const FLY_CENTER = { x: SCENE_X + 216, y: SCENE_Y + 168 };

const rnd = (max: number) => Math.floor(Math.random() * max);

/** A faded copy of a sprite for bunnies nobody plays yet. */
function ghost_of(sprite: Sprite): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = sprite.canvas.width;
    canvas.height = sprite.canvas.height;
    const context = canvas.getContext('2d')!;
    context.globalAlpha = 0.45;
    context.drawImage(sprite.canvas, 0, 0);
    return canvas;
}

function new_butterfly(pink: boolean): Butterfly {
    return {
        x: FLIGHT.left + rnd(FLIGHT.right - FLIGHT.left),
        y: FLIGHT.top + rnd(FLIGHT.bottom - FLIGHT.top),
        x_add: 0,
        y_add: 0,
        x_acc: 0,
        y_acc: 0,
        pink,
        anim: pink ? OBJ_ANIM.PINK_BUTFLY_RIGHT : OBJ_ANIM.YEL_BUTFLY_RIGHT,
        frame: rnd(6),
        ticks: 2,
    };
}

/** The butterfly flight of update_objects in main.ts, in floating point pixels. */
function update_butterfly(b: Butterfly) {
    b.x_acc = Math.max(-1024, Math.min(1024, b.x_acc + rnd(128) - 64));
    b.x_add = Math.max(-32768, Math.min(32768, b.x_add + b.x_acc));
    b.x += b.x_add / 65536;
    if (b.x < FLIGHT.left || b.x > FLIGHT.right) {
        b.x = Math.max(FLIGHT.left, Math.min(FLIGHT.right, b.x));
        b.x_add = -b.x_add / 4;
        b.x_acc = 0;
    }
    b.y_acc = Math.max(-1024, Math.min(1024, b.y_acc + rnd(64) - 32));
    b.y_add = Math.max(-32768, Math.min(32768, b.y_add + b.y_acc));
    b.y += b.y_add / 65536;
    if (b.y < FLIGHT.top || b.y > FLIGHT.bottom) {
        b.y = Math.max(FLIGHT.top, Math.min(FLIGHT.bottom, b.y));
        b.y_add = -b.y_add / 4;
        b.y_acc = 0;
    }
    const right = b.pink ? OBJ_ANIM.PINK_BUTFLY_RIGHT : OBJ_ANIM.YEL_BUTFLY_RIGHT;
    const left = b.pink ? OBJ_ANIM.PINK_BUTFLY_LEFT : OBJ_ANIM.YEL_BUTFLY_LEFT;
    const wanted = b.x_add < 0 ? left : right;
    if (wanted !== b.anim) {
        b.anim = wanted;
        b.frame = 0;
        b.ticks = object_anims[b.anim].frame[0].ticks;
    }
    if (--b.ticks <= 0) {
        b.frame = (b.frame + 1) % object_anims[b.anim].num_frames;
        b.ticks = object_anims[b.anim].frame[b.frame].ticks;
    }
}

export function Scene({ assets, bunnies }: { assets: GameAssets; bunnies: SceneBunny[] }) {
    const canvas_ref = useRef<HTMLCanvasElement>(null);
    const wanted = useRef(bunnies);
    wanted.current = bunnies;

    useEffect(() => {
        const canvas = canvas_ref.current!;
        const context = canvas.getContext('2d')!;
        const shadows = assets.rabbit.map(ghost_of);
        const states = new Map<number, BunnyState>();
        const butterflies = [new_butterfly(false), new_butterfly(true), new_butterfly(false)];
        const flies = Array.from({ length: 14 }, () => ({
            x: FLY_CENTER.x + rnd(30) - 15,
            y: FLY_CENTER.y + rnd(20) - 10,
        }));
        let frame = 0;
        let last = performance.now();
        let accumulator = 0;
        let request = 0;

        const sync_bunnies = () => {
            const present = new Set<number>();
            for (const bunny of wanted.current) {
                present.add(bunny.slot);
                const x = bunny.x ?? BUNNY_SPOTS[bunny.slot].x;
                const y = bunny.y ?? BUNNY_SPOTS[bunny.slot].y;
                const state = states.get(bunny.slot);
                if (state) Object.assign(state, { ghost: !!bunny.ghost, x, y });
                else
                    states.set(bunny.slot, {
                        slot: bunny.slot,
                        x,
                        y,
                        ghost: !!bunny.ghost,
                        direction: bunny.slot >= 2 ? 1 : 0,
                        dy: 0,
                        vy: 0,
                        fall_tick: 0,
                        next_hop: frame + 60 + rnd(300),
                    });
            }
            for (const slot of states.keys()) if (!present.has(slot)) states.delete(slot);
        };

        const tick = () => {
            frame++;
            sync_bunnies();
            for (const b of states.values()) {
                if (b.ghost) continue;
                if (b.vy !== 0 || b.dy < 0) {
                    b.vy += GRAVITY;
                    b.dy += b.vy;
                    b.fall_tick++;
                    if (b.dy >= 0) {
                        b.dy = 0;
                        b.vy = 0;
                    }
                } else if (frame >= b.next_hop) {
                    if (rnd(4) === 0) b.direction ^= 1;
                    else {
                        b.vy = rnd(3) === 0 ? -280000 / 65536 : -2.4;
                        b.fall_tick = 0;
                    }
                    b.next_hop = frame + 90 + rnd(360);
                }
            }
            for (const butterfly of butterflies) update_butterfly(butterfly);
            for (const fly of flies) {
                const dx = FLY_CENTER.x - fly.x;
                const dy = FLY_CENTER.y - fly.y;
                fly.x += rnd(3) - 1 + (dx > 14 ? 1 : dx < -14 ? -1 : 0) * (rnd(2) ? 1 : 0);
                fly.y += rnd(3) - 1 + (dy > 9 ? 1 : dy < -9 ? -1 : 0) * (rnd(2) ? 1 : 0);
            }
        };

        const draw_sprite = (sprite: Sprite, x: number, y: number, source = sprite.canvas) => {
            context.drawImage(source, Math.round(x - sprite.hs_x), Math.round(y - sprite.hs_y));
        };

        const draw = () => {
            context.fillStyle = '#000';
            context.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            context.drawImage(assets.menu, SCENE_X, SCENE_Y);
            context.fillStyle = '#000';
            for (const fly of flies) context.fillRect(fly.x, fly.y, 1, 1);
            for (const b of states.values()) {
                let image = 0;
                if (b.dy < 0 && b.vy < 0) image = 4;
                else if (b.dy < 0) image = b.fall_tick % 21 < 8 ? 5 : b.fall_tick % 21 < 18 ? 6 : 7;
                const index = b.slot * 18 + image + b.direction * 9;
                const sprite = assets.rabbit[index];
                draw_sprite(sprite, b.x, b.y + b.dy, b.ghost ? shadows[index] : sprite.canvas);
            }
            for (const butterfly of butterflies) {
                const image = object_anims[butterfly.anim].frame[butterfly.frame].image;
                draw_sprite(assets.objects[image], butterfly.x, butterfly.y);
            }
        };

        const loop = (now: number) => {
            request = requestAnimationFrame(loop);
            accumulator = Math.min(accumulator + now - last, 250);
            last = now;
            let ticked = false;
            while (accumulator >= TICK_MS) {
                accumulator -= TICK_MS;
                tick();
                ticked = true;
            }
            if (ticked) draw();
        };
        sync_bunnies();
        draw();
        request = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(request);
    }, [assets]);

    return (
        <canvas
            ref={canvas_ref}
            width={STAGE_WIDTH}
            height={STAGE_HEIGHT}
            aria-hidden="true"
            className="gp-abs"
            style={{ left: 0, top: 0, width: gp(STAGE_WIDTH), height: gp(STAGE_HEIGHT) }}
        />
    );
}
