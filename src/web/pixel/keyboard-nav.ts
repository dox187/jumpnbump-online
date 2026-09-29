/**
 * Game-style keyboard control of the pixel UI. The arrow keys move the focus to the nearest control in that
 * direction within the topmost layer (the last open dialog, otherwise the stage); Enter and Space activate the
 * focused control natively. Dialogs take the focus when they open and give it back when they close.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** What the arrow keys can move to (disabled controls and tabindex -1 are filtered out afterwards). */
const CONTROLS =
    'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), ' +
    'textarea:not(:disabled), [tabindex="0"]';

/** Input types that use Left/Right for the caret. */
const TEXT_INPUT_TYPES = new Set(['text', 'password', 'search', 'email', 'url', 'tel']);

type Direction = 'up' | 'down' | 'left' | 'right';
const DIRECTIONS: Record<string, Direction> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

/** The stages with keyboard navigation that are on the page right now. */
const stages = new Set<HTMLElement>();

function is_text_field(element: Element | null): boolean {
    if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type);
    return element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
}

function focus_visible(element: Element | null): boolean {
    try {
        return !!element && element.matches(':focus-visible');
    } catch {
        return false;
    }
}

/**
 * The element that last got the focus from the keyboard: it matched :focus-visible when it was focused.
 * Checking :focus-visible later is not enough, because browsers switch it on for a control focused with the
 * mouse as soon as any key is pressed.
 */
let keyboard_focused: Element | null = null;

if (typeof document !== 'undefined') {
    document.addEventListener(
        'focusin',
        (event) => {
            const target = event.target instanceof Element ? event.target : null;
            keyboard_focused = focus_visible(target) ? target : null;
        },
        true
    );
}

function is_control(element: HTMLElement) {
    return element.matches(CONTROLS) && element.tabIndex >= 0;
}

function is_shown(element: HTMLElement) {
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

/**
 * True while the keyboard is working the UI: a dialog is open on a stage, a text field is focused, or the
 * focused control of a stage got its focus from the keyboard (it matched :focus-visible when focused, so not
 * a control that was clicked with the mouse). The room uses this to decide whether the arrow keys steer the
 * player's bunny or move through the controls.
 */
export function has_keyboard_focus(): boolean {
    if (typeof document === 'undefined') return false;
    for (const stage of stages) if (stage.querySelector('.gp-dialog')) return true;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return false;
    if (is_text_field(active)) return true;
    if (active !== keyboard_focused || !is_control(active)) return false;
    for (const stage of stages) if (stage.contains(active)) return true;
    return false;
}

/** The layer the arrow keys work in: the last open dialog, otherwise the stage. */
function top_layer(stage: HTMLElement): HTMLElement {
    const dialogs = stage.querySelectorAll<HTMLElement>('.gp-dialog');
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : stage;
}

function controls_in(layer: HTMLElement): HTMLElement[] {
    return Array.from(layer.querySelectorAll<HTMLElement>(CONTROLS)).filter(
        (element) => element.tabIndex >= 0 && !element.closest('[inert]') && is_shown(element)
    );
}

/** Where the focus goes when nothing is focused yet: the first green button, else the first real control. */
function default_control(controls: HTMLElement[]): HTMLElement | null {
    return (
        controls.find((element) => element.classList.contains('gp-button-primary')) ??
        controls.find((element) => !element.classList.contains('gp-close')) ??
        controls[0] ??
        null
    );
}

/** Focuses a control from the keyboard: highlighted, and scrolled into view as little as needed. */
function move_focus(element: HTMLElement) {
    element.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The nearest scrolling ancestor of an element (or null); `cache` remembers the answer per ancestor. */
function scroll_parent(element: HTMLElement, cache: Map<Element, boolean>): HTMLElement | null {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        let scrolls = cache.get(parent);
        if (scrolls === undefined) {
            const style = getComputedStyle(parent);
            scrolls = /auto|scroll/.test(style.overflowY + style.overflowX);
            cache.set(parent, scrolls);
        }
        if (scrolls) return parent;
    }
    return null;
}

function overlaps(a: DOMRect, b: DOMRect) {
    return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
}

/**
 * How far `to` is from `from` when moving in `direction`, or Infinity when it does not lie that way.
 * The gap along the direction counts once, the distance across it twice, so controls in line win.
 */
function distance(from: DOMRect, to: DOMRect, direction: Direction): number {
    const vertical = direction === 'up' || direction === 'down';
    const from_x = (from.left + from.right) / 2;
    const from_y = (from.top + from.bottom) / 2;
    const to_x = (to.left + to.right) / 2;
    const to_y = (to.top + to.bottom) / 2;
    let gap: number;
    let beyond: boolean;
    switch (direction) {
        case 'down':
            gap = to.top - from.bottom;
            beyond = to_y > from_y && to.bottom > from.bottom;
            break;
        case 'up':
            gap = from.top - to.bottom;
            beyond = to_y < from_y && to.top < from.top;
            break;
        case 'right':
            gap = to.left - from.right;
            beyond = to_x > from_x && to.right > from.right;
            break;
        case 'left':
            gap = from.left - to.right;
            beyond = to_x < from_x && to.left < from.left;
            break;
    }
    if (!beyond) return Infinity;
    // Controls that overlap by more than a little along the direction are side by side, not beyond
    const size = vertical ? Math.min(from.height, to.height) : Math.min(from.width, to.width);
    if (gap < -size / 4) return Infinity;
    const [start, end, to_start, to_end, to_center] = vertical
        ? [from.left, from.right, to.left, to.right, to_x]
        : [from.top, from.bottom, to.top, to.bottom, to_y];
    const across = Math.max(0, to_start - end, start - to_end);
    // Among equally near controls, prefer the one whose centre lies within the span of the current one
    const off_center = Math.max(0, to_center - end, start - to_center);
    return Math.max(0, gap) + across * 2 + off_center / 1000;
}

function nearest(origin: HTMLElement, controls: HTMLElement[], direction: Direction): HTMLElement | null {
    const from = origin.getBoundingClientRect();
    const cache = new Map<Element, boolean>();
    const origin_scroller = scroll_parent(origin, cache);
    let best: HTMLElement | null = null;
    let best_distance = Infinity;
    for (const control of controls) {
        if (control === origin || origin.contains(control)) continue;
        const rect = control.getBoundingClientRect();
        // Controls scrolled out of sight are only reachable from inside their own scrolling box
        const scroller = scroll_parent(control, cache);
        if (scroller && scroller !== origin_scroller && !overlaps(rect, scroller.getBoundingClientRect())) continue;
        const d = distance(from, rect, direction);
        if (d < best_distance) {
            best = control;
            best_distance = d;
        }
    }
    return best;
}

function handle_key(stage: HTMLElement, event: KeyboardEvent) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (event.key === 'Escape') {
        // Open dialogs close themselves on Escape
        if (!stage.querySelector('.gp-dialog') && active && active !== stage && stage.contains(active)) active.blur();
        return;
    }

    const direction = DIRECTIONS[event.key];
    if (!direction) return;
    if (is_text_field(active)) {
        if (!(active instanceof HTMLInputElement)) return;
        // Left/Right move the caret, Shift+Up/Down select
        if (direction === 'left' || direction === 'right' || event.shiftKey) return;
    }

    const layer = top_layer(stage);
    const controls = controls_in(layer);
    if (controls.length === 0) return;
    let origin = active && active !== layer && layer.contains(active) ? active : null;
    // A cycler is one stop, even when one of its arrow buttons has the focus
    origin = origin?.closest<HTMLElement>('.gp-cycler') ?? origin;
    const target = origin ? nearest(origin, controls, direction) : default_control(controls);
    if (!target) return;
    event.preventDefault();
    move_focus(target);
}

/**
 * Installs the arrow-key navigation for a stage. `skip` can claim keydown events for something else
 * (the navigation then ignores them entirely); it is read on every key, so it may change between renders.
 */
export function useKeyboardNav(stage: RefObject<HTMLElement>, skip?: (event: KeyboardEvent) => boolean) {
    const skip_ref = useRef(skip);
    skip_ref.current = skip;

    useEffect(() => {
        const element = stage.current;
        if (!element) return;
        stages.add(element);
        const handler = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            if (skip_ref.current?.(event)) return;
            handle_key(element, event);
        };
        window.addEventListener('keydown', handler);
        return () => {
            window.removeEventListener('keydown', handler);
            stages.delete(element);
        };
    }, []);
}

/**
 * Focus handling of a modal dialog. On opening, the focus moves into the dialog (unless a field in it took it
 * already): onto its default control when the keyboard was in use, otherwise onto the dialog itself, so keys
 * no longer reach the control behind it. On closing, a keyboard user gets the focus back where it was.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement>) {
    // Read while rendering: when the effect runs, an autofocused field inside may already have the focus
    const [opener] = useState(() => {
        if (typeof document === 'undefined') return null;
        const element = document.activeElement;
        return element instanceof HTMLElement && element !== document.body
            ? { element, keyboard: element === keyboard_focused }
            : null;
    });

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (!element.contains(document.activeElement)) {
            const target = opener?.keyboard ? default_control(controls_in(element)) : null;
            if (target) move_focus(target);
            else element.focus({ preventScroll: true });
        }
        return () => {
            // The dialog is still in the document here; it is removed right after this cleanup
            const active = document.activeElement;
            if (!opener || !element.contains(active) || active !== keyboard_focused) return;
            queueMicrotask(() => {
                const now = document.activeElement;
                if (now && now !== document.body) return;
                if (opener.element.isConnected && is_control(opener.element) && is_shown(opener.element))
                    move_focus(opener.element);
            });
        };
    }, []);
}
