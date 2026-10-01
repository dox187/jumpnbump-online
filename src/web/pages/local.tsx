import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Engine } from '../../engine';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';
import { BUNNY_NAMES, DEFAULT_LEVEL } from '../../net/protocol';
import { BOT_MODE_NAMES, get_local_controls, subscribe_local_controls } from '../../local-controls';
import { LevelDialog } from '../components/level-dialog';
import { usePageMeta } from '../hooks/page-meta';
import { useOnlineSettings } from '../hooks/online-settings';
import { load_game_assets } from '../pixel/assets';
import { Button, FullscreenHelp, Panel, Text, gp, pixel_variables } from '../pixel/components';
import { Shell } from '../pixel/console';
import { useKeyboardNav } from '../pixel/keyboard-nav';
import '../pixel/pixel.css';

// A stopped engine must finish before a quick return to /local resets its shared game state.
let previousRun: Promise<unknown> = Promise.resolve();

/** Choose a level, then enter the original game's menu for up to four local players. */
export default function Local() {
    usePageMeta({
        title: "Jump 'n Bump - Local game",
        description: "Play Jump 'n Bump with up to four players on one keyboard.",
        robots: 'noindex',
    });
    const { route } = useLocation();
    const [settings, , loaded] = useOnlineSettings();
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    const [stage, setStage] = useState<HTMLDivElement | null>(null);
    const [level, setLevel] = useState<string | null>(null);
    const [selected, setSelected] = useState(DEFAULT_LEVEL);
    const [running, setRunning] = useState(false);
    const [failed, setFailed] = useState(false);
    const [fontReady, setFontReady] = useState(false);
    const [controls, setControls] = useState(get_local_controls);
    const [notice, setNotice] = useState<typeof controls.change>(null);
    useEffect(() => subscribe_local_controls(() => setControls(get_local_controls())), []);
    useEffect(() => {
        setNotice(controls.change);
        if (!controls.change) return;
        const timer = window.setTimeout(() => setNotice(null), 2000);
        return () => clearTimeout(timer);
    }, [controls.change]);
    const botControls = running && !failed && (controls.phase === 'lobby' || controls.phase === 'playing');
    useKeyboardNav(!running || failed ? stage : null);

    const chooseAgain = () => {
        setLevel(null);
        setRunning(false);
        setFailed(false);
    };

    useEffect(() => {
        let active = true;
        // The picker graphics share the game's global datafile, so load them before any selected level.
        load_game_assets().then(
            () => active && setFontReady(true),
            () => active && setFailed(true)
        );
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!loaded || !fontReady || !canvas || !level) return;
        let left = false;
        let engine: Engine | null = null;
        const download = new AbortController();

        Promise.all([
            fetch(`/levels/${encodeURIComponent(level)}`, { signal: download.signal }).then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.arrayBuffer();
            }),
            previousRun,
        ])
            .then(([dat]) => {
                if (left) return;
                engine = new Engine(canvas);
                const settings = settingsRef.current;
                engine.init({
                    dat,
                    nosound: settings.muteMusic && settings.muteEffects,
                    musicnosound: settings.muteEffects,
                    nomusic: settings.muteMusic,
                    nogore: settings.noGore,
                    noflies: settings.noFlies,
                });
                engine.onExit(() => {
                    if (!left) chooseAgain();
                });
                previousRun = engine.run().catch((error) => {
                    console.error('could not run the local game', error);
                    if (!left) setFailed(true);
                });
                setRunning(true);
            })
            .catch((error) => {
                if (left) return;
                console.error('could not start the local game', error);
                setFailed(true);
            });

        return () => {
            left = true;
            download.abort();
            engine?.stop();
        };
    }, [loaded, fontReady, canvas, level]);

    useEffect(() => {
        if (!level || running || failed) return;
        const cancel = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                chooseAgain();
            }
        };
        window.addEventListener('keydown', cancel);
        return () => window.removeEventListener('keydown', cancel);
    }, [level, running, failed]);

    return (
        <Shell
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            style={pixel_variables}
            stageRef={setStage}
            fullscreenHelp={FullscreenHelp}
            botModes={botControls ? controls.modes : undefined}
        >
            <canvas
                ref={setCanvas}
                className="gp-abs"
                style={{
                    left: 0,
                    top: 0,
                    width: gp(SCREEN_WIDTH),
                    height: gp(SCREEN_HEIGHT),
                    visibility: running ? 'visible' : 'hidden',
                }}
            />
            {botControls && notice && (
                <div
                    className="gp-abs"
                    role="status"
                    aria-live="polite"
                    style={{
                        top: gp(4),
                        left: 0,
                        width: gp(SCREEN_WIDTH),
                        display: 'flex',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    <div style={{ background: 'rgba(0,0,0,0.85)', padding: `${gp(1)} ${gp(4)}` }}>
                        <Text
                            text={`${BUNNY_NAMES[notice.slot].toUpperCase()}: ${BOT_MODE_NAMES[notice.mode]}`}
                            color={(['white', 'green', 'gold', 'red'] as const)[notice.mode]}
                        />
                    </div>
                </div>
            )}
            {fontReady && !level && !failed && (
                <LevelDialog
                    selected={selected}
                    onSelect={(next) => {
                        setSelected(next.datFile);
                        setLevel(next.datFile);
                    }}
                    onClose={() => route('/')}
                />
            )}
            {fontReady && level && !running && !failed && (
                <div
                    className="gp-abs gp-col"
                    role="status"
                    style={{ inset: 0, alignItems: 'center', justifyContent: 'center' }}
                >
                    <Text text="LOADING LEVEL..." color="gold" />
                    <Button label="CANCEL" onClick={chooseAgain} />
                </div>
            )}
            {failed && (
                <div
                    className="gp-abs"
                    style={{ inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    {fontReady ? (
                        <Panel className="gp-col" style={{ alignItems: 'center' }}>
                            <Text text="THE GAME COULD NOT BE LOADED" color="red" />
                            <Button label="BACK" onClick={chooseAgain} />
                        </Panel>
                    ) : (
                        <p>
                            The game could not be loaded. <a href="/">Back</a>
                        </p>
                    )}
                </div>
            )}
        </Shell>
    );
}
