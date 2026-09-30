import { useEffect, useRef, useState } from 'preact/hooks';
import { net } from '../../net/client';
import { BUNNY_NAMES, MatchInfo } from '../../net/protocol';
import type { GameInputDevice } from '../../inputs';
import type { Countdown, OnlineGame, OnlineGamePhase } from '../../online/online-game';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../constants';
import { Button, FullscreenHelp, Panel, Text, gp, pixel_variables } from '../pixel/components';
import { Shell } from '../pixel/console';
import '../pixel/pixel.css';

export type MatchSettings = {
    control: GameInputDevice;
    muteMusic: boolean;
    muteEffects: boolean;
    noGore: boolean;
    noFlies: boolean;
};

const ESC_CONFIRM_MS = 3000;

export default function OnlineMatch({
    match,
    myId,
    isHost,
    spectating,
    settings,
}: {
    match: MatchInfo;
    myId: string;
    isHost: boolean;
    /** Only watching: no bunny, ESC goes straight back to the room. */
    spectating: boolean;
    settings: MatchSettings;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<OnlineGame | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const hostRef = useRef(isHost);
    const escArmedUntil = useRef(0);
    const [phase, setPhase] = useState<OnlineGamePhase>('loading');
    const [notice, setNotice] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [ping, setPing] = useState<number | null>(null);
    const [stalled, setStalled] = useState(false);
    const [countdown, setCountdown] = useState<Countdown>(null);

    hostRef.current = isHost;
    const slot = spectating ? -1 : match.slots.findIndex((s) => s?.id === myId);

    const quit = () => {
        if (spectating) {
            net.send({ t: 'unwatch' });
            net.leave_match();
            return;
        }
        net.send({ t: 'quit' });
        if (!hostRef.current) net.leave_match();
    };

    const onEscape = () => {
        if (spectating) {
            quit();
            return;
        }
        const now = performance.now();
        if (now < escArmedUntil.current) {
            escArmedUntil.current = 0;
            setNotice(null);
            quit();
            return;
        }
        escArmedUntil.current = now + ESC_CONFIRM_MS;
        setNotice(
            hostRef.current ? 'Press ESC again to end the match for everyone' : 'Press ESC again to leave the match'
        );
        setTimeout(() => {
            if (performance.now() >= escArmedUntil.current) setNotice(null);
        }, ESC_CONFIRM_MS);
    };

    useEffect(() => {
        let cancelled = false;
        let game: OnlineGame | null = null;

        Promise.all([
            import('../../online/online-game'),
            fetch(`/levels/${encodeURIComponent(match.level)}`).then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.arrayBuffer();
            }),
        ])
            .then(([module, dat]) => {
                if (cancelled || !canvasRef.current) return;
                const settings = settingsRef.current;
                game = new module.OnlineGame({
                    canvas: canvasRef.current,
                    dat,
                    match,
                    slot,
                    control: settings.control,
                    mute_music: settings.muteMusic,
                    mute_effects: settings.muteEffects,
                    nogore: settings.noGore,
                    noflies: settings.noFlies,
                    send: (message) => net.send(message),
                    rtt_ms: () => net.state.rtt,
                    on_escape: onEscape,
                    on_exit: () => net.leave_match(),
                });
                game.on_phase = setPhase;
                game.on_countdown = setCountdown;
                game.init();
                gameRef.current = game;
                net.set_match_handler((message) => game!.handle_message(message));
                if (!spectating) net.send({ t: 'ready', match: match.id });
            })
            .catch((error) => {
                console.error('could not start the match', error);
                if (!cancelled) setFailed('The level could not be loaded.');
            });

        const statsTimer = setInterval(() => {
            setPing(Math.round(net.state.rtt));
            setStalled(gameRef.current?.stats()?.stalled ?? false);
        }, 500);

        return () => {
            cancelled = true;
            clearInterval(statsTimer);
            net.set_match_handler(null);
            game?.destroy();
            gameRef.current = null;
        };
    }, [match.id]);

    // Show who is who during the countdown, and while TAB is held
    const [tabHeld, setTabHeld] = useState(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => e.key === 'Tab' && setTabHeld(true);
        const up = (e: KeyboardEvent) => e.key === 'Tab' && setTabHeld(false);
        const blur = () => setTabHeld(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', blur);
        };
    }, []);

    const waiting = phase === 'loading' || phase === 'waiting' || failed !== null;
    const showLegend = phase === 'playing' && ((countdown !== null && countdown > 0) || tabHeld);
    const myBunny = slot >= 0 ? BUNNY_NAMES[slot] : null;
    const escHint = spectating ? 'back' : isHost ? 'end match' : 'leave';

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
                    visibility: waiting ? 'hidden' : 'visible',
                }}
            />

            {showLegend && (
                <div
                    className="gp-abs"
                    style={{ left: 0, right: gp(48), top: gp(8), display: 'flex', justifyContent: 'center' }}
                >
                    <Panel className="gp-col" style={{ alignItems: 'center', gap: 0 }}>
                        {myBunny && <Text text={`You are ${myBunny.toUpperCase()}`} color="gold" />}
                        {spectating && <Text text="You are watching" color="gold" />}
                        <div className="gp-row" style={{ gap: gp(8) }}>
                            {match.slots.map((s, i) =>
                                s ? (
                                    <Text
                                        key={i}
                                        text={`${BUNNY_NAMES[i]}: ${s.name}`}
                                        color={s.id === myId ? 'gold' : 'white'}
                                        maxWidth={90}
                                    />
                                ) : null
                            )}
                        </div>
                        <Text
                            text={`ESC${spectating ? '' : ' twice'}: ${escHint} - TAB: players - ping ${ping ?? '-'} ms`}
                            color="dim"
                            maxWidth={300}
                        />
                    </Panel>
                </div>
            )}

            {phase === 'playing' && countdown !== null && (
                <div
                    className="gp-abs pointer-events-none"
                    style={{ left: 0, right: gp(48), top: gp(96), display: 'flex', justifyContent: 'center' }}
                >
                    <Text
                        key={countdown}
                        text={countdown > 0 ? String(countdown) : 'GO!'}
                        color={countdown > 0 ? 'gold' : 'green'}
                        size={4}
                        shadow
                        className="gp-pop"
                    />
                </div>
            )}

            {phase === 'replay' && (
                <>
                    <div className="gp-abs gp-blink pointer-events-none" style={{ left: gp(6), top: gp(4) }}>
                        <Text text="REPLAY" color="red" size={2} shadow />
                    </div>
                    <div className="gp-abs" style={{ right: gp(54), bottom: gp(4) }}>
                        <Button label="SKIP" onClick={() => gameRef.current?.skip_replay()} />
                    </div>
                </>
            )}

            {(notice || (stalled && phase === 'playing')) && (
                <div
                    className="gp-abs"
                    style={{ left: 0, right: gp(48), top: gp(110), display: 'flex', justifyContent: 'center' }}
                >
                    <Panel>
                        <Text
                            text={notice ?? 'Connection problem: waiting for the server...'}
                            color={notice ? 'gold' : 'red'}
                        />
                    </Panel>
                </div>
            )}

            {waiting && (
                <div
                    className="gp-abs"
                    style={{ inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <Panel className="gp-col" style={{ alignItems: 'center', width: gp(220) }}>
                        <Text
                            text={
                                failed ??
                                (phase === 'loading' ? 'LOADING LEVEL...' : 'WAITING FOR THE OTHER BUNNIES...')
                            }
                            color={failed ? 'red' : 'gold'}
                        />
                        {myBunny && !failed && <Text text={`You play ${myBunny}.`} color="white" />}
                        {spectating && !failed && <Text text="You are watching." color="white" />}
                        {!failed && <Text text="SHIFT+F: fullscreen" color="dim" />}
                        <Button
                            label={isHost && !spectating && !failed ? 'CANCEL MATCH' : 'BACK TO THE ROOM'}
                            onClick={quit}
                        />
                    </Panel>
                </div>
            )}

            {phase === 'scores' && (
                <div className="gp-abs" style={{ right: gp(6), bottom: gp(4) }}>
                    <Button label="CONTINUE" primary onClick={() => gameRef.current?.dismiss_scores()} />
                </div>
            )}
        </Shell>
    );
}
