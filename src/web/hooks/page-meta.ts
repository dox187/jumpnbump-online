// Changed by dox187 on 2026-09-29 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import { useEffect } from 'preact/hooks';

export type PageMeta = {
    title: string;
    description: string;
    robots?: string;
};

function updateOrCreateMeta(name: string, value: string) {
    const existingMeta = document.querySelector(`meta[name="${name}"]`);
    if (existingMeta) {
        existingMeta.setAttribute('content', value);
        return;
    }
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute('content', value);
    document.head.appendChild(meta);
}

export function usePageMeta(meta: PageMeta) {
    if (typeof window === 'undefined') {
        globalThis.title = meta.title;
        globalThis._meta = meta;
    }

    useEffect(() => {
        document.title = meta.title;
        updateOrCreateMeta('description', meta.description);
        if (meta.robots) {
            updateOrCreateMeta('robots', meta.robots);
        } else {
            document.querySelector('meta[name="robots"]')?.remove();
        }
    }, [meta.title, meta.description, meta.robots]);
}
