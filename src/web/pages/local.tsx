import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Engine } from '../../engine';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';
import { usePageMeta } from '../hooks/page-meta';
import { useOnlineSettings } from '../hooks/online-settings';
import { load_game_assets } from '../pixel/assets';
import { Button, FullscreenHelp, Panel, Text, gp, pixel_variables } from '../pixel/components';
import { Shell } from '../pixel/console';
import '../pixel/pixel.css';

const LEVEL_URL = '/levels/jumpbump.dat';

/** The original game for up to four players on one keyboard; it starts right away in the game's own menu. */
export default function Local() {
    usePageMeta({
        title: "Jump 'n Bump - Local game",
        description: "Play Jump 'n Bump with up to four players on one keyboard.",
        robots: 'noindex',
    });
    const { route } = useLocation();
    const [settings, , loaded] = useOnlineSettings();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [running, setRunning] = useState(false);
    const [failed, setFailed] = useState(false);
    const [fontReady, setFontReady] = useState(false);

    useEffect(() => {
        if (!loaded) return;
        let left = false;
        let engine: Engine | null = null;

        // The lobby graphics share the global datafile with the game, so they are loaded before it starts
        const assets = load_game_assets().then(
            () => setFontReady(true),
            () => {}
        );
        Promise.all([
            fetch(LEVEL_URL).then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.arrayBuffer();
            }),
            assets,
        ])
            .then(([dat]) => {
                if (left || !canvasRef.current) return;
                engine = new Engine(canvasRef.current);
                engine.init({
                    dat,
                    nosound: settings.muteMusic && settings.muteEffects,
                    musicnosound: settings.muteEffects,
                    nomusic: settings.muteMusic,
                    nogore: settings.noGore,
                    noflies: settings.noFlies,
                });
                engine.onExit(() => {
                    if (!left) route('/');
                });
                engine.run();
                setRunning(true);
            })
            .catch((error) => {
                console.error('could not start the local game', error);
                if (!left) setFailed(true);
            });

        return () => {
            left = true;
            engine?.stop();
        };
    }, [loaded]);

    return (
        <Shell width={SCREEN_WIDTH} height={SCREEN_HEIGHT} style={pixel_variables} fullscreenHelp={FullscreenHelp}>
            <canvas
                ref={canvasRef}
                className="gp-abs"
                style={{
                    left: 0,
                    top: 0,
                    width: gp(SCREEN_WIDTH),
                    height: gp(SCREEN_HEIGHT),
                    visibility: running ? 'visible' : 'hidden',
                }}
            />
            {failed && (
                <div
                    className="gp-abs"
                    style={{ inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    {fontReady ? (
                        <Panel className="gp-col" style={{ alignItems: 'center' }}>
                            <Text text="THE GAME COULD NOT BE LOADED" color="red" />
                            <Button label="BACK" onClick={() => route('/')} />
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
