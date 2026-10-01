import type { IncomingMessage } from 'node:http';

/** Resolve sharing metadata on the server: link crawlers do not run the browser application. */
export function social_meta(html: string, request: IncomingMessage, trust_proxy: boolean): string {
    const first_header = (name: string) => {
        const value = request.headers[name];
        return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
    };
    const host = (trust_proxy && first_header('x-forwarded-host')) || request.headers.host;
    const protocol = trust_proxy && first_header('x-forwarded-proto') === 'https' ? 'https' : 'http';
    // Only an authority is accepted, never credentials, a path or injected HTML.
    if (!host || /[\s/\\?#@]/.test(host)) return html;
    let origin: string;
    try {
        origin = new URL(`${protocol}://${host}`).origin.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    } catch {
        return html;
    }
    return html.replace(
        /(<meta\s+(?:property="og:(?:image|url)"|name="twitter:image")\s+content=")(\/[^\"]*)(")/g,
        (_, before, resource, after) => `${before}${origin}${resource}${after}`
    );
}
