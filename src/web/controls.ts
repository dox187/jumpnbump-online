/** Input devices a player can choose, and helpers for naming and mapping gamepads. */
import { DEFAULT_CONTROLS } from '../constants';

type ControlMapping = {
    id: string;
    name: string;
    type: 'keyboard' | 'mouse' | 'gamepad';
    mappings: (string | number)[];
};

export const MAPPINGS: ControlMapping[] = [
    { id: 'keyboard_arrows', name: 'Keyboard (Arrow Keys)', type: 'keyboard', mappings: DEFAULT_CONTROLS[0].mappings },
    { id: 'keyboard_awd', name: 'Keyboard (A, W, D)', type: 'keyboard', mappings: DEFAULT_CONTROLS[1].mappings },
    { id: 'keyboard_jil', name: 'Keyboard (J, I, L)', type: 'keyboard', mappings: DEFAULT_CONTROLS[2].mappings },
    { id: 'keyboard_numpad', name: 'Keyboard (Numpad)', type: 'keyboard', mappings: DEFAULT_CONTROLS[3].mappings },
    { id: 'mouse', name: 'Mouse (Left Click, Middle Button, Right Click)', type: 'mouse', mappings: [0, 2, 1] },
];

const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');

const KNOWN_GAMEPAD_DEFAULTS: Array<{ pattern: string; defaults: { chrome?: string[]; firefox?: string[] } }> = [
    {
        pattern: '8BitDo Micro',
        defaults: {
            chrome: ['axis_0_neg_0.00', 'axis_0_pos_0.00', 'button_0'],
            firefox: ['axis_1_neg_0.00', 'axis_1_pos_0.00', 'button_0'],
        },
    },
    {
        pattern: 'Joy-Con (L)',
        defaults: {
            chrome: ['axis_0_neg_0.00', 'axis_0_pos_0.00', 'button_1'],
        },
    },
    {
        pattern: 'Joy-Con (R)',
        defaults: {
            chrome: ['axis_0_neg_0.00', 'axis_0_pos_0.00', 'button_1'],
        },
    },
];

export const getKnownGamepadDefaults = (gamepadId: string): string[] | null => {
    const lowerGamepadId = gamepadId.toLowerCase();
    const known = KNOWN_GAMEPAD_DEFAULTS.find((k) => lowerGamepadId.includes(k.pattern.toLowerCase()));
    if (!known) return null;
    const browser = isFirefox ? 'firefox' : 'chrome';
    return known.defaults[browser] ?? null;
};

export const getFriendlyGamepadName = (gamepad: Gamepad) => {
    const id = gamepad.id.replace(/^[\da-zA-Z]+\-[\da-zA-Z]+\-/, '');
    return `${id} (${gamepad.index + 1})`;
};

export const getGamepadId = (gamepad: Gamepad) => {
    return gamepad.id + '_' + gamepad.index;
};
