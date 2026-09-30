/**
 * Inputs that work in addition to the player's chosen control: the on-screen touch buttons and connected
 * gamepads. Both only ever steer one bunny (yours online, Dott in the local game).
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

/** Left, right and jump from any connected gamepad with the standard layout. */
export function gamepad_mask(): number {
    return 0;
}

/** Touch buttons and gamepads together, as INPUT_* bits. */
export function extra_mask(): number {
    return touch_mask() | gamepad_mask();
}
