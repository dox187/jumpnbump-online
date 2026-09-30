import { KEY } from '../constants';
import { poll_events, get_mouse_buttons } from './events';
import { toggle_fullscreen } from './gfx';
import ctx from '../context';
import { GamepadPresses, PAD_BACK, PAD_START } from '../extra-input';

let lastTick = 0;
const TICK_LENGTH = 1000 / 60;

const keyb: Record<string, boolean> = {};
/** Keys that went down during the latest intr_sysupdate, so taps shorter than a frame are not lost. */
const went_down = new Set<string>();

export const last_keys: string[] = new Array(50);

/** Gamepad buttons, read once per intr_sysupdate; Start or Back work as the Escape key. */
const gamepad_presses = new GamepadPresses();
let gamepad_escape = false;

const AI_HOTKEYS = [KEY.ONE, KEY.TWO, KEY.THREE, KEY.FOUR];
let ai_hotkeys_enabled = true;

/** Online matches must not let the 1-4 keys hand a bunny to the computer. */
export function set_ai_hotkeys_enabled(enabled: boolean) {
    ai_hotkeys_enabled = enabled;
}

function add_last_key(key: string) {
    for (let i = 49; i > 0; i--) {
        last_keys[i] = last_keys[i - 1];
    }
    last_keys[0] = key;
}

function getTicks() {
    return performance.now();
}

export function key_pressed(key: string) {
    return keyb[key] || (key === KEY.ESCAPE && gamepad_escape);
}

export function key_went_down(key: string) {
    return went_down.has(key);
}

/** True when one of the standard gamepad `buttons` went down during the latest intr_sysupdate. */
export function gamepad_went_down(...buttons: number[]) {
    return gamepad_presses.went_down(...buttons);
}

export function mouse_button_pressed(button: number): boolean {
    return get_mouse_buttons()[button] ?? false;
}

export function addkey(key: string, pressed: boolean = false) {
    return (keyb[key] = pressed);
}

export function intr_sysupdate(): number {
    if (lastTick === 0) {
        lastTick = getTicks();
    }

    went_down.clear();
    for (const event of poll_events()) {
        if (event.type === 'keydown' && !event.repeat) went_down.add(event.scancode);
        switch (event.type) {
            case 'keydown':
            case 'keyup':
                if (event.repeat) {
                    continue;
                }
                const is_ai_hotkey = AI_HOTKEYS.includes(event.scancode as KEY);
                switch (ai_hotkeys_enabled || !is_ai_hotkey ? event.scancode : '') {
                    case KEY.ONE:
                        if (event.type === 'keydown') {
                            ctx.ai[0] = !ctx.ai[0] ? 1 : 0;
                        }
                        // release any pressed keys
                        addkey(KEY.PL1_LEFT, false);
                        addkey(KEY.PL1_RIGHT, false);
                        addkey(KEY.PL1_JUMP, false);
                        break;
                    case KEY.TWO:
                        if (event.type === 'keydown') {
                            ctx.ai[1] = !ctx.ai[1] ? 1 : 0;
                        }
                        // release any pressed keys
                        addkey(KEY.PL2_LEFT, false);
                        addkey(KEY.PL2_RIGHT, false);
                        addkey(KEY.PL2_JUMP, false);
                        break;
                    case KEY.THREE:
                        if (event.type === 'keydown') {
                            ctx.ai[2] = !ctx.ai[2] ? 1 : 0;
                        }
                        // release any pressed keys
                        addkey(KEY.PL3_LEFT, false);
                        addkey(KEY.PL3_RIGHT, false);
                        addkey(KEY.PL3_JUMP, false);
                        break;
                    case KEY.FOUR:
                        if (event.type === 'keydown') {
                            ctx.ai[3] = !ctx.ai[3] ? 1 : 0;
                        }
                        // release any pressed keys
                        addkey(KEY.PL4_LEFT, false);
                        addkey(KEY.PL4_RIGHT, false);
                        addkey(KEY.PL4_JUMP, false);
                        break;
                    case KEY.F:
                        if (event.key === 'F' && event.type === 'keydown') {
                            toggle_fullscreen();
                            break;
                        }
                    default:
                        if (event.type === 'keyup') {
                            add_last_key(event.key);
                        }
                        addkey(event.scancode, event.type === 'keydown');
                        break;
                }
                break;
            default:
                break;
        }
    }

    gamepad_presses.poll();
    gamepad_escape = gamepad_presses.held_down(PAD_START, PAD_BACK);
    if (gamepad_presses.went_down(PAD_START, PAD_BACK)) went_down.add(KEY.ESCAPE);

    const nextTick = lastTick + TICK_LENGTH;
    const now = getTicks();
    let numOfTicks = 0;

    if (now > nextTick) {
        const timeSinceTick = now - lastTick;
        numOfTicks = Math.floor(timeSinceTick / TICK_LENGTH);

        lastTick = lastTick + numOfTicks * TICK_LENGTH;
    }

    return numOfTicks;
}
