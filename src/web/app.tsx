// Changed by dox187 on 2026-09-29 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import { useEffect } from 'preact/hooks';
import {
    hydrate,
    lazy,
    prerender as ssr,
    LocationProvider,
    ErrorBoundary,
    Router,
    Route,
    useLocation,
} from 'preact-iso';
import { PageMeta } from './hooks/page-meta';

import './app.css';

const Local = lazy(() => import('./pages/local'));
const Online = lazy(() => import('./pages/online'));

/** Unknown addresses, including the pages of the old website, lead to the start page. */
function NotFound() {
    const { route } = useLocation();
    useEffect(() => route('/', true), []);
    return null;
}

function App() {
    return (
        <LocationProvider>
            <ErrorBoundary>
                <Router>
                    <Route path="/" component={Online} />
                    <Route path="/local" component={Local} />
                    <Route default component={NotFound} />
                </Router>
            </ErrorBoundary>
        </LocationProvider>
    );
}

if (typeof window !== 'undefined') {
    hydrate(<App />, document.getElementById('app'));
}

function getHeadElements(meta: PageMeta) {
    return [
        { type: 'meta', props: { name: 'description', content: meta.description } },
        ...(meta.robots ? [{ type: 'meta', props: { name: 'robots', content: meta.robots } }] : []),
    ];
}

export async function prerender() {
    const { html, links } = await ssr(<App />);

    return {
        html,
        links,
        head: {
            title: globalThis.title,
            elements: getHeadElements(globalThis._meta || {}),
        },
    };
}
