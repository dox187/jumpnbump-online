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
};

function load(): OnlineSettings {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return { ...DEFAULT_SETTINGS, ...stored };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/** Per-browser settings for online play, remembered in localStorage when it is available. */
export function useOnlineSettings(): [OnlineSettings, (patch: Partial<OnlineSettings>) => void, boolean] {
    const [settings, setSettings] = useState<OnlineSettings>(DEFAULT_SETTINGS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setSettings(load());
        setLoaded(true);
    }, []);

    const update = (patch: Partial<OnlineSettings>) => {
        setSettings((previous) => {
            const next = { ...previous, ...patch };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // private mode or storage disabled: keep the settings for this visit only
            }
            return next;
        });
    };

    return [settings, update, loaded];
}
