/**
 * The menu and game share the native 400x256 screen, with square pixels and no internal letterboxing.
 * Mobile controls keep comfortable thumb positions, clear utility corners and hardware-safe margins.
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
import { draw_touch_controls } from './touch-art';
import { screen_layout, type ButtonId, type Insets, type Rect, type ShellLayout } from './touch-layout';

/** The safe area of phones with notches and rounded corners, in CSS pixels. */
function safe_probe() {
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;box-sizing:content-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    return probe;
}

function safe_insets(): Insets {
    const probe = safe_probe();
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

function compute_layout(touch: boolean): ShellLayout {
    if (typeof window === 'undefined') return screen_layout(SCREEN_WIDTH, SCREEN_HEIGHT, 1, false, false);
    const mobile = is_mobile_device();
    return screen_layout(
        window.innerWidth,
        window.innerHeight,
        window.devicePixelRatio || 1,
        mobile,
        touch,
        mobile ? safe_insets() : undefined
    );
}

/** The layout for the current window; recomputed once a resize or rotation has settled. */
export function useShellLayout(): ShellLayout {
    const [settings] = useOnlineSettings();
    const touch = touch_enabled(settings);
    const [layout, setLayout] = useState(() => compute_layout(touch));
    useEffect(() => {
        let timer = 0;
        let late = 0;
        const update = () => {
            const next = compute_layout(touch);
            // Repeated orientation/fullscreen events must not release a new touch when nothing moved.
            setLayout((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        };
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
        // Fullscreen/browser chrome can change the cutout insets after the viewport resize has finished.
        const probe = safe_probe();
        const observer = new ResizeObserver(schedule);
        observer.observe(probe, { box: 'border-box' });
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', rotated);
        window.screen.orientation?.addEventListener('change', rotated);
        document.addEventListener('fullscreenchange', rotated);
        document.addEventListener('webkitfullscreenchange', rotated);
        window.visualViewport?.addEventListener('resize', schedule);
        return () => {
            clearTimeout(timer);
            clearTimeout(late);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('orientationchange', rotated);
            window.screen.orientation?.removeEventListener('change', rotated);
            document.removeEventListener('fullscreenchange', rotated);
            document.removeEventListener('webkitfullscreenchange', rotated);
            window.visualViewport?.removeEventListener('resize', schedule);
            observer.disconnect();
            probe.remove();
        };
    }, [touch]);
    return layout;
}

/** Positions on the shared control pixel grid as CSS. */
const control_px = (n: number) => `calc(var(--control-pixel) * ${n})`;

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
    const [settings, updateSettings] = useOnlineSettings();
    const muted = useMemo(
        () =>
            new Set<ButtonId>([
                ...(settings.muteMusic ? ['music' as const] : []),
                ...(settings.muteEffects ? ['effects' as const] : []),
            ]),
        [settings.muteMusic, settings.muteEffects]
    );
    const action = useRef((id: ButtonId) => {});
    action.current = (id) => {
        if (id === 'back') press_escape();
        else if (id === 'full') toggle_fullscreen();
        else if (id === 'music') updateSettings({ muteMusic: !settings.muteMusic });
        else if (id === 'effects') updateSettings({ muteEffects: !settings.muteEffects });
    };
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
            const { buttons, pixel_scale, box, safe } = layoutRef.current;
            if (x < safe.left || x >= innerWidth - safe.right || y < safe.top || y >= innerHeight - safe.bottom)
                return null;
            // Even the forgiving touch margin must never intercept a tap inside the game or its menus.
            if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) return null;
            const slack = 8;
            let nearest: ButtonId | null = null;
            let distance = Infinity;
            for (const [id, r] of Object.entries(buttons) as [ButtonId, Rect | undefined][]) {
                if (!r) continue;
                const left = r.x * pixel_scale,
                    right = (r.x + r.w) * pixel_scale;
                const top = r.y * pixel_scale,
                    bottom = (r.y + r.h) * pixel_scale;
                // A visible key wins over a neighbour's enlarged touch area.
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
            apply();
        };
        const move = (event: PointerEvent) => {
            const current = pointers.get(event.pointerId);
            if (!current || (current !== 'left' && current !== 'right' && current !== 'jump')) return;
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
            if (id && !helpRef.current && hit(event.clientX, event.clientY) === id) action.current(id);
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
            <ControlArtwork layout={layout} held={held} muted={muted} />
            {(Object.entries(layout.buttons) as [ButtonId, Rect | undefined][]).map(([id, rect]) => {
                const utility = id === 'back' || id === 'full' || id === 'music' || id === 'effects';
                const Tag = utility ? 'button' : 'div';
                const label =
                    id === 'back'
                        ? 'Escape'
                        : id === 'full'
                          ? 'Toggle fullscreen'
                          : id === 'music'
                            ? 'Mute music'
                            : 'Mute sound effects';
                return (
                    rect && (
                        <Tag
                            key={id}
                            type={utility ? 'button' : undefined}
                            className="gp-touch-button"
                            data-button={id}
                            data-pressed={held.has(id)}
                            data-muted={muted.has(id)}
                            aria-hidden={utility ? undefined : true}
                            aria-label={utility ? label : undefined}
                            aria-pressed={id === 'music' || id === 'effects' ? muted.has(id) : undefined}
                            title={utility ? label : undefined}
                            onClick={(event) => {
                                // Pointer actions run on release above; keyboard/assistive activation has no pointer.
                                if (utility && event.detail === 0) {
                                    if (helpRef.current) helpRef.current();
                                    else action.current(id);
                                }
                            }}
                            style={{
                                left: control_px(rect.x),
                                top: control_px(rect.y),
                                width: control_px(rect.w),
                                height: control_px(rect.h),
                            }}
                        />
                    )
                );
            })}
        </>
    );
}

function ControlArtwork({ layout, held, muted }: { layout: ShellLayout; held: Set<ButtonId>; muted: Set<ButtonId> }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        canvas.width = layout.view.w;
        canvas.height = layout.view.h;
        draw_touch_controls(canvas.getContext('2d')!, layout, held, muted);
    }, [layout, held, muted]);
    return (
        <canvas
            ref={ref}
            className="gp-controls-art"
            aria-hidden="true"
            // A transform avoids CSS layout rounding the scaled height to 1/64 px and changing pixel rows.
            style={{ width: layout.view.w, height: layout.view.h, transform: `scale(${layout.pixel_scale})` }}
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
    return (
        <div
            ref={root}
            className={`gp-root${layout.mode === 'plain' ? '' : ' gp-touch-shell'}`}
            style={{ '--control-pixel': `${layout.pixel_scale}px` } as JSX.CSSProperties}
        >
            {layout.mode !== 'plain' && (
                <TouchControls layout={layout} root={root} closeHelp={fullscreenIssue ? closeHelp : null} />
            )}
            <div
                className="gp-screen"
                style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
            >
                {stage}
            </div>
        </div>
    );
}
