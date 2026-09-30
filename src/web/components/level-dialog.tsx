/**
 * The host's level picker: one scrolling grid of every level, filtered by a search box. The thumbnails are
 * separate images, so each one loads only when its card comes near the visible part of the grid.
 */
import type { RefObject } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Level, RECOMMENDED_LEVELS } from '../constants';
import levels from '../levels.json';
import { level_thumbnail } from '../pixel/assets';
import { Dialog, PixelCanvas, Text, TextInput, gp } from '../pixel/components';

/** The recommended levels first, in their own order, then all the others in alphabetical order. */
export const ORDERED_LEVELS: Level[] = [
    ...RECOMMENDED_LEVELS.flatMap((dat) => levels.filter((l) => l.datFile === dat)),
    ...levels
        .filter((l) => !RECOMMENDED_LEVELS.includes(l.datFile))
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })),
];

/** Height of the grid in game pixels: three rows of cards plus the padding for the focus outline. */
const GRID_HEIGHT = 212;

/** Calls `onNear` once `element` comes near the visible part of the scrolling box; returns a cancel function. */
type WatchNear = (element: Element, onNear: () => void) => () => void;

/** Set by a scrolling box whose thumbnails load lazily; without it thumbnails load right away. */
const NearContext = createContext<WatchNear | null>(null);

/** One IntersectionObserver for all cards of a scrolling box, looking one box height above and below it. */
function useWatchNear(root: RefObject<HTMLElement>): WatchNear {
    const watcher = useMemo(() => {
        const waiting = new Map<Element, () => void>();
        let observer: IntersectionObserver | null = null;
        const watch: WatchNear = (element, onNear) => {
            if (typeof IntersectionObserver === 'undefined') {
                onNear();
                return () => {};
            }
            if (!observer) {
                observer = new IntersectionObserver(
                    (entries) => {
                        for (const entry of entries) {
                            if (!entry.isIntersecting) continue;
                            const callback = waiting.get(entry.target);
                            waiting.delete(entry.target);
                            observer.unobserve(entry.target);
                            callback?.();
                        }
                    },
                    { root: root.current, rootMargin: '100% 0px' }
                );
            }
            waiting.set(element, onNear);
            observer.observe(element);
            return () => {
                waiting.delete(element);
                observer?.unobserve(element);
            };
        };
        const stop = () => {
            observer?.disconnect();
            observer = null;
            waiting.clear();
        };
        return { watch, stop };
    }, []);
    useEffect(() => watcher.stop, []);
    return watcher.watch;
}

/** A level preview in an inset frame; inside the level grid it loads only when scrolled near. */
export function Thumbnail({
    level,
    width,
    height,
    selected = false,
}: {
    level: Level;
    width: number;
    height: number;
    selected?: boolean;
}) {
    const watch_near = useContext(NearContext);
    const ref = useRef<HTMLSpanElement>(null);
    const [near, setNear] = useState(!watch_near);
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

    useEffect(() => {
        if (near || !watch_near || !ref.current) return;
        return watch_near(ref.current, () => setNear(true));
    }, [near, watch_near]);

    useEffect(() => {
        if (!near) return;
        let active = true;
        setCanvas(null);
        level_thumbnail(`/levels/${level.imageUrl}`, width, height).then(
            (c) => active && setCanvas(c),
            () => {}
        );
        return () => {
            active = false;
        };
    }, [near, level.imageUrl, width, height]);

    return (
        <span
            ref={ref}
            className={`gp-thumb inline-flex ${selected ? 'gp-thumb-selected' : ''}`}
            style={{ width: gp(width + 4), height: gp(height + 4) }}
        >
            <PixelCanvas source={canvas} />
        </span>
    );
}

function LevelCard({ level, selected, onClick }: { level: Level; selected: boolean; onClick: () => void }) {
    const [hot, setHot] = useState(false);
    return (
        <button
            type="button"
            className="gp-level-card"
            aria-current={selected ? 'true' : undefined}
            onClick={onClick}
            onMouseEnter={() => setHot(true)}
            onMouseLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
        >
            <Thumbnail level={level} width={72} height={46} selected={selected} />
            <Text text={level.name} color={hot || selected ? 'gold' : 'white'} maxWidth={76} />
        </button>
    );
}

export function LevelDialog({
    selected,
    onSelect,
    onClose,
}: {
    selected: string;
    onSelect: (level: Level) => void;
    onClose: () => void;
}) {
    const [search, setSearch] = useState('');
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query ? ORDERED_LEVELS.filter((l) => l.name.toLowerCase().includes(query)) : ORDERED_LEVELS;
    }, [search]);
    const grid = useRef<HTMLDivElement>(null);
    const watch_near = useWatchNear(grid);

    // Open with the current level in the middle of the grid
    useLayoutEffect(() => {
        const box = grid.current;
        const card = box?.querySelector<HTMLElement>('[aria-current="true"]');
        if (box && card) box.scrollTop = card.offsetTop - (box.clientHeight - card.offsetHeight) / 2;
    }, []);

    return (
        <Dialog title="CHOOSE A LEVEL" onClose={onClose} width={360}>
            <div className="gp-col">
                <div className="gp-row justify-between">
                    <TextInput
                        value={search}
                        onInput={(value) => {
                            setSearch(value);
                            if (grid.current) grid.current.scrollTop = 0;
                        }}
                        label="Search levels"
                        placeholder="Search..."
                        width={180}
                        autoFocus
                    />
                    <Text text={`${filtered.length} ${filtered.length === 1 ? 'level' : 'levels'}`} color="dim" />
                </div>
                <NearContext.Provider value={watch_near}>
                    <div ref={grid} className="gp-level-grid gp-scroll" style={{ height: gp(GRID_HEIGHT) }}>
                        {filtered.map((level) => (
                            <LevelCard
                                key={level.datFile}
                                level={level}
                                selected={level.datFile === selected}
                                onClick={() => {
                                    onSelect(level);
                                    onClose();
                                }}
                            />
                        ))}
                        {filtered.length === 0 && (
                            <div style={{ gridColumn: '1 / -1' }}>
                                <Text text="No level with that name." color="dim" />
                            </div>
                        )}
                    </div>
                </NearContext.Provider>
            </div>
        </Dialog>
    );
}
