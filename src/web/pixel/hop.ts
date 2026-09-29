/**
 * Hopping around the menu forest in an online room, like in the local game's menu.
 *
 * HopBunny is the per-bunny movement of menu_game_loop in src/menu.ts (the branch that runs before the game
 * starts), in the same 16.16 fixed point and menu screen coordinates (400x256). Differences from the menu:
 *  - no smoke objects or jump sounds; `HopEffects` hooks are called where the menu made them,
 *  - running off the right edge does not start a game: the right edge is a wall like the left one,
 *  - every bunny moves on its own, so bunnies never collide or land on each other's heads.
 */
import { player_anims } from '../../animation';
import { SCREEN_WIDTH } from '../../constants';
import type { GameInputDevice } from '../../inputs';
import { INPUT_LEFT, INPUT_RIGHT, INPUT_UP } from '../../sim/sim';

/** The rightmost x (menu pixels) of the 16 pixel wide player box, so the bunny stays on screen. */
export const HOP_MAX_X = SCREEN_WIDTH - 16;

/**
 * Where each bunny stands when nobody moves it (menu coordinates of the player box). The physics puts bunny
 * `c1` on the grass at y 160 + c1 * 2 and on the log (x between 165 + c1 * 2 and 208 + c1 * 2) at 138 + c1 * 2.
 */
export const HOP_SPOTS: readonly { x: number; y: number; direction: number }[] = [
    { x: 30, y: 160, direction: 0 },
    { x: 110, y: 162, direction: 0 },
    { x: 186, y: 142, direction: 1 },
    { x: 266, y: 166, direction: 1 },
];

/** Optional cosmetic hooks at the places where the menu made smoke puffs and played the jump sound. */
export type HopEffects = {
    /** A smoke puff at a menu pixel position (the menu used x + 2 + rnd(9), y + 13 + rnd(5)). */
    smoke?: (x: number, y: number) => void;
    jump?: () => void;
};

const rnd = (max: number) => Math.floor(Math.random() * max);

export class HopBunny {
    readonly slot: number;
    private effects: HopEffects | null;
    private _x = 0;
    private _y = 0;
    private x_add = 0;
    private y_add = 0;
    private direction = 0;
    private jump_ready = 1;
    private anim = 0;
    private frame = 0;
    private frame_tick = 0;
    private _image = 0;
    private action_left = false;
    private action_right = false;
    private action_up = false;

    constructor(slot: number, effects: HopEffects | null = null) {
        this.slot = slot;
        this.effects = effects;
        this.reset();
    }

    /** Menu x of the player box, in pixels. */
    get x() {
        return this._x >> 16;
    }

    /** Menu y of the player box, in pixels. */
    get y() {
        return this._y >> 16;
    }

    /** Sprite 0-17 of this bunny's set in rabbit.gob (including direction * 9); add slot * 18 to draw it. */
    get image() {
        return this._image;
    }

    /** Back to the bunny's spot, standing still. */
    reset() {
        const spot = HOP_SPOTS[this.slot];
        this._x = spot.x << 16;
        this._y = spot.y << 16;
        this.x_add = 0;
        this.y_add = 0;
        this.direction = spot.direction;
        this.jump_ready = 1;
        this.anim = 0;
        this.frame = 0;
        this.frame_tick = 0;
        this.action_left = this.action_right = this.action_up = false;
        this._image = player_anims[this.anim].frame[this.frame].image + this.direction * 9;
    }

    private smoke() {
        this.effects?.smoke?.((this._x >> 16) + 2 + rnd(9), (this._y >> 16) + 13 + rnd(5));
    }

    private set_anim(anim: number) {
        this.anim = anim;
        this.frame = 0;
        this.frame_tick = 0;
        this._image = player_anims[this.anim].frame[this.frame].image + this.direction * 9;
    }

    /** One 60 Hz menu frame with the INPUT_LEFT / INPUT_RIGHT / INPUT_UP bits of `mask`. */
    step(mask: number) {
        const c1 = this.slot;
        const p = this;
        p.action_left = (mask & INPUT_LEFT) != 0;
        p.action_right = (mask & INPUT_RIGHT) != 0;
        p.action_up = (mask & INPUT_UP) != 0;

        if (p.action_left && p.action_right) {
            if (p.direction == 1) {
                if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
                    if (p.x_add > 0) {
                        p.x_add -= 16384;
                        if (p._y >> 16 >= 160 + c1 * 2) p.smoke();
                    } else p.x_add -= 12288;
                }
                if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 208 + c1 * 2) {
                    if (p.x_add > 0) {
                        p.x_add -= 16384;
                        if (p._y >> 16 >= 138 + c1 * 2) p.smoke();
                    } else p.x_add -= 12288;
                }
                if (p.x_add < -98304) p.x_add = -98304;
                p.direction = 1;
                if (p.anim == 0) p.set_anim(1);
            } else {
                if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
                    if (p.x_add < 0) {
                        p.x_add += 16384;
                        if (p._y >> 16 >= 160 + c1 * 2) p.smoke();
                    } else p.x_add += 12288;
                }
                if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 208 + c1 * 2) {
                    if (p.x_add < 0) {
                        p.x_add += 16384;
                        if (p._y >> 16 >= 138 + c1 * 2) p.smoke();
                    } else p.x_add += 12288;
                }
                if (p.x_add > 98304) p.x_add = 98304;
                p.direction = 0;
                if (p.anim == 0) p.set_anim(1);
            }
        } else if (p.action_left) {
            if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
                if (p.x_add > 0) {
                    p.x_add -= 16384;
                    if (p._y >> 16 >= 160 + c1 * 2) p.smoke();
                } else p.x_add -= 12288;
            }
            if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 208 + c1 * 2) {
                if (p.x_add > 0) {
                    p.x_add -= 16384;
                    if (p._y >> 16 >= 138 + c1 * 2) p.smoke();
                } else p.x_add -= 12288;
            }
            if (p.x_add < -98304) p.x_add = -98304;
            p.direction = 1;
            if (p.anim == 0) p.set_anim(1);
        } else if (p.action_right) {
            if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
                if (p.x_add < 0) {
                    p.x_add += 16384;
                    if (p._y >> 16 >= 160 + c1 * 2) p.smoke();
                } else p.x_add += 12288;
            }
            if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 208 + c1 * 2) {
                if (p.x_add < 0) {
                    p.x_add += 16384;
                    if (p._y >> 16 >= 138 + c1 * 2) p.smoke();
                } else p.x_add += 12288;
            }
            if (p.x_add > 98304) p.x_add = 98304;
            p.direction = 0;
            if (p.anim == 0) p.set_anim(1);
        } else {
            if ((p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) && p._y >> 16 >= 160 + c1 * 2) {
                if (p.x_add < 0) {
                    p.x_add += 16384;
                    if (p.x_add > 0) p.x_add = 0;
                    p.smoke();
                } else if (p.x_add > 0) {
                    p.x_add -= 16384;
                    if (p.x_add < 0) p.x_add = 0;
                    p.smoke();
                }
            }
            if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 208 + c1 * 2 && p._y >> 16 >= 138 + c1 * 2) {
                if (p.x_add < 0) {
                    p.x_add += 16384;
                    if (p.x_add > 0) p.x_add = 0;
                    p.smoke();
                } else if (p.x_add > 0) {
                    p.x_add -= 16384;
                    if (p.x_add < 0) p.x_add = 0;
                    p.smoke();
                }
            }
            if (p.anim == 1) p.set_anim(0);
        }
        if (p.jump_ready == 1 && p.action_up) {
            if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
                if (p._y >> 16 >= 160 + c1 * 2) {
                    p.y_add = -280000;
                    p.set_anim(2);
                    p.jump_ready = 0;
                    p.effects?.jump?.();
                }
            } else {
                if (p._y >> 16 >= 138 + c1 * 2) {
                    p.y_add = -280000;
                    p.set_anim(2);
                    p.jump_ready = 0;
                    p.effects?.jump?.();
                }
            }
        }
        if (!p.action_up) {
            if (p.y_add < 0) {
                p.y_add += 32768;
                if (p.y_add > 0) p.y_add = 0;
            }
        }
        if (!p.action_up) p.jump_ready = 1;
        p.y_add += 12288;
        if (p.y_add > 36864 && p.anim != 3) p.set_anim(3);
        p._y += p.y_add;
        if (p._x >> 16 <= 165 + c1 * 2 || p._x >> 16 >= 208 + c1 * 2) {
            if (p._y >> 16 > 160 + c1 * 2) {
                p._y = (160 + c1 * 2) << 16;
                p.y_add = 0;
                if (p.anim != 0 && p.anim != 1) p.set_anim(0);
            }
        } else {
            if (p._y >> 16 > 138 + c1 * 2) {
                p._y = (138 + c1 * 2) << 16;
                p.y_add = 0;
                if (p.anim != 0 && p.anim != 1) p.set_anim(0);
            }
        }
        p._x += p.x_add;
        if (p._x >> 16 < 0) {
            p._x = 0;
            p.x_add = 0;
        }
        // The menu started the game here once a bunny ran past the right edge; online it is a wall
        if (p._x >> 16 > HOP_MAX_X) {
            p._x = HOP_MAX_X << 16;
            p.x_add = 0;
        }
        if (p._y >> 16 > 138 + c1 * 2) {
            if (p._x >> 16 > 165 + c1 * 2 && p._x >> 16 < 190 + c1 * 2) {
                p._x = (165 + c1 * 2) << 16;
                p.x_add = 0;
            }
            if (p._x >> 16 > 190 + c1 * 2 && p._x >> 16 < 208 + c1 * 2) {
                p._x = (208 + c1 * 2) << 16;
                p.x_add = 0;
            }
        }

        p.frame_tick++;
        if (p.frame_tick >= player_anims[p.anim].frame[p.frame].ticks) {
            p.frame++;
            if (p.frame >= player_anims[p.anim].num_frames) p.frame = player_anims[p.anim].restart_frame;
            p.frame_tick = 0;
        }
        p._image = player_anims[p.anim].frame[p.frame].image + p.direction * 9;
    }
}

/** Whether key presses on this element type text (they must not move the bunny). */
export function is_text_field(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
        return true;
    if (!(target instanceof HTMLInputElement)) return false;
    return !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type);
}

function mapping_pressed(
    device: GameInputDevice,
    mapping: string | undefined,
    keys: ReadonlySet<string>,
    mouse_buttons: ReadonlySet<number>,
    gamepads: readonly (Gamepad | null)[]
): boolean {
    if (mapping === undefined || mapping === '') return false;

    if (device.type === 'keyboard') return keys.has(mapping);

    if (device.type === 'mouse') return mouse_buttons.has(Number(mapping));

    if (device.type === 'gamepad') {
        // The same rules as read_device_input in src/sdl/input.ts; device ids are "gamepad.id_gamepad.index"
        const gamepad = Array.from(gamepads).find((gp) => gp && `${gp.id}_${gp.index}` === device.id);
        if (!gamepad) return false;

        if (mapping.startsWith('button_')) {
            const buttonIndex = parseInt(mapping.replace('button_', ''), 10);
            return gamepad.buttons[buttonIndex]?.pressed ?? false;
        }

        if (mapping.startsWith('axis_')) {
            const parts = mapping.split('_'); // ['axis', index, 'pos'|'neg', baseline?]
            const axisIndex = parseInt(parts[1], 10);
            const direction = parts[2];
            const baseline = parts[3] !== undefined ? parseFloat(parts[3]) : 0;
            const value = gamepad.axes[axisIndex] ?? 0;
            return direction === 'pos' ? value - baseline > 0.5 : value - baseline < -0.5;
        }
    }

    return false;
}

/** The INPUT_* mask of a control device (mappings: left, right, jump), like read_device_input does in a game. */
export function read_input_mask(
    device: GameInputDevice,
    keys: ReadonlySet<string>,
    mouse_buttons: ReadonlySet<number>,
    gamepads: readonly (Gamepad | null)[]
): number {
    let mask = 0;
    if (mapping_pressed(device, device.mappings[0], keys, mouse_buttons, gamepads)) mask |= INPUT_LEFT;
    if (mapping_pressed(device, device.mappings[1], keys, mouse_buttons, gamepads)) mask |= INPUT_RIGHT;
    if (mapping_pressed(device, device.mappings[2], keys, mouse_buttons, gamepads)) mask |= INPUT_UP;
    return mask;
}

export type InputTracker = {
    /** KeyboardEvent.code of every key held down. */
    keys: ReadonlySet<string>;
    /** MouseEvent.button of every mouse button held down. */
    mouse_buttons: ReadonlySet<number>;
    dispose: () => void;
};

/**
 * Keeps track of the held keys and mouse buttons through window listeners, without taking over the page:
 * nothing is prevented, so buttons, focus and keyboard navigation work as before. Keys typed into text
 * fields and key combinations with Ctrl, Alt or Meta are not counted; everything is released when the
 * window loses focus or the page is hidden or shown again.
 */
export function track_input(): InputTracker {
    const keys = new Set<string>();
    const mouse_buttons = new Set<number>();

    const keydown = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.altKey || e.metaKey || is_text_field(e.target)) return;
        keys.add(e.code);
    };
    // Releases always count, so a key held while focus moved into a text field does not get stuck
    const keyup = (e: KeyboardEvent) => keys.delete(e.code);
    const mousedown = (e: MouseEvent) => mouse_buttons.add(e.button);
    const mouseup = (e: MouseEvent) => mouse_buttons.delete(e.button);
    const release = () => {
        keys.clear();
        mouse_buttons.clear();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('mousedown', mousedown);
    window.addEventListener('mouseup', mouseup);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);

    return {
        keys,
        mouse_buttons,
        dispose: () => {
            window.removeEventListener('keydown', keydown);
            window.removeEventListener('keyup', keyup);
            window.removeEventListener('mousedown', mousedown);
            window.removeEventListener('mouseup', mouseup);
            window.removeEventListener('blur', release);
            document.removeEventListener('visibilitychange', release);
            release();
        },
    };
}
