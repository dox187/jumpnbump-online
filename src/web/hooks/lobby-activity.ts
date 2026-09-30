import { useEffect } from 'preact/hooks';
import { net } from '../../net/client';

/** Browsing keeps a connection alive; simply leaving a tab open does not. */
export function useLobbyActivity(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        const active = () => {
            if (!document.hidden) net.activity();
        };
        // Capture includes scrolling containers, text fields and the synthetic keys from gamepad navigation.
        const events = ['pointerdown', 'pointermove', 'click', 'keydown', 'input', 'wheel', 'scroll', 'focus'];
        for (const event of events) window.addEventListener(event, active, { capture: true, passive: true });
        document.addEventListener('visibilitychange', active);
        return () => {
            for (const event of events) window.removeEventListener(event, active, true);
            document.removeEventListener('visibilitychange', active);
        };
    }, [enabled]);
}
