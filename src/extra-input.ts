/**
 * Inputs that work in addition to the player's chosen control, without any setup: the on-screen touch buttons
 * and connected gamepads. Online both steer your bunny; in the local game touch steers Dott and gamepad n
 * steers bunny n (see src/sdl/input.ts).
 *
 * Gamepads are read automatically only when the browser reports the standard layout
 * (https://w3c.github.io/gamepad/#remapping), which covers the common controllers. Other pads number their
 * buttons and axes in a device-specific way (axes resting at -1, D-pads reported as a hat axis, the D-pad on
 * axis 1), so guessing could make a bunny run by itself; such a pad is left alone here and can still be picked
 * and set up in the Options.
 */
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP } from './sim/sim';

/** Held on-screen buttons; the touch controls write here. */
export const touch_input = { left: false, right: false, jump: false };

export function touch_mask(): number {
    let mask = 0;
    if (touch_input.left) mask |= INPUT_LEFT;
    if (touch_input.right) mask |= INPUT_RIGHT;
    if (touch_input.jump) mask |= INPUT_UP;
    return mask;
}

/** Button indices of the standard gamepad layout. */
export const PAD_A = 0;
export const PAD_B = 1;
export const PAD_BACK = 8;
export const PAD_START = 9;
export const PAD_UP = 12;
export const PAD_DOWN = 13;
export const PAD_LEFT = 14;
export const PAD_RIGHT = 15;

/** How far the left stick has to be pushed sideways to run (or to move through a menu). */
export const STICK_DEAD_ZONE = 0.5;

/** The connected gamepads with the standard layout, in the order the browser numbered them (connection order). */
export function standard_gamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    let gamepads: readonly (Gamepad | null)[];
    try {
        gamepads = navigator.getGamepads();
    } catch {
        // Blocked by a permissions policy
        return [];
    }
    const result: Gamepad[] = [];
    for (const gamepad of gamepads)
        if (gamepad && gamepad.connected && gamepad.mapping === 'standard') result.push(gamepad);
    return result;
}

export function pad_pressed(gamepad: Gamepad, button: number): boolean {
    return gamepad.buttons[button]?.pressed ?? false;
}

/**
 * Left and right on the D-pad or the left stick, jump on A or B. Up on the D-pad or the stick does not jump: it
 * is easily pressed by accident while running.
 */
export function pad_mask(gamepad: Gamepad): number {
    const x = gamepad.axes[0] ?? 0;
    let mask = 0;
    if (pad_pressed(gamepad, PAD_LEFT) || x < -STICK_DEAD_ZONE) mask |= INPUT_LEFT;
    if (pad_pressed(gamepad, PAD_RIGHT) || x > STICK_DEAD_ZONE) mask |= INPUT_RIGHT;
    if (pad_pressed(gamepad, PAD_A) || pad_pressed(gamepad, PAD_B)) mask |= INPUT_UP;
    return mask;
}

/** The gamepad picked as the player's control in the Options ("gamepad.id_gamepad.index"), or null. */
let configured_gamepad: string | null = null;

/**
 * Tells gamepad_mask which gamepad the player picked as their control: that one is read with its own button
 * mapping, so it is left out here (no double or conflicting mapping). Any other control id matches no gamepad.
 */
export function set_configured_gamepad(id: string | null) {
    configured_gamepad = id;
}

/** Left, right and jump from every standard gamepad except the configured one. */
export function gamepad_mask(): number {
    let mask = 0;
    for (const gamepad of standard_gamepads())
        if (`${gamepad.id}_${gamepad.index}` !== configured_gamepad) mask |= pad_mask(gamepad);
    return mask;
}

/** Local game: the n-th standard gamepad (in connection order) steers bunny n; the Options play no part there. */
export function player_gamepad_mask(player: number): number {
    const gamepad = standard_gamepads()[player];
    return gamepad ? pad_mask(gamepad) : 0;
}

/** Touch buttons and gamepads together, as INPUT_* bits. */
export function extra_mask(): number {
    return touch_mask() | gamepad_mask();
}

/**
 * Button presses (not holds) on the standard gamepads: `poll` once per frame, then `went_down` tells which
 * buttons went down since the previous poll. A button already held when a pad is first seen counts only
 * after it is released, so a press that woke the pad or left the previous screen does nothing here.
 */
export class GamepadPresses {
    private held = new Map<string, boolean[]>();
    private pressed = new Set<number>();
    private down = new Set<number>();

    poll(gamepads: readonly Gamepad[] = standard_gamepads()) {
        this.pressed.clear();
        this.down.clear();
        const seen = new Set<string>();
        for (const gamepad of gamepads) {
            const key = `${gamepad.id}_${gamepad.index}`;
            seen.add(key);
            const before = this.held.get(key);
            const now = gamepad.buttons.map((button) => button.pressed);
            now.forEach((pressed, i) => {
                if (!pressed) return;
                this.down.add(i);
                if (before && !before[i]) this.pressed.add(i);
            });
            this.held.set(key, now);
        }
        for (const key of this.held.keys()) if (!seen.has(key)) this.held.delete(key);
    }

    /** True when one of `buttons` went down on any pad between the last two polls. */
    went_down(...buttons: number[]): boolean {
        return buttons.some((button) => this.pressed.has(button));
    }

    /** True when one of `buttons` is held on any pad (as of the last poll). */
    held_down(...buttons: number[]): boolean {
        return buttons.some((button) => this.down.has(button));
    }
}
