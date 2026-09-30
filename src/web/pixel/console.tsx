/**
 * The menu and game share the native 400x256 screen, with square pixels and no internal letterboxing.
 * Phones use the full height in wide landscape and the full width upright. Squarer tablets put their
 * controls below the screen. The woodland frame and its controls adapt independently of the game pixels.
 */
import type { ComponentChildren, ComponentType, JSX, Ref } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { touch_input } from '../../extra-input';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';
import {
    FULLSCREEN_HELP_EVENT,
    FullscreenHelpProps,
    FullscreenIssue,
    show_fullscreen_help,
    toggle_fullscreen,
} from '../../fullscreen';
import { is_mobile_device, touch_enabled, useOnlineSettings } from '../hooks/online-settings';
import { art_ready, artwork_buttons, draw_handheld, load_handheld_art } from './handheld-art';

/** The game keeps its native framebuffer; all console artwork shares one low-resolution raster. */
const BODY_SHORT_SIDE = 200;

export type ButtonId = 'left' | 'right' | 'jump' | 'back' | 'full';
type Rect = { x: number; y: number; w: number; h: number };

export type ShellLayout = {
    mode: 'plain' | 'landscape' | 'portrait';
    /** The native-aspect screen in CSS pixels, and where it is on the page. */
    box: Rect;
    /** CSS pixels per body pixel of the handheld frame (handheld modes). */
    body_scale: number;
    /** The whole display in body pixels (handheld modes). */
    view: { w: number; h: number };
    /** Unobstructed margins for interactive controls, in body pixels. */
    insets: Insets;
    /** The screen in body pixels (handheld modes). */
    screen: Rect;
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

const round = Math.round;
const NO_FRAME = {
    body_scale: 1,
    view: { w: 0, h: 0 },
    screen: { x: 0, y: 0, w: 0, h: 0 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

function compute_layout(touch: boolean): ShellLayout {
    if (typeof window === 'undefined') {
        return { mode: 'plain', box: { x: 0, y: 0, w: SCREEN_WIDTH, h: SCREEN_HEIGHT }, buttons: {}, ...NO_FRAME };
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const mobile = is_mobile_device();
    const portrait = H > W;
    if (!mobile) {
        // The largest native-aspect screen with a whole number of device pixels per game pixel keeps
        // pixel art crisp; windows too small for that get a fractional scale
        const dpr = window.devicePixelRatio || 1;
        const fit = Math.min((W * dpr) / SCREEN_WIDTH, (H * dpr) / SCREEN_HEIGHT);
        const n = fit >= 1 ? Math.floor(fit) : fit;
        const w = (SCREEN_WIDTH * n) / dpr;
        const h = (SCREEN_HEIGHT * n) / dpr;
        return { mode: 'plain', box: { x: round((W - w) / 2), y: round((H - h) / 2), w, h }, buttons: {}, ...NO_FRAME };
    }

    const safe = safe_insets();
    const usable_w = W - safe.left - safe.right;
    const usable_h = H - safe.top - safe.bottom;
    // The game size is independent of the artwork raster: rounding it to body pixels leaves visible gaps.
    // A 16:9 phone has narrow side rails; its direction buttons stack vertically. A tablet needs a deck below.
    const beside = !portrait && W / H >= 1.75;
    const deck = touch && !beside ? (usable_w >= 600 ? 96 : 160) : 0;
    const fit = Math.min(usable_w / SCREEN_WIDTH, Math.max(1, usable_h - deck) / SCREEN_HEIGHT);
    const w = SCREEN_WIDTH * fit;
    const h = SCREEN_HEIGHT * fit;
    const spare = usable_h - h - deck;
    const header = portrait ? Math.max(0, Math.min(spare, 64)) : 0;
    const box = {
        x: safe.left + (usable_w - w) / 2,
        y: safe.top + (beside || (!portrait && !touch) ? (usable_h - h) / 2 : header),
        w,
        h,
    };
    if (!portrait && !touch) return { mode: 'plain', box, buttons: {}, ...NO_FRAME };
    // Every console pixel occupies the same whole number of physical display pixels. Draw everything
    // (including labels and held buttons) at 1:1 on this grid, then enlarge the single canvas once.
    const dpr = window.devicePixelRatio || 1;
    // Cap the artwork pixel size so utility labels still fit their native sprites on large tablets.
    const scale =
        Math.max(1, Math.min(Math.round((Math.min(W, H) * dpr) / BODY_SHORT_SIDE), Math.floor(2 * dpr))) / dpr;
    const view = { w: Math.ceil(W / scale), h: Math.ceil(H / scale) };
    const px = (css: number) => Math.ceil(css / scale);
    const inset = {
        top: px(safe.top),
        right: px(safe.right + view.w * scale - W),
        bottom: px(safe.bottom + view.h * scale - H),
        left: px(safe.left),
    };
    const layout: ShellLayout = {
        mode: beside ? 'landscape' : 'portrait',
        box,
        body_scale: scale,
        view,
        insets: inset,
        screen: { x: box.x / scale, y: box.y / scale, w: w / scale, h: h / scale },
        buttons: {},
    };
    if (touch) layout.buttons = artwork_buttons(layout);
    return layout;
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
        document.addEventListener('fullscreenchange', schedule);
        window.visualViewport?.addEventListener('resize', schedule);
        return () => {
            clearTimeout(timer);
            clearTimeout(late);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('orientationchange', rotated);
            document.removeEventListener('fullscreenchange', schedule);
            window.visualViewport?.removeEventListener('resize', schedule);
        };
    }, [touch]);
    return layout;
}

/** Positions in body pixels as CSS. */
const bp = (n: number) => `calc(var(--bp) * ${n})`;

/** Like a tap on ESC; held for a few frames, since the original game looks at the key state once a frame. */
function press_escape() {
    const key = (type: string) =>
        window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
    key('keydown');
    setTimeout(() => key('keyup'), 100);
}

/** The touch buttons: several fingers at once, and a finger may slide from one button to another. */
function TouchControls({
    layout,
    root,
    closeHelp,
}: {
    layout: ShellLayout;
    root: { current: HTMLDivElement | null };
    closeHelp: (() => void) | null;
}) {
    const [held, setHeld] = useState<Set<ButtonId>>(new Set());
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const helpRef = useRef(closeHelp);
    helpRef.current = closeHelp;

    useEffect(() => {
        const element = root.current;
        if (!element) return;
        const pointers = new Map<number, ButtonId>();
        setHeld(new Set());
        const hit = (x: number, y: number): ButtonId | null => {
            const { buttons, body_scale } = layoutRef.current;
            const slack = 8;
            let nearest: ButtonId | null = null;
            let distance = Infinity;
            for (const [id, r] of Object.entries(buttons) as [ButtonId, Rect | undefined][]) {
                if (!r) continue;
                const left = r.x * body_scale,
                    right = (r.x + r.w) * body_scale;
                const top = r.y * body_scale,
                    bottom = (r.y + r.h) * body_scale;
                // A visible key wins over a neighbour's enlarged touch area, including the rocker seam.
                if (x >= left && x < right && y >= top && y < bottom) return id;
                const dx = Math.max(left - x, 0, x - right),
                    dy = Math.max(top - y, 0, y - bottom);
                const d = dx * dx + dy * dy;
                if (dx <= slack && dy <= slack && d < distance) {
                    nearest = id;
                    distance = d;
                }
            }
            return nearest;
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
            if (helpRef.current) {
                if (id === 'back' || id === 'full') helpRef.current();
                return;
            }
            pointers.set(event.pointerId, id);
            element.setPointerCapture(event.pointerId);
            if (id === 'back') press_escape();
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
            const id = pointers.get(event.pointerId);
            if (pointers.delete(event.pointerId)) apply();
            // Touch activates restricted browser APIs on release, not on pointerdown.
            if (id === 'full' && !helpRef.current && hit(event.clientX, event.clientY) === 'full') toggle_fullscreen();
        };
        const cancel = (event: PointerEvent) => {
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
        element.addEventListener('pointercancel', cancel);
        element.addEventListener('touchstart', touch_start, { passive: false });
        window.addEventListener('blur', release);
        document.addEventListener('visibilitychange', release);
        window.addEventListener(FULLSCREEN_HELP_EVENT, release);
        return () => {
            element.removeEventListener('pointerdown', down);
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', up);
            element.removeEventListener('pointercancel', cancel);
            element.removeEventListener('touchstart', touch_start);
            window.removeEventListener('blur', release);
            document.removeEventListener('visibilitychange', release);
            window.removeEventListener(FULLSCREEN_HELP_EVENT, release);
            touch_input.left = touch_input.right = touch_input.jump = false;
        };
    }, [layout]);

    return (
        <>
            <HandheldBody layout={layout} held={held} />
            {(Object.entries(layout.buttons) as [ButtonId, Rect | undefined][]).map(
                ([id, rect]) =>
                    rect && (
                        <div
                            key={id}
                            className="gp-touch-button"
                            data-button={id}
                            data-pressed={held.has(id)}
                            aria-hidden="true"
                            style={{ left: bp(rect.x), top: bp(rect.y), width: bp(rect.w), height: bp(rect.h) }}
                        />
                    )
            )}
        </>
    );
}

function HandheldBody({ layout, held }: { layout: ShellLayout; held: Set<ButtonId> }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [ready, setReady] = useState(art_ready());
    useEffect(() => {
        let active = true;
        load_handheld_art().then(() => active && setReady(true));
        return () => {
            active = false;
        };
    }, []);
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas || !ready) return;
        canvas.width = layout.view.w;
        canvas.height = layout.view.h;
        draw_handheld(canvas.getContext('2d')!, layout, held);
    }, [layout, ready, held]);
    return (
        <canvas
            ref={ref}
            className="gp-body"
            aria-hidden="true"
            // A transform avoids CSS layout rounding the scaled height to 1/64 px and changing pixel rows.
            style={{ width: layout.view.w, height: layout.view.h, transform: `scale(${layout.body_scale})` }}
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
 * The screen showing content of `width` x `height` game pixels, with its frame. `style` gives the CSS
 * variables of the pixel components for a scale (CSS pixels per game pixel); `stageRef` gets the element
 * the content is laid out in.
 */
export function Shell({
    width,
    height,
    style,
    stageRef,
    fullscreenHelp: FullscreenHelp,
    children,
}: {
    width: number;
    height: number;
    style: (scale: number) => JSX.CSSProperties;
    stageRef?: Ref<HTMLDivElement>;
    fullscreenHelp: ComponentType<FullscreenHelpProps>;
    children: ComponentChildren;
}) {
    const layout = useShellLayout();
    const root = useRef<HTMLDivElement>(null);
    const [fullscreenIssue, setFullscreenIssue] = useState<FullscreenIssue | null>(null);
    const closeHelp = () => setFullscreenIssue(null);
    useEffect(() => {
        const show = (event: Event) => setFullscreenIssue((event as CustomEvent<FullscreenIssue>).detail);
        // Older WebKit reports failures as events instead of rejected promises.
        const failed = () => show_fullscreen_help('denied');
        window.addEventListener(FULLSCREEN_HELP_EVENT, show);
        document.addEventListener('webkitfullscreenerror', failed);
        return () => {
            window.removeEventListener(FULLSCREEN_HELP_EVENT, show);
            document.removeEventListener('webkitfullscreenerror', failed);
        };
    }, []);
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
    // The menu and game use the same square-pixel scale and fill the same screen.
    const content = useMemo(() => {
        const px = Math.min(layout.box.w / width, layout.box.h / height);
        return { px, x: (layout.box.w - width * px) / 2, y: (layout.box.h - height * px) / 2 };
    }, [layout.box.w, layout.box.h, width, height]);
    if (!mounted) return <div className="gp-root" />;

    const stage = (
        <div
            ref={stageRef}
            className="gp-stage"
            style={{
                ...style(content.px),
                left: `${content.x}px`,
                top: `${content.y}px`,
                width: `${width * content.px}px`,
                height: `${height * content.px}px`,
            }}
        >
            {children}
            {fullscreenIssue && <FullscreenHelp issue={fullscreenIssue} onClose={closeHelp} />}
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
            <TouchControls layout={layout} root={root} closeHelp={fullscreenIssue ? closeHelp : null} />
            <div
                className="gp-screen"
                style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
            >
                {stage}
            </div>
        </div>
    );
}
