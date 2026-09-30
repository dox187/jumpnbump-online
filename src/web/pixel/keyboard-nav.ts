/**
 * Game-style keyboard control of the pixel UI. The arrow keys move the focus to the nearest control in that
 * direction within the topmost layer (the last open dialog, otherwise the stage); Enter and Space activate the
 * focused control natively. Dialogs take the focus when they open and give it back when they close.
 *
 * Gamepads work the same menus (see the end of this file): the D-pad or left stick are the arrow keys, A is
 * Enter, B or Back is Escape, and Start moves into the menu like Tab.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
    GamepadPresses,
    PAD_A,
    PAD_B,
    PAD_BACK,
    PAD_DOWN,
    PAD_LEFT,
    PAD_RIGHT,
    PAD_START,
    PAD_UP,
    STICK_DEAD_ZONE,
    pad_pressed,
    standard_gamepads,
} from '../../extra-input';

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
const ARROW_KEYS: Record<Direction, string> = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
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
        start_gamepad_polling();
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

/*
 * Gamepads in the menus. While at least one gamepad with the standard layout is connected and a stage is on the
 * page, a frame loop reads them and works the topmost stage like the keyboard does:
 *  - D-pad or left stick: arrow keys, repeating while held like keyboard auto-repeat,
 *  - A: Enter on the focused control (a click); with nothing focused it focuses a control first, like an arrow
 *    key; on a text field it does nothing, so it never submits a form by surprise,
 *  - B or Back: Escape (closes the dialog, or leaves the menu),
 *  - Start: into the menu, like Tab.
 * Arrows and Escape are sent to the focused element as key events, so dialogs, cyclers and the navigation
 * above handle them exactly like real keys (such synthetic events have no default action of their own).
 */

/** First repeat after a direction is held, then the time between repeats (ms). */
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 130;

/** Things that steer with the gamepads while they return true (the room's bunny); see lend_gamepads. */
const gamepad_lenders = new Set<() => boolean>();
/** Open views that read the gamepad buttons themselves (the gamepad setup); see useGamepadCapture. */
let gamepad_captures = 0;

let pad_frame = 0;
let pad_presses = new GamepadPresses();
let pad_direction_held: Direction | null = null;
let pad_repeat_at = Infinity;

/**
 * Lets the gamepads steer something else, like your bunny in the room: while `steering()` returns true the
 * menus leave the D-pad, stick, A and B alone, and Start moves into the menu. Returns the function that ends it.
 */
export function lend_gamepads(steering: () => boolean): () => void {
    const lender = () => steering();
    gamepad_lenders.add(lender);
    return () => gamepad_lenders.delete(lender);
}

/** While `active`, the menus ignore the gamepads, e.g. while the setup dialog records a button mapping. */
export function useGamepadCapture(active: boolean) {
    useEffect(() => {
        if (!active) return;
        gamepad_captures++;
        return () => {
            gamepad_captures--;
        };
    }, [active]);
}

function pad_direction(gamepads: readonly Gamepad[]): Direction | null {
    for (const gamepad of gamepads) {
        if (pad_pressed(gamepad, PAD_UP)) return 'up';
        if (pad_pressed(gamepad, PAD_DOWN)) return 'down';
        if (pad_pressed(gamepad, PAD_LEFT)) return 'left';
        if (pad_pressed(gamepad, PAD_RIGHT)) return 'right';
        const x = gamepad.axes[0] ?? 0;
        const y = gamepad.axes[1] ?? 0;
        if (Math.max(Math.abs(x), Math.abs(y)) > STICK_DEAD_ZONE) {
            if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
            return y < 0 ? 'up' : 'down';
        }
    }
    return null;
}

/** A key press on the focused element, for the key handlers of the page. */
function send_key(key: string) {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const init = { key, code: key, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/**
 * Into the menu, like Tab: the focused control of the top layer, else its default control, gets the focus as
 * from the keyboard (highlighted, and has_keyboard_focus() becomes true).
 */
function pad_enter(stage: HTMLElement) {
    const controls = controls_in(top_layer(stage));
    const active = document.activeElement;
    const target = active instanceof HTMLElement && controls.includes(active) ? active : default_control(controls);
    if (!target || (target === active && target === keyboard_focused)) return;
    // A control focused with the mouse is focused again, now from the "keyboard"
    if (target === active) target.blur();
    move_focus(target);
}

/** A: like Enter on the focused control. */
function pad_activate(stage: HTMLElement) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !top_layer(stage).contains(active) || !is_control(active)) {
        pad_enter(stage);
        return;
    }
    // A text field keeps the focus (Enter would submit its form); typing needs a keyboard anyway
    if (is_text_field(active)) return;
    // Only a highlighted control is activated; one focused with the mouse is highlighted first
    if (active !== keyboard_focused) {
        pad_enter(stage);
        return;
    }
    const clickable = active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement;
    if (clickable || active instanceof HTMLInputElement) active.click();
    else send_key('Enter');
}

function poll_gamepads(now: number) {
    pad_frame = 0;
    const gamepads = standard_gamepads();
    let stage: HTMLElement | undefined;
    for (const element of stages) stage = element;
    // Stops without gamepads or stages; gamepadconnected or the next stage starts it again
    if (!stage || gamepads.length === 0) return;
    pad_frame = requestAnimationFrame(poll_gamepads);
    pad_presses.poll(gamepads);

    const direction = pad_direction(gamepads);
    const changed = direction !== pad_direction_held;
    pad_direction_held = direction;
    const steering = gamepad_captures === 0 && [...gamepad_lenders].some((lender) => lender());
    if (gamepad_captures > 0 || steering || document.hidden) {
        // A direction held now moves through the menu only after it is let go
        pad_repeat_at = Infinity;
        if (steering && pad_presses.went_down(PAD_START)) pad_enter(stage);
        return;
    }

    if (direction && (changed || now >= pad_repeat_at)) {
        pad_repeat_at = now + (changed ? REPEAT_DELAY : REPEAT_INTERVAL);
        send_key(ARROW_KEYS[direction]);
    } else if (!direction) pad_repeat_at = Infinity;
    if (pad_presses.went_down(PAD_A)) pad_activate(stage);
    if (pad_presses.went_down(PAD_B, PAD_BACK)) send_key('Escape');
    if (pad_presses.went_down(PAD_START)) pad_enter(stage);
}

/** Starts the gamepad loop when there is a stage and a gamepad; buttons held at that moment count once let go. */
function start_gamepad_polling() {
    if (pad_frame || stages.size === 0) return;
    const gamepads = standard_gamepads();
    if (gamepads.length === 0) return;
    pad_presses = new GamepadPresses();
    pad_presses.poll(gamepads);
    pad_direction_held = pad_direction(gamepads);
    pad_repeat_at = Infinity;
    pad_frame = requestAnimationFrame(poll_gamepads);
}

if (typeof window !== 'undefined') window.addEventListener('gamepadconnected', start_gamepad_polling);
