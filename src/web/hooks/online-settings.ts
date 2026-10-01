import { useEffect, useState } from 'preact/hooks';
import { dj_set_audio_preferences } from '../../sdl/sound';

export type OnlineSettings = {
    name: string;
    /** A control id from the controls component: keyboard_arrows, keyboard_awd, ..., mouse, or a gamepad id. */
    control: string;
    gamepadConfigs: Record<string, string[]>;
    muteMusic: boolean;
    muteEffects: boolean;
    musicVolume: number;
    effectsVolume: number;
    noGore: boolean;
    noFlies: boolean;
    /** Movement touch buttons on phones and tablets; null means on. Audio/fullscreen buttons always show. */
    touch: boolean | null;
    /** A still forest outside matches; null means on for phones and tablets, off for computers. */
    batterySaver: boolean | null;
};

const STORAGE_KEY = 'online-settings';

const DEFAULT_SETTINGS: OnlineSettings = {
    name: '',
    control: 'keyboard_arrows',
    gamepadConfigs: {},
    muteMusic: false,
    muteEffects: false,
    musicVolume: 100,
    effectsVolume: 100,
    noGore: false,
    noFlies: false,
    touch: null,
    batterySaver: null,
};

function load(): OnlineSettings {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {
            ...DEFAULT_SETTINGS,
            ...stored,
            musicVolume: saved_volume(stored.musicVolume),
            effectsVolume: saved_volume(stored.effectsVolume),
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saved_volume(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
}

function apply_audio(settings: OnlineSettings) {
    dj_set_audio_preferences(settings.muteMusic, settings.muteEffects, settings.musicVolume, settings.effectsVolume);
}

/** One copy of the settings for the whole page, so every component sees a change at once. */
let current: OnlineSettings | null = null;
const listeners = new Set<(settings: OnlineSettings) => void>();

function update(patch: Partial<OnlineSettings>) {
    const next = { ...(current ?? load()), ...patch };
    current = next;
    apply_audio(next);
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

/** Whether the battery saver is on: by default on phones and tablets only. */
export function battery_saver_enabled(settings: OnlineSettings) {
    return settings.batterySaver ?? is_mobile_device();
}

/** Per-browser settings, remembered in localStorage when it is available. */
export function useOnlineSettings(): [OnlineSettings, (patch: Partial<OnlineSettings>) => void, boolean] {
    const [settings, setSettings] = useState<OnlineSettings>(current ?? DEFAULT_SETTINGS);
    const [loaded, setLoaded] = useState(current !== null);

    useEffect(() => {
        if (!current) {
            current = load();
            apply_audio(current);
        }
        setSettings(current);
        setLoaded(true);
        listeners.add(setSettings);
        return () => {
            listeners.delete(setSettings);
        };
    }, []);

    return [settings, update, loaded];
}
