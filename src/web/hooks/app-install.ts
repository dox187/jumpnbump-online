import { useEffect, useState } from 'preact/hooks';

type InstallChoice = { outcome: 'accepted' | 'dismissed' };
type InstallPrompt = Event & {
    prompt(): Promise<unknown>;
    userChoice: Promise<InstallChoice>;
};
type InstallState = { visible: boolean; available: boolean; pending: boolean };

let deferred: InstallPrompt | null = null;
let installed = false;
let pending = false;
let initialized = false;
const listeners = new Set<(state: InstallState) => void>();

function app_mode() {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    return (
        (navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia(
            '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)'
        ).matches ||
        // Entering fullscreen in a browser tab does not mean the game has been installed.
        (window.matchMedia('(display-mode: fullscreen)').matches &&
            !doc.fullscreenElement &&
            !doc.webkitFullscreenElement)
    );
}

function snapshot(): InstallState {
    return {
        visible: typeof window !== 'undefined' && !installed && !app_mode(),
        available: deferred !== null,
        pending,
    };
}

function notify() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
}

/** Start before loading the lazy pages, so an early install offer is kept for the menu button. */
export function init_app_install() {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferred = event as InstallPrompt;
        // A new offer can also arrive after uninstalling during this visit.
        installed = false;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        deferred = null;
        notify();
    });
    for (const mode of ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen']) {
        window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', notify);
    }
    document.addEventListener('fullscreenchange', notify);
    document.addEventListener('webkitfullscreenchange', notify);
    window.addEventListener('pageshow', notify);
}

/** Must be called directly from a click: the browser requires a user gesture to open its prompt. */
export async function prompt_app_install(): Promise<InstallChoice['outcome'] | 'unavailable' | 'pending'> {
    if (installed || app_mode()) return 'accepted';
    if (pending) return 'pending';
    const event = deferred;
    if (!event) return 'unavailable';
    // Each offer is single-use, even when dismissed. Do not reuse it on a second tap.
    deferred = null;
    pending = true;
    notify();
    try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') installed = true;
        return outcome;
    } catch {
        return 'unavailable';
    } finally {
        pending = false;
        notify();
    }
}

export function useAppInstall() {
    const [state, setState] = useState(snapshot);
    useEffect(() => {
        listeners.add(setState);
        setState(snapshot());
        return () => {
            listeners.delete(setState);
        };
    }, []);
    return state;
}
