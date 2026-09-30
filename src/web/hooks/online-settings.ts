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
    /** On-screen touch buttons on phones and tablets; null means on. Computers never show them. */
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

/**
 * Whether this is a phone or a tablet rather than a computer (a laptop with a touch screen is a computer).
 * iPads report themselves as Macs, but Macs have no touch screen.
 */
export function is_mobile_device() {
    if (typeof navigator === 'undefined') return false;
    const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (hints?.mobile) return true;
    const agent = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(agent)) return true;
    return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1;
}

/** Whether the touch buttons show: only on phones and tablets, and there unless turned off. */
export function touch_enabled(settings: OnlineSettings) {
    return is_mobile_device() && settings.touch !== false;
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
