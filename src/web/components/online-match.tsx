import { useEffect, useRef, useState } from 'preact/hooks';
import { net } from '../../net/client';
import { BUNNY_NAMES, MatchInfo } from '../../net/protocol';
import type { GameInputDevice } from '../../inputs';
import type { OnlineGame, OnlineGamePhase } from '../../online/online-game';

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
    settings,
}: {
    match: MatchInfo;
    myId: string;
    isHost: boolean;
    settings: MatchSettings;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<OnlineGame | null>(null);
    const hostRef = useRef(isHost);
    const escArmedUntil = useRef(0);
    const [phase, setPhase] = useState<OnlineGamePhase>('loading');
    const [notice, setNotice] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [ping, setPing] = useState<number | null>(null);
    const [stalled, setStalled] = useState(false);

    hostRef.current = isHost;
    const slot = match.slots.findIndex((s) => s?.id === myId);

    const quit = () => {
        net.send({ t: 'quit' });
        if (!hostRef.current) net.leave_match();
    };

    const onEscape = () => {
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
                game.init();
                gameRef.current = game;
                net.set_match_handler((message) => game!.handle_message(message));
                net.send({ t: 'ready', match: match.id });
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

    const players = match.slots
        .map((s, i) => (s ? { bunny: BUNNY_NAMES[i], name: s.name, me: s.id === myId } : null))
        .filter(Boolean);

    return (
        <div className="h-screen w-screen bg-black relative overflow-hidden select-none">
            <div className="absolute top-0 left-0 right-0 z-10 flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 py-0.5 text-xs text-white/80 bg-black/50 pointer-events-none">
                {players.map((p) => (
                    <span key={p!.bunny} className={p!.me ? 'text-white font-bold' : ''}>
                        {p!.bunny}: {p!.name}
                        {p!.me ? ' (you)' : ''}
                    </span>
                ))}
                {ping !== null && phase === 'playing' && <span className="text-white/50">ping {ping} ms</span>}
                {phase === 'playing' && (
                    <span className="text-white/50">
                        ESC: {isHost ? 'end match' : 'leave match'} · SHIFT+F: fullscreen
                    </span>
                )}
            </div>

            {stalled && phase === 'playing' && !notice && (
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 bg-black/80 text-white text-sm font-bold px-3 py-1 border-1 border-white/40">
                    Connection problem: waiting for the server...
                </div>
            )}

            {notice && (
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 bg-black/80 text-white text-sm font-bold px-3 py-1 border-1 border-white/40">
                    {notice}
                </div>
            )}

            {(phase === 'loading' || phase === 'waiting' || failed) && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-white">
                    <div className="text-2xl font-bold">
                        {failed ?? (phase === 'loading' ? 'Loading level...' : 'Waiting for the other bunnies...')}
                    </div>
                    <button
                        className="bg-brainchild-primary hover:bg-brainchild-primary-hover border-1 border-black text-black text-sm font-bold px-3 py-1 cursor-pointer"
                        onClick={quit}
                    >
                        {isHost && !failed ? 'Cancel match' : 'Back to the room'}
                    </button>
                </div>
            )}

            {phase === 'scores' && (
                <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center">
                    <button
                        className="bg-brainchild-primary hover:bg-brainchild-primary-hover border-1 border-black text-black text-sm font-bold px-3 py-1 cursor-pointer"
                        onClick={() => gameRef.current?.dismiss_scores()}
                    >
                        Continue
                    </button>
                </div>
            )}

            <canvas
                className={`game-canvas ${phase === 'loading' || phase === 'waiting' ? 'game-canvas-loading' : ''}`}
                ref={canvasRef}
            ></canvas>
        </div>
    );
}
