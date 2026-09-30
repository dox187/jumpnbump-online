/** Fullscreen is a browser capability; installed web apps are the fallback on iPhones. */
export type FullscreenIssue = 'unavailable' | 'denied' | 'app';
export type FullscreenHelpProps = { issue: FullscreenIssue; onClose: () => void };
export const FULLSCREEN_HELP_EVENT = 'jnb-fullscreen-help';

type WebkitDocument = Document & {
    webkitFullscreenEnabled?: boolean;
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function is_ios() {
    return (
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    );
}

function app_mode() {
    return (
        window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

export function show_fullscreen_help(issue: FullscreenIssue) {
    window.dispatchEvent(new CustomEvent<FullscreenIssue>(FULLSCREEN_HELP_EVENT, { detail: issue }));
}

/** Call directly from a user gesture, before any await, to preserve transient user activation. */
export function toggle_fullscreen() {
    const doc = document as WebkitDocument;
    const root = document.documentElement as WebkitElement;
    const failed = () => show_fullscreen_help(app_mode() ? 'app' : 'denied');
    try {
        let result: Promise<void> | void;
        if (doc.fullscreenElement) result = doc.exitFullscreen();
        else if (doc.webkitFullscreenElement) result = doc.webkitExitFullscreen!();
        else if (window.matchMedia('(display-mode: fullscreen)').matches) {
            show_fullscreen_help('app');
            return;
        } else if (doc.fullscreenEnabled && root.requestFullscreen) result = root.requestFullscreen();
        else if (doc.webkitFullscreenEnabled && root.webkitRequestFullscreen) result = root.webkitRequestFullscreen();
        else {
            show_fullscreen_help(app_mode() ? 'app' : 'unavailable');
            return;
        }
        Promise.resolve(result).catch(failed);
    } catch {
        failed();
    }
}
