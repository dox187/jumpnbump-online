import { useEffect, useState } from 'preact/hooks';

export type OnlineSettings = {
    name: string;
    /** A control id from the controls component: keyboard_arrows, keyboard_awd, ..., mouse, or a gamepad id. */
    control: string;
    gamepadConfigs: Record<string, string[]>;
    muteMusic: boolean;
    muteEffects: boolean;
    noGore: boolean;
    noFlies: boolean;
    /** On-screen touch buttons; null follows the device (on for touch screens). */
    touch: boolean | null;
};

const STORAGE_KEY = 'online-settings';

const DEFAULT_SETTINGS: OnlineSettings = {
    name: '',
    control: 'keyboard_arrows',
    gamepadConfigs: {},
    muteMusic: false,
    muteEffects: false,
    noGore: false,
    noFlies: false,
    touch: null,
};

function load(): OnlineSettings {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return { ...DEFAULT_SETTINGS, ...stored };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/** One copy of the settings for the whole page, so every component sees a change at once. */
let current: OnlineSettings | null = null;
const listeners = new Set<(settings: OnlineSettings) => void>();

function update(patch: Partial<OnlineSettings>) {
    const next = { ...(current ?? load()), ...patch };
    current = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // private mode or storage disabled: keep the settings for this visit only
    }
    for (const listener of listeners) listener(next);
}

/** Whether a device with a touch screen and no mouse is in use. */
export function prefers_touch() {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** The effective touch button setting. */
export function touch_enabled(settings: OnlineSettings) {
    return settings.touch ?? prefers_touch();
}

/** Per-browser settings, remembered in localStorage when it is available. */
export function useOnlineSettings(): [OnlineSettings, (patch: Partial<OnlineSettings>) => void, boolean] {
    const [settings, setSettings] = useState<OnlineSettings>(current ?? DEFAULT_SETTINGS);
    const [loaded, setLoaded] = useState(current !== null);

    useEffect(() => {
        if (!current) current = load();
        setSettings(current);
        setLoaded(true);
        listeners.add(setSettings);
        return () => {
            listeners.delete(setSettings);
        };
    }, []);

    return [settings, update, loaded];
}
