/**
 * The animated menu scene behind the lobby: the original menu background, idle bunnies that hop now and
 * then, butterflies and the fly swarm, drawn at 60 Hz on a 480x288 canvas.
 *
 * In a room the players' bunnies hop around instead: your own one with the menu physics (HopBunny), the
 * others from position samples relayed over the network, each with its name tag above it.
 */
import { useEffect, useRef } from 'preact/hooks';
import { object_anims } from '../../animation';
import { OBJ_ANIM, SCREEN_HEIGHT } from '../../constants';
import { GameAssets, Sprite } from './assets';
import { STAGE_HEIGHT, STAGE_WIDTH, Text, gp, icon_canvas } from './components';
import { TextColor, fit_text, render_text } from './font';
import { HOP_MAX_X, HOP_SPOTS, HopBunny } from './hop';

/** Where the 400x256 menu screen sits on the stage. */
export const SCENE_X = 40;
export const SCENE_Y = 16;
/** The logo sits in the black header above the forest; lift only that strip to make room for the host. */
const MENU_HEADER_HEIGHT = 63;
const LOGO_LIFT = 14;

/**
 * Standing spots of the four bunnies (stage coordinates of the 16x16 player box): on the grass and on the log,
 * exactly where the menu physics lets them rest (see HOP_SPOTS).
 */
export const BUNNY_SPOTS: { x: number; y: number }[] = HOP_SPOTS.map((spot) => ({
    x: SCENE_X + spot.x,
    y: SCENE_Y + spot.y,
}));

/** A name tag drawn above a bunny, like the .gp-tag labels of the pixel UI. */
export type SceneTag = {
    text: string;
    color: TextColor;
    /** The room's host: a crown at the tag's top left corner. */
    crown?: boolean;
    /** Your own bunny: a bobbing arrow above the tag. */
    mine?: boolean;
};

export type SceneBunny = {
    /** Which bunny (0-3): Dott, Jiffy, Fizz or Mijji. */
    slot: number;
    /** Stage position of the 16x16 player box; defaults to the bunny's spot in BUNNY_SPOTS. */
    x?: number;
    y?: number;
    /** A free slot: drawn as a dark silhouette. */
    ghost?: boolean;
    tag?: SceneTag;
};

/** Where a hopping bunny is: menu x and y of the player box and its sprite 0-17 (HopBunny.image), integers. */
export type HopSample = [x: number, y: number, image: number];

/** A sample of another player's bunny and when it arrived (performance.now()). */
export type RemoteHop = { sample: HopSample; at: number };

/** The bunny you move yourself in a room. */
export type SceneOwnBunny = {
    slot: number;
    /** The INPUT_* mask for the next 60 Hz frame. */
    input: () => number;
    /** Called when the bunny moved (at most 20 times a second) and at least once a second. */
    on_state: (sample: HopSample) => void;
    /** The right wall in menu pixels (default: the screen edge). */
    max_x?: number;
};

type BunnyState = {
    slot: number;
    x: number;
    y: number;
    ghost: boolean;
    tag: SceneTag | undefined;
    /** Last time (performance.now()) the slot was free: remote samples up to then belong to its old player. */
    free_at: number;
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
/** Ticks between two samples of your own bunny (20 per second) and at most between heartbeats (1 second). */
const SEND_TICKS = 3;
const HEARTBEAT_TICKS = 60;
/** Other players' bunnies are shown this far behind the newest sample, interpolated between two samples. */
const REMOTE_DELAY_MS = 100;
/** A step larger than this (menu pixels) between two samples is a teleport, not a movement. */
const SNAP_PX = 40;
/** Longest name on a tag (game pixels), as in the room's DOM tags. */
const TAG_TEXT_MAX = 66;

const rnd = (max: number) => Math.floor(Math.random() * max);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const tag_texts = new Map<string, HTMLCanvasElement>();
function tag_text(text: string, color: TextColor) {
    const key = `${color}|${text}`;
    let canvas = tag_texts.get(key);
    if (!canvas) {
        canvas = render_text(fit_text(text, TAG_TEXT_MAX), color);
        if (tag_texts.size > 200) tag_texts.clear();
        tag_texts.set(key, canvas);
    }
    return canvas;
}

/** A sample from the network, made safe to draw. */
function sane(sample: HopSample): HopSample | null {
    const [x, y, image] = sample;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [
        clamp(x, 0, HOP_MAX_X),
        clamp(y, 0, SCREEN_HEIGHT - 16),
        Number.isInteger(image) && image >= 0 && image < 18 ? image : 0,
    ];
}

/** Where to draw another player's bunny at `now`: between the two samples around now - REMOTE_DELAY_MS. */
function remote_position(hops: readonly RemoteHop[], since: number, now: number): HopSample | null {
    const t = now - REMOTE_DELAY_MS;
    let older: RemoteHop | null = null;
    let newer: RemoteHop | null = null;
    for (const hop of hops) {
        if (hop.at <= since) continue;
        if (hop.at <= t) {
            if (!older || hop.at >= older.at) older = hop;
        } else if (!newer || hop.at < newer.at) newer = hop;
    }
    const a = older && sane(older.sample);
    const b = newer && sane(newer.sample);
    if (!a || !b) return a ?? b;
    if (Math.abs(b[0] - a[0]) > SNAP_PX || Math.abs(b[1] - a[1]) > SNAP_PX) return a;
    const f = (t - older!.at) / (newer!.at - older!.at);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2]];
}

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

/**
 * The menu forest with its bunnies. Without `own` and `remote` (the room list) the bunnies idle-hop now and
 * then. In a room they stand at their spots unless moved: `own` runs your bunny with the menu physics at 60 Hz
 * and reports its samples; `remote` gives, per slot, the recent samples of the other players' bunnies
 * (oldest first), which are drawn REMOTE_DELAY_MS behind. A bunny that changes hands or goes free is back
 * at its spot.
 */
export function Scene({
    assets,
    bunnies,
    own,
    remote,
}: {
    assets: GameAssets;
    bunnies: SceneBunny[];
    own?: SceneOwnBunny;
    remote?: () => ReadonlyMap<number, readonly RemoteHop[]>;
}) {
    const canvas_ref = useRef<HTMLCanvasElement>(null);
    const wanted = useRef(bunnies);
    wanted.current = bunnies;
    const own_ref = useRef(own);
    own_ref.current = own;
    const remote_ref = useRef(remote);
    remote_ref.current = remote;

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
        /** Your own bunny, and what was last reported of it. */
        let hop: HopBunny | null = null;
        let sent: HopSample | null = null;
        let since_sent = 0;

        const sync_bunnies = () => {
            const present = new Set<number>();
            const now = performance.now();
            for (const bunny of wanted.current) {
                present.add(bunny.slot);
                const x = bunny.x ?? BUNNY_SPOTS[bunny.slot].x;
                const y = bunny.y ?? BUNNY_SPOTS[bunny.slot].y;
                const ghost = !!bunny.ghost;
                let state = states.get(bunny.slot);
                if (state) Object.assign(state, { ghost, x, y, tag: bunny.tag });
                else {
                    state = {
                        slot: bunny.slot,
                        x,
                        y,
                        ghost,
                        tag: bunny.tag,
                        free_at: ghost ? now : -Infinity,
                        direction: HOP_SPOTS[bunny.slot].direction,
                        dy: 0,
                        vy: 0,
                        fall_tick: 0,
                        next_hop: frame + 60 + rnd(300),
                    };
                    states.set(bunny.slot, state);
                }
                if (ghost) state.free_at = now;
            }
            for (const slot of states.keys()) if (!present.has(slot)) states.delete(slot);
        };

        const step_own = () => {
            const own = own_ref.current;
            if ((own?.slot ?? -1) !== (hop?.slot ?? -1)) {
                // A new bunny starts at its spot; the one you had stands at its own spot again
                hop = own ? new HopBunny(own.slot, null, own.max_x) : null;
                sent = null;
                since_sent = SEND_TICKS;
            }
            if (!hop || !own) return;
            hop.step(own.input());
            since_sent++;
            const sample: HopSample = [hop.x, hop.y, hop.image];
            const changed = !sent || sample.some((v, i) => v !== sent![i]);
            if ((changed && since_sent >= SEND_TICKS) || since_sent >= HEARTBEAT_TICKS) {
                sent = sample;
                since_sent = 0;
                own.on_state(sample);
            }
        };

        const tick = () => {
            frame++;
            sync_bunnies();
            step_own();
            // In a room the bunnies only move when their players move them
            const in_room = !!own_ref.current || !!remote_ref.current;
            for (const b of states.values()) {
                if (b.ghost || in_room) {
                    b.dy = b.vy = 0;
                    continue;
                }
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

        /** A name tag centred above the player box at stage position x, y, kept inside the stage. */
        const draw_tag = (tag: SceneTag, x: number, y: number) => {
            const text = tag_text(tag.text, tag.color);
            // 1 pixel black frame with cut corners, 2 pixels of padding left and right
            const width = text.width + 6;
            const height = text.height + 2;
            const left = clamp(x + 8 - Math.ceil(width / 2), tag.crown ? 3 : 0, STAGE_WIDTH - width);
            const top = clamp(y - 19, tag.crown ? 5 : 0, STAGE_HEIGHT - height);
            context.fillStyle = 'rgba(0, 0, 0, 0.72)';
            context.fillRect(left + 1, top + 1, width - 2, height - 2);
            context.fillStyle = '#000';
            context.fillRect(left + 1, top, width - 2, 1);
            context.fillRect(left + 1, top + height - 1, width - 2, 1);
            context.fillRect(left, top + 1, 1, height - 2);
            context.fillRect(left + width - 1, top + 1, 1, height - 2);
            context.drawImage(text, left + 3, top + 1);
            if (tag.crown) context.drawImage(icon_canvas('crown'), left - 3, top - 5);
            if (tag.mine) {
                // Like the .gp-bob animation: 800 ms in four steps, up two pixels and down again
                const bob = [0, -1, -2, -1][Math.floor((performance.now() % 800) / 200)];
                context.drawImage(icon_canvas('down'), clamp(x + 5, 0, STAGE_WIDTH - 7), Math.max(0, top - 8 + bob));
            }
        };

        const draw = () => {
            context.fillStyle = '#000';
            context.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            context.drawImage(
                assets.menu,
                0,
                0,
                400,
                MENU_HEADER_HEIGHT,
                SCENE_X,
                SCENE_Y - LOGO_LIFT,
                400,
                MENU_HEADER_HEIGHT
            );
            context.drawImage(
                assets.menu,
                0,
                MENU_HEADER_HEIGHT,
                400,
                SCREEN_HEIGHT - MENU_HEADER_HEIGHT,
                SCENE_X,
                SCENE_Y + MENU_HEADER_HEIGHT,
                400,
                SCREEN_HEIGHT - MENU_HEADER_HEIGHT
            );
            context.fillStyle = '#000';
            for (const fly of flies) context.fillRect(fly.x, fly.y, 1, 1);
            const now = performance.now();
            const own = own_ref.current;
            const others = remote_ref.current?.();
            const tags: [tag: SceneTag, x: number, y: number, layer: number][] = [];
            // Back to front like the menu: Dott is drawn last, on top
            for (const b of [...states.values()].sort((a, c) => c.slot - a.slot)) {
                let x = b.x;
                let y = b.y + b.dy;
                let image = 0;
                const samples = others?.get(b.slot);
                const moved: HopSample | null =
                    hop && own && hop.slot === b.slot
                        ? [hop.x, hop.y, hop.image]
                        : !b.ghost && samples && b.slot !== own?.slot
                          ? remote_position(samples, b.free_at, now)
                          : null;
                if (moved) {
                    x = SCENE_X + Math.round(moved[0]);
                    y = SCENE_Y + Math.round(moved[1]);
                    image = moved[2];
                } else {
                    if (b.dy < 0 && b.vy < 0) image = 4;
                    else if (b.dy < 0) image = b.fall_tick % 21 < 8 ? 5 : b.fall_tick % 21 < 18 ? 6 : 7;
                    image += b.direction * 9;
                }
                const index = b.slot * 18 + image;
                const sprite = assets.rabbit[index];
                draw_sprite(sprite, x, y, b.ghost ? shadows[index] : sprite.canvas);
                if (b.tag) tags.push([b.tag, Math.round(x), Math.round(y), b.tag.mine ? 2 : b.ghost ? 0 : 1]);
            }
            for (const butterfly of butterflies) {
                const image = object_anims[butterfly.anim].frame[butterfly.frame].image;
                draw_sprite(assets.objects[image], butterfly.x, butterfly.y);
            }
            // Like the menu's mask: the front end of the log hides whatever is behind it
            context.drawImage(assets.menu_front, SCENE_X, SCENE_Y);
            // Free bunnies' tags at the bottom, your own one on top, otherwise in the order of the bunnies
            tags.sort((a, b) => a[3] - b[3]);
            for (const [tag, x, y] of tags) draw_tag(tag, x, y);
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
        <>
            <canvas
                ref={canvas_ref}
                width={STAGE_WIDTH}
                height={STAGE_HEIGHT}
                aria-hidden="true"
                className="gp-abs"
                style={{ left: 0, top: 0, width: gp(STAGE_WIDTH), height: gp(STAGE_HEIGHT) }}
                // The mouse can be your control: no context menu or middle-click scrolling over the forest
                onContextMenu={own ? (e) => e.preventDefault() : undefined}
                onMouseDown={own ? (e) => e.button !== 0 && e.preventDefault() : undefined}
            />
            <div
                className="gp-abs"
                style={{ left: 0, top: gp(50), width: gp(STAGE_WIDTH), display: 'flex', justifyContent: 'center' }}
            >
                <Text text={window.location.hostname} color="dim" maxWidth={STAGE_WIDTH - 16} />
            </div>
        </>
    );
}
