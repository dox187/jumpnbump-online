/**
 * Pixel-art UI kit for the online lobby. The stage uses the game's native dimensions and square pixels,
 * with integer device-pixel scaling on desktops and an edge-to-edge fit on mobile devices.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LINE_HEIGHT, TextColor, fit_text, render_text, text_width, wrap_text } from './font';
import { useDialogFocus, useKeyboardNav } from './keyboard-nav';
import { Shell } from './console';
import { FullscreenHelpProps, is_ios } from '../../fullscreen';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';

/** Changing screens never changes the size or aspect ratio of the display. */
export const STAGE_WIDTH = SCREEN_WIDTH;
export const STAGE_HEIGHT = SCREEN_HEIGHT;

/** Game pixels as a CSS length. */
export const gp = (n: number) => `calc(var(--px) * ${n})`;

type FrameColors = {
    rings: [light: string, dark: string][];
    cut: boolean;
    /** Colours of a 2x2 rivet drawn into every corner: top-left, top-right/bottom-left, bottom-right. */
    rivet?: [string, string, string];
};

/** Builds a 9-slice pixel frame as an SVG: ring 0 is the outside, light rings face top and left. */
function frame_svg({ rings, cut, rivet }: FrameColors) {
    const depth = rings.length;
    const size = depth * 2 + 2;
    let rects = '';
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cx = x < depth ? x : size - 1 - x;
            const cy = y < depth ? y : size - 1 - y;
            if (
                rivet &&
                (x < depth || x >= size - depth) &&
                (y < depth || y >= size - depth) &&
                cx >= 2 &&
                cx <= 3 &&
                cy >= 2 &&
                cy <= 3
            ) {
                const color = cx === 2 && cy === 2 ? rivet[0] : cx === 3 && cy === 3 ? rivet[2] : rivet[1];
                rects += `<rect x='${x}' y='${y}' width='1' height='1' fill='${color}'/>`;
                continue;
            }
            const dt = y,
                dl = x,
                db = size - 1 - y,
                dr = size - 1 - x;
            const ring = Math.min(dt, dl, db, dr);
            if (ring >= depth) continue;
            if (cut && ring === 0 && (dt === 0 || db === 0) && (dl === 0 || dr === 0)) continue;
            // Top and left edges are lit; the top-right corner counts as top, the bottom-left as bottom
            const light = dt === ring || (dl === ring && db !== ring);
            const color = rings[ring][light ? 0 : 1];
            rects += `<rect x='${x}' y='${y}' width='1' height='1' fill='${color}'/>`;
        }
    }
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' shape-rendering='crispEdges'>${rects}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const OUTLINE = '#120802';
const FRAMES: Record<string, FrameColors> = {
    panel: {
        cut: true,
        rings: [
            [OUTLINE, OUTLINE],
            ['#f2c47e', '#5a3210'],
            ['#c48648', '#8e5a2c'],
            ['#a06634', '#74461f'],
            ['#1c0e04', '#1c0e04'],
        ],
        rivet: ['#fff2b8', '#d8a040', '#5a3810'],
    },
    button: {
        cut: true,
        rings: [
            [OUTLINE, OUTLINE],
            ['#e8b46a', '#5c3412'],
            ['#9a6632', '#7a4a22'],
        ],
    },
    'button-down': {
        cut: true,
        rings: [
            [OUTLINE, OUTLINE],
            ['#5c3412', '#e8b46a'],
            ['#7a4a22', '#9a6632'],
        ],
    },
    input: {
        cut: false,
        rings: [
            [OUTLINE, OUTLINE],
            ['#3a2210', '#b07a42'],
        ],
    },
    'input-focus': {
        cut: false,
        rings: [
            ['#ffd648', '#ffd648'],
            ['#3a2210', '#b07a42'],
        ],
    },
    tag: { cut: true, rings: [['#000000', '#000000']] },
};

let frame_vars: Record<string, string> | null = null;
function frame_variables() {
    if (!frame_vars) {
        frame_vars = {};
        for (const [name, colors] of Object.entries(FRAMES)) frame_vars[`--gp-frame-${name}`] = frame_svg(colors);
    }
    return frame_vars;
}

/** The CSS variables the pixel components need: --px and the frame images. */
export function pixel_variables(scale: number) {
    return { '--px': `${scale}px`, ...frame_variables() } as JSX.CSSProperties;
}

/**
 * The 400x256 stage on black, with touch controls outside it on mobile devices.
 * The arrow keys move the focus between its controls;
 * `navSkip` returns true for keydown events the navigation must leave alone.
 */
export function Stage({
    children,
    navSkip,
}: {
    children: ComponentChildren;
    navSkip?: (event: KeyboardEvent) => boolean;
}) {
    const [stage, setStage] = useState<HTMLDivElement | null>(null);
    useKeyboardNav(stage, navSkip);
    return (
        <Shell
            width={STAGE_WIDTH}
            height={STAGE_HEIGHT}
            style={pixel_variables}
            stageRef={setStage}
            fullscreenHelp={FullscreenHelp}
        >
            {children}
        </Shell>
    );
}

const text_cache = new Map<string, HTMLCanvasElement>();
function cached_text(text: string, color: TextColor, shadow: boolean) {
    const key = `${color}|${shadow ? 1 : 0}|${text}`;
    let canvas = text_cache.get(key);
    if (!canvas) {
        canvas = render_text(text, color, shadow);
        if (text_cache.size > 2000) text_cache.clear();
        text_cache.set(key, canvas);
    }
    return canvas;
}

/** Text in the game font. The canvas is decorative; a visually hidden copy carries the text for assistive tech. */
export function Text({
    text,
    color = 'white',
    size = 1,
    shadow = false,
    maxWidth,
    className = '',
    hidden = false,
}: {
    text: string;
    color?: TextColor;
    size?: number;
    shadow?: boolean;
    /** Cut the text with '..' so it fits into this many game pixels. */
    maxWidth?: number;
    className?: string;
    /** The text is already announced elsewhere (e.g. by an aria-label). */
    hidden?: boolean;
}) {
    const shown = maxWidth ? fit_text(text, maxWidth) : text;
    const source = useMemo(() => cached_text(shown, color, shadow), [shown, color, shadow]);
    const ref = useRef<HTMLCanvasElement>(null);

    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d')!;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0);
    }, [source]);

    return (
        <span className={`gp-text ${className}`} title={shown !== text ? text : undefined}>
            <canvas
                ref={ref}
                aria-hidden="true"
                style={{ width: gp(source.width * size), height: gp(source.height * size) }}
            />
            {!hidden && <span className="sr-only">{text}</span>}
        </span>
    );
}

/** Several lines of game-font text, wrapped to `width` game pixels. */
export function Paragraph({
    text,
    width,
    color = 'white',
    shadow = false,
    center = false,
}: {
    text: string;
    width: number;
    color?: TextColor;
    shadow?: boolean;
    center?: boolean;
}) {
    const lines = wrap_text(text, width);
    return (
        <span
            className="gp-paragraph"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: center ? 'center' : 'flex-start',
                width: gp(width),
            }}
        >
            {lines.map((line, i) => (
                <Text key={i} text={line} color={color} shadow={shadow} hidden />
            ))}
            <span className="sr-only">{text}</span>
        </span>
    );
}

/** Draws any canvas (sprites, thumbnails) at game-pixel scale. */
export function PixelCanvas({ source, className = '' }: { source: HTMLCanvasElement | null; className?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas || !source) return;
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d')!.drawImage(source, 0, 0);
    }, [source]);
    if (!source) return null;
    return (
        <canvas
            ref={ref}
            aria-hidden="true"
            className={`gp-canvas ${className}`}
            style={{ width: gp(source.width), height: gp(source.height) }}
        />
    );
}

export function Panel({
    children,
    className = '',
    style,
}: {
    children: ComponentChildren;
    className?: string;
    style?: JSX.CSSProperties;
}) {
    return (
        <div className={`gp-panel ${className}`} style={style}>
            {children}
        </div>
    );
}

export function Button({
    label,
    href,
    onClick,
    disabled = false,
    primary = false,
    type = 'button',
    title,
    width,
    className = '',
}: {
    label: string;
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
    primary?: boolean;
    type?: 'button' | 'submit';
    title?: string;
    /** Minimum width in game pixels. */
    width?: number;
    className?: string;
}) {
    const [hot, setHot] = useState(false);
    const color: TextColor = disabled ? 'dim' : hot ? 'gold' : primary ? 'green' : 'white';
    const Tag = href ? 'a' : 'button';
    const external = href !== undefined && /^https?:\/\//.test(href);
    return (
        <Tag
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            type={href ? undefined : type}
            className={`gp-button${primary ? ' gp-button-primary' : ''} ${className}`}
            disabled={href ? undefined : disabled}
            title={title}
            style={width ? { minWidth: gp(width) } : undefined}
            onClick={onClick}
            onMouseEnter={() => setHot(true)}
            onMouseLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
        >
            <Text text={label} color={color} />
        </Tag>
    );
}

/** A text field drawn in the game font; a transparent native input underneath handles typing. */
export function TextInput({
    value,
    onInput,
    label,
    placeholder = '',
    maxLength,
    password = false,
    width = 120,
    autoFocus = false,
    autoComplete = 'off',
}: {
    value: string;
    onInput: (value: string) => void;
    label: string;
    placeholder?: string;
    maxLength?: number;
    password?: boolean;
    width?: number;
    autoFocus?: boolean;
    autoComplete?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(false);
    const [caret, setCaret] = useState(value.length);

    useEffect(() => {
        if (autoFocus) ref.current?.focus();
    }, []);

    const sync = () => setCaret(ref.current?.selectionStart ?? value.length);
    const shown = password ? '•'.repeat(value.length) : value;
    const inner = width - 6;
    const before = shown.slice(0, Math.min(caret, shown.length));
    const caret_x = before ? text_width(before) + 1 : 0;
    const offset = Math.max(0, caret_x - (inner - 2));

    return (
        <label className={`gp-input ${focused ? 'gp-input-focus' : ''}`} style={{ width: gp(width) }}>
            <span className="gp-input-view" style={{ transform: `translateX(${gp(-offset)})` }}>
                {value ? (
                    <Text text={shown} color="white" hidden />
                ) : (
                    placeholder && <Text text={placeholder} color="dim" hidden />
                )}
                {focused && <span className="gp-caret" style={{ left: gp(caret_x) }} />}
            </span>
            <input
                ref={ref}
                className="gp-input-native"
                type={password ? 'password' : 'text'}
                value={value}
                maxLength={maxLength}
                aria-label={label}
                placeholder={placeholder}
                autoComplete={autoComplete}
                spellcheck={false}
                onInput={(e) => {
                    onInput((e.target as HTMLInputElement).value);
                    setCaret((e.target as HTMLInputElement).selectionStart ?? 0);
                }}
                onKeyUp={sync}
                onClick={sync}
                onSelect={sync}
                onFocus={() => {
                    setFocused(true);
                    requestAnimationFrame(sync);
                }}
                onBlur={() => setFocused(false)}
            />
        </label>
    );
}

export function Checkbox({
    checked,
    onChange,
    label,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}) {
    const [hot, setHot] = useState(false);
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            className="gp-checkbox"
            onClick={() => onChange(!checked)}
            onMouseEnter={() => setHot(true)}
            onMouseLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
        >
            <span className="gp-checkbox-box">{checked && <Icon name="check" />}</span>
            <Text text={label} color={hot ? 'gold' : 'white'} />
        </button>
    );
}

/**
 * Clicking a cycler leaves the focus where it was: only the keyboard focuses it, so Left/Right change its value
 * only after the player moved to it with the keyboard.
 */
const keep_focus = (e: MouseEvent) => e.preventDefault();

/**
 * A "< value >" option switcher, like the settings in old games. For the keyboard it is one focus stop:
 * Left/Right change the value, Up/Down move on.
 */
export function Cycler<T>({
    label,
    value,
    options,
    format = String,
    onChange,
    disabled = false,
    width = 60,
}: {
    label: string;
    value: T;
    options: readonly T[];
    format?: (value: T) => string;
    onChange: (value: T) => void;
    disabled?: boolean;
    width?: number;
}) {
    const index = Math.max(0, options.indexOf(value));
    const step = (delta: number) => {
        if (disabled || options.length === 0) return;
        onChange(options[(index + delta + options.length) % options.length]);
    };
    return (
        <div
            className={`gp-cycler ${disabled ? 'gp-cycler-disabled' : ''}`}
            role="group"
            aria-label={label}
            tabIndex={disabled ? -1 : 0}
            onMouseDown={keep_focus}
            onKeyDown={(e) => {
                if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
                const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                if (!delta) return;
                e.preventDefault();
                step(delta);
            }}
        >
            <button
                type="button"
                className="gp-arrow"
                disabled={disabled}
                tabIndex={-1}
                aria-label={`Previous ${label}`}
                onClick={() => step(-1)}
            >
                <Icon name="left" />
            </button>
            <span className="gp-cycler-value" style={{ width: gp(width) }} aria-live="polite">
                <Text text={format(options[index])} color={disabled ? 'dim' : 'gold'} maxWidth={width} />
            </span>
            <button
                type="button"
                className="gp-arrow"
                disabled={disabled}
                tabIndex={-1}
                aria-label={`Next ${label}`}
                onClick={() => step(1)}
            >
                <Icon name="right" />
            </button>
        </div>
    );
}

/** A modal window that pops up over the stage. */
export function Dialog({
    title,
    onClose,
    children,
    width = 220,
}: {
    title: string;
    onClose?: () => void;
    children: ComponentChildren;
    width?: number;
}) {
    const panel = useRef<HTMLDivElement>(null);
    useDialogFocus(panel);

    useEffect(() => {
        if (!onClose) return;
        const handler = (e: KeyboardEvent) => {
            if (panel.current?.closest('[inert]')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="gp-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
            <div
                ref={panel}
                className="gp-panel gp-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                style={{ width: gp(width) }}
            >
                <div className="gp-dialog-title">
                    <Text text={title} color="gold" hidden />
                    {onClose && (
                        <button type="button" className="gp-close" aria-label="Close" onClick={onClose}>
                            <Icon name="close" />
                        </button>
                    )}
                </div>
                <div className="gp-dialog-content gp-scroll">{children}</div>
            </div>
        </div>
    );
}

/** A browser without fullscreen still has a useful FULL button. */
export function FullscreenHelp({ issue, onClose }: FullscreenHelpProps) {
    useEffect(() => {
        // Dismiss this guide without also closing the lobby dialog or leaving a running match.
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener('keydown', escape, true);
        return () => window.removeEventListener('keydown', escape, true);
    }, [onClose]);

    const ios = is_ios();
    const lines =
        issue === 'app'
            ? ['Already running without browser bars.', 'System bars are controlled by your device.']
            : ios
              ? [
                    'For a view without browser bars:',
                    '1. Open this site in Safari.',
                    '2. Share > Add to Home Screen.',
                    '3. Enable Open as Web App if shown.',
                    '4. Launch the new Home Screen icon.',
                ]
              : [
                    issue === 'denied' ? 'The browser blocked fullscreen.' : 'Fullscreen is unavailable here.',
                    'Open this site in your regular browser, or launch it from your Home Screen.',
                ];
    return (
        <Dialog title={issue === 'app' ? 'HOME SCREEN MODE' : 'FULL SCREEN'} width={350} onClose={onClose}>
            <div className="gp-col" style={{ gap: gp(5) }}>
                {lines.map((text) => (
                    <Paragraph key={text} text={text} width={330} />
                ))}
                <Button label="GOT IT" onClick={onClose} />
            </div>
        </Dialog>
    );
}

/** Small pixel icons; each character is a colour key, '.' is transparent. */
const ICONS: Record<string, { rows: string[]; colors: Record<string, string> }> = {
    search: {
        rows: ['.WWW.....', 'W...W....', 'W...W....', 'W...W....', '.WWW.W...', '.....WW..', '......WW.', '.......WW'],
        colors: { W: '#f4e6c8' },
    },
    lock: {
        rows: ['..ooo..', '.oSSSo.', '.oS.So.', 'ooooooo', 'oGGGGGo', 'oGGoGGo', 'oGGoGGo', 'ooooooo'],
        colors: { o: '#1a1000', S: '#c8c8c8', G: '#ffd648' },
    },
    crown: {
        rows: ['o....o....o', 'oGo.oGo.oGo', 'oGGoGGGoGGo', 'oGRGGGGGRGo', 'oGGGGGGGGGo', 'ooooooooooo'],
        colors: { o: '#1a1000', G: '#ffd648', R: '#e23c28' },
    },
    down: {
        rows: ['ooooooo', 'oGGGGGo', '.oGGGo.', '..oGo..', '...o...'],
        colors: { o: '#1a1000', G: '#ffd648' },
    },
    left: {
        rows: ['...o', '..oW', '.oWW', 'oWWW', '.oWW', '..oW', '...o'],
        colors: { o: '#1a1000', W: '#f4e6c8' },
    },
    right: {
        rows: ['o...', 'Wo..', 'WWo.', 'WWWo', 'WWo.', 'Wo..', 'o...'],
        colors: { o: '#1a1000', W: '#f4e6c8' },
    },
    check: {
        rows: ['......G', '.....GG', 'G...GG.', 'GG.GG..', '.GGG...', '..G....'],
        colors: { G: '#b6ff4a' },
    },
    close: {
        rows: ['W...W', '.W.W.', '..W..', '.W.W.', 'W...W'],
        colors: { W: '#f4e6c8' },
    },
};

const icon_cache = new Map<string, HTMLCanvasElement>();
/** An icon at native resolution (one canvas pixel per game pixel), e.g. to draw it onto another canvas. */
export function icon_canvas(name: string) {
    let canvas = icon_cache.get(name);
    if (!canvas) {
        const { rows, colors } = ICONS[name];
        canvas = document.createElement('canvas');
        canvas.width = Math.max(...rows.map((r) => r.length));
        canvas.height = rows.length;
        const context = canvas.getContext('2d')!;
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
                const color = colors[row[x]];
                if (!color) continue;
                context.fillStyle = color;
                context.fillRect(x, y, 1, 1);
            }
        });
        icon_cache.set(name, canvas);
    }
    return canvas;
}

export function Icon({ name, className = '' }: { name: keyof typeof ICONS | string; className?: string }) {
    const source = useMemo(() => (typeof document === 'undefined' ? null : icon_canvas(name)), [name]);
    return <PixelCanvas source={source} className={`gp-icon ${className}`} />;
}

export { LINE_HEIGHT };
