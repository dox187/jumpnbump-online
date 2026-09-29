import { useEffect, useMemo, useState } from 'preact/hooks';
import { lazy } from 'preact-iso';
import { Card } from '../components/card';
import { Layout } from '../layout';
import { PageMeta, usePageMeta } from '../hooks/page-meta';
import { useNet } from '../hooks/net';
import { useGamepads } from '../hooks/gamepads';
import { OnlineSettings, useOnlineSettings } from '../hooks/online-settings';
import { BunnyPortrait } from '../components/bunny-portrait';
import { Level, LevelSelector } from '../components/level-selector';
import { ConfigureController } from '../components/configure-controller';
import { MAPPINGS, getFriendlyGamepadName, getGamepadId, getKnownGamepadDefaults } from '../components/controls';
import type { MatchSettings } from '../components/online-match';
import { net, NetState } from '../../net/client';
import {
    BUNNY_NAMES,
    END_SCORE_OPTIONS,
    MAX_ROOM_PLAYERS,
    MatchResult,
    NAME_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    ROOM_NAME_MAX_LENGTH,
    RoomDetail,
    RoomSummary,
} from '../../net/protocol';
import type { GameInputDevice } from '../../inputs';
import levels from '../levels.json';

const OnlineMatch = lazy(() => import('../components/online-match'));

const onlinePageMeta: PageMeta = {
    title: "Jump 'n Bump Online - Multiplayer Lobby",
    description: "Play Jump 'n Bump online with your friends: create a room, pick a level and start bumping.",
    keywords: ["Jump 'n Bump", 'online multiplayer', 'browser game', 'retro game', 'bunny game'],
    ogDescription: "Play Jump 'n Bump online with your friends.",
    ogUrl: '/',
    robots: 'noindex',
};

const buttonClass =
    'bg-brainchild-tertiary hover:bg-brainchild-tertiary-hover border-1 border-black p-1 text-md md:text-sm font-bold uppercase cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const smallButtonClass =
    'bg-brainchild-primary hover:bg-brainchild-primary-hover border-1 border-black px-2 py-0.5 text-sm md:text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const inputClass = 'border-inset border-2 px-1 bg-white text-md md:text-sm w-full';

function levelFor(datFile: string): Level {
    const level = levels.find((l) => l.datFile === datFile);
    return level ?? { name: datFile, datFile, imageUrl: 'jumpbump.jpg' };
}

function deviceFor(settings: OnlineSettings, gamepads: Gamepad[]): GameInputDevice {
    const mapping = MAPPINGS.find((m) => m.id === settings.control);
    if (mapping) return { type: mapping.type as 'keyboard' | 'mouse', mappings: mapping.mappings.map(String) };
    const gamepad = gamepads.find((g) => getGamepadId(g) === settings.control);
    if (!gamepad) return { type: 'keyboard', mappings: MAPPINGS[0].mappings.map(String) };
    return {
        type: 'gamepad',
        id: settings.control,
        mappings: settings.gamepadConfigs[settings.control] ??
            getKnownGamepadDefaults(settings.control) ?? ['button_14', 'button_15', 'button_0'],
    };
}

function roomFromUrl(): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('room');
}

const TOAST_MS = 6000;

function ErrorToast({ error }: { error: NetState['error'] }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const remaining = error ? error.at + TOAST_MS - Date.now() : 0;
        if (remaining <= 0) return;
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), remaining);
        return () => clearTimeout(timer);
    }, [error?.seq]);

    if (!error || !visible) return null;
    return (
        <div
            role="alert"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[2000] bg-brainchild-secondary text-white font-bold text-sm px-4 py-2 border-2 border-black shadow-lg cursor-pointer"
            onClick={() => setVisible(false)}
        >
            {error.message}
        </div>
    );
}

function NameForm({
    initial,
    onSubmit,
    submitLabel,
}: {
    initial: string;
    onSubmit: (name: string) => void;
    submitLabel: string;
}) {
    const [name, setName] = useState(initial);
    useEffect(() => setName(initial), [initial]);
    const trimmed = name.trim();

    return (
        <form
            className="flex flex-row gap-2 pt-2"
            onSubmit={(e) => {
                e.preventDefault();
                if (trimmed) onSubmit(trimmed);
            }}
        >
            <input
                className={inputClass}
                value={name}
                maxLength={NAME_MAX_LENGTH}
                placeholder="Your name"
                aria-label="Your name"
                onInput={(e: any) => setName(e.target.value)}
            />
            <button type="submit" className={smallButtonClass} disabled={!trimmed}>
                {submitLabel}
            </button>
        </form>
    );
}

function RoomRow({ room, autoOpen }: { room: RoomSummary; autoOpen: boolean }) {
    const [askPassword, setAskPassword] = useState(autoOpen && room.locked);
    const [password, setPassword] = useState('');
    const full = room.players >= MAX_ROOM_PLAYERS;

    const join = () => {
        if (room.locked && !askPassword) {
            setAskPassword(true);
            return;
        }
        net.send({ t: 'join', room: room.id, password });
    };

    return (
        <li className="border-b-1 border-brainchild-separator py-2 last:border-b-0">
            <div className="flex flex-row items-center gap-2">
                <div className="flex-grow min-w-0">
                    <div className="font-bold text-sm md:text-xs truncate">
                        {room.locked && <span title="Password protected">🔒 </span>}
                        {room.name}
                    </div>
                    <div className="text-xs text-gray-700 truncate">
                        {room.players}/{MAX_ROOM_PLAYERS} bunnies · {room.level}
                        {room.status !== 'lobby' && ' · match in progress'}
                    </div>
                </div>
                <button className={smallButtonClass} disabled={full} onClick={join}>
                    {full ? 'Full' : 'Join'}
                </button>
            </div>
            {askPassword && !full && (
                <form
                    className="flex flex-row gap-2 pt-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        join();
                    }}
                >
                    <input
                        className={inputClass}
                        type="password"
                        value={password}
                        maxLength={PASSWORD_MAX_LENGTH}
                        placeholder="Room password"
                        aria-label={`Password for ${room.name}`}
                        autoFocus
                        onInput={(e: any) => setPassword(e.target.value)}
                    />
                    <button type="submit" className={smallButtonClass}>
                        Join
                    </button>
                </form>
            )}
        </li>
    );
}

function Lobby({
    state,
    settings,
    updateSettings,
}: {
    state: NetState;
    settings: OnlineSettings;
    updateSettings: (p: Partial<OnlineSettings>) => void;
}) {
    const [roomName, setRoomName] = useState('');
    const [password, setPassword] = useState('');
    const invitedRoom = useMemo(roomFromUrl, []);

    return (
        <>
            <div className="flex flex-col w-full gap-2">
                <Card title="Play Online" className="w-full md:w-86 flex-shrink-0 pb-3">
                    <p className="text-sm md:text-xs pt-3">
                        Create a room or join one, pick a level and bump your friends online. Up to four bunnies per
                        room; everyone plays on their own keyboard or gamepad.
                    </p>
                    <p className="text-sm md:text-xs pt-2">
                        Rooms can be protected with a password. Inside a room you can copy an invite link for your
                        friends.
                    </p>
                </Card>
                <Card title="Rooms" className="w-full md:w-86">
                    {state.rooms.length === 0 ? (
                        <p className="text-sm md:text-xs pt-3">No rooms yet. Create the first one!</p>
                    ) : (
                        <ul className="list-none p-0 m-0 pt-1">
                            {state.rooms.map((room) => (
                                <RoomRow key={room.id} room={room} autoOpen={room.id === invitedRoom} />
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
            <div className="flex flex-col w-full gap-2 pt-2 md:pt-0">
                <Card title="You">
                    <NameForm
                        initial={state.me?.name ?? settings.name}
                        submitLabel="Rename"
                        onSubmit={(name) => {
                            updateSettings({ name });
                            net.send({ t: 'name', name });
                        }}
                    />
                </Card>
                <Card title="Create a Room">
                    <form
                        className="flex flex-col gap-2 pt-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            net.send({ t: 'create', name: roomName, password });
                        }}
                    >
                        <input
                            className={inputClass}
                            value={roomName}
                            maxLength={ROOM_NAME_MAX_LENGTH}
                            placeholder={`${state.me?.name ?? 'My'}'s room`}
                            aria-label="Room name"
                            onInput={(e: any) => setRoomName(e.target.value)}
                        />
                        <input
                            className={inputClass}
                            type="password"
                            value={password}
                            maxLength={PASSWORD_MAX_LENGTH}
                            placeholder="Password (optional)"
                            aria-label="Room password"
                            autoComplete="new-password"
                            onInput={(e: any) => setPassword(e.target.value)}
                        />
                        <button type="submit" className={buttonClass}>
                            Create Room
                        </button>
                    </form>
                </Card>
            </div>
        </>
    );
}

function ResultTable({ result }: { result: MatchResult }) {
    const slots = result.names.map((name, i) => ({ name, i })).filter((s) => s.name !== null);
    const best = Math.max(...slots.map((s) => result.bumps[s.i]));
    const reason = { score: `First to ${result.endScore}`, host: 'Ended by the host', empty: 'Everybody left' }[
        result.reason
    ];

    return (
        <div className="pt-2 overflow-x-auto">
            <p className="text-xs pb-1">
                {levelFor(result.level).name} · {reason}
            </p>
            <table className="text-sm md:text-xs border-collapse w-full">
                <thead>
                    <tr>
                        <th className="text-left pr-2 font-normal italic">bumped →</th>
                        {slots.map((s) => (
                            <th key={s.i} className="px-1 truncate max-w-16" title={s.name!}>
                                {s.name}
                            </th>
                        ))}
                        <th className="pl-2">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {slots.map((row) => (
                        <tr key={row.i}>
                            <td className="pr-2 font-bold truncate max-w-24" title={row.name!}>
                                {row.name}
                            </td>
                            {slots.map((column) => (
                                <td key={column.i} className="text-center">
                                    {column.i === row.i ? '-' : result.bumped[row.i][column.i]}
                                </td>
                            ))}
                            <td className={`pl-2 text-center ${result.bumps[row.i] === best ? 'font-bold' : ''}`}>
                                {result.bumps[row.i]}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-xs pt-1">Each row shows how often that player landed on the others.</p>
        </div>
    );
}

function ControlSettings({
    settings,
    updateSettings,
}: {
    settings: OnlineSettings;
    updateSettings: (p: Partial<OnlineSettings>) => void;
}) {
    const gamepads = useGamepads();
    const [configuring, setConfiguring] = useState<Gamepad | null>(null);
    const options = MAPPINGS.map((m) => ({ id: m.id, name: m.name })).concat(
        gamepads.map((g) => ({ id: getGamepadId(g), name: getFriendlyGamepadName(g) }))
    );
    const selectedGamepad = gamepads.find((g) => getGamepadId(g) === settings.control);
    const [musicAvailable, setMusicAvailable] = useState(true);
    useEffect(() => setMusicAvailable(window.isSecureContext && typeof AudioWorkletNode !== 'undefined'), []);
    const known = options.some((o) => o.id === settings.control);

    return (
        <div className="flex flex-col gap-1 pt-2">
            <label className="text-sm md:text-xs font-bold" htmlFor="online-control">
                Controls
            </label>
            <div className="flex flex-row gap-2">
                <select
                    id="online-control"
                    className="text-sm md:text-xs border-2 border-inset p-1 md:py-0 flex-grow min-w-0"
                    value={known ? settings.control : MAPPINGS[0].id}
                    onChange={(e: any) => updateSettings({ control: e.target.value })}
                >
                    {options.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name}
                        </option>
                    ))}
                </select>
                {selectedGamepad && (
                    <button className={smallButtonClass} onClick={() => setConfiguring(selectedGamepad)}>
                        Configure
                    </button>
                )}
            </div>
            <p className="text-xs">Connect a gamepad and press a button on it to see it in the list.</p>
            {!musicAvailable && (
                <p className="text-xs">
                    Music needs an HTTPS address (or localhost); over plain HTTP only the sound effects play.
                </p>
            )}
            {[
                ['muteMusic', 'Mute music'],
                ['muteEffects', 'Mute sound effects'],
                ['noGore', 'No gore'],
                ['noFlies', 'No flies'],
            ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={settings[key] as boolean}
                        onChange={(e: any) => updateSettings({ [key]: e.target.checked })}
                    />
                    <span className="text-md md:text-sm">{label}</span>
                </label>
            ))}
            {configuring && (
                <ConfigureController
                    gamepad={configuring}
                    onComplete={(mappings) => {
                        updateSettings({
                            gamepadConfigs: { ...settings.gamepadConfigs, [getGamepadId(configuring)]: mappings },
                        });
                        setConfiguring(null);
                    }}
                    onCancel={() => setConfiguring(null)}
                />
            )}
        </div>
    );
}

function Room({
    state,
    room,
    settings,
    updateSettings,
}: {
    state: NetState;
    room: RoomDetail;
    settings: OnlineSettings;
    updateSettings: (p: Partial<OnlineSettings>) => void;
}) {
    const [showLevelSelector, setShowLevelSelector] = useState(false);
    const [copied, setCopied] = useState(false);
    const me = room.members.find((m) => m.id === state.me?.id);
    const isHost = room.hostId === state.me?.id;
    const level = levelFor(room.level);
    const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/?room=${room.id}` : '';

    const copyInvite = () => {
        navigator.clipboard?.writeText(inviteLink).then(
            () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            },
            () => window.prompt('Copy this invite link:', inviteLink)
        );
    };

    return (
        <>
            <div className="flex flex-col w-full gap-2">
                <Card title={`${room.locked ? '🔒 ' : ''}${room.name}`} className="w-full md:w-86 flex-shrink-0">
                    <div className="flex flex-row flex-wrap gap-2 pt-2">
                        <button className={smallButtonClass} onClick={copyInvite}>
                            {copied ? 'Copied!' : 'Copy invite link'}
                        </button>
                        <button className={smallButtonClass} onClick={() => net.send({ t: 'leave' })}>
                            Leave room
                        </button>
                    </div>
                    {room.locked && <p className="text-xs pt-2">Friends will also need the room password.</p>}
                </Card>
                <Card title="Bunnies" className="w-full md:w-86">
                    <ul className="grid grid-cols-2 gap-2 list-none p-0 m-0 pt-2">
                        {BUNNY_NAMES.map((bunny, slot) => {
                            const member = room.members.find((m) => m.slot === slot);
                            const free = !member;
                            const canTake = free && room.status === 'lobby';
                            return (
                                <li key={bunny}>
                                    <button
                                        className={`w-full flex flex-row items-center gap-2 p-1 border-2 text-left ${
                                            member?.id === state.me?.id
                                                ? 'border-black bg-brainchild-primary'
                                                : canTake
                                                  ? 'border-dashed border-brainchild-separator hover:border-black cursor-pointer'
                                                  : 'border-brainchild-separator'
                                        }`}
                                        disabled={!canTake}
                                        title={canTake ? `Play as ${bunny}` : undefined}
                                        onClick={() => net.send({ t: 'slot', slot })}
                                    >
                                        <BunnyPortrait bunny={slot} className="w-12 h-12 flex-shrink-0" />
                                        <span className="min-w-0">
                                            <span className="block text-xs italic">{bunny}</span>
                                            <span className="block text-sm md:text-xs font-bold truncate">
                                                {member ? member.name : canTake ? 'Free: take it' : 'Free'}
                                            </span>
                                            {member && (
                                                <span className="block text-xs">
                                                    {[
                                                        member.host && 'host',
                                                        member.id === state.me?.id && 'you',
                                                        room.status !== 'lobby' && !member.inMatch && 'waiting',
                                                    ]
                                                        .filter(Boolean)
                                                        .join(', ')}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </Card>
                {room.lastResult && (
                    <Card title="Last Match" className="w-full md:w-86">
                        <ResultTable result={room.lastResult} />
                    </Card>
                )}
            </div>
            <div className="flex flex-col w-full gap-2 pt-2 md:pt-0">
                <Card title="Match">
                    {room.status !== 'lobby' ? (
                        <p className="text-sm md:text-xs pt-2">
                            A match is in progress{me && !me.inMatch ? ". You'll be in the next one." : '.'}
                        </p>
                    ) : isHost ? (
                        <button className={`w-full mt-2 ${buttonClass}`} onClick={() => net.send({ t: 'start' })}>
                            Start Match
                        </button>
                    ) : (
                        <p className="text-sm md:text-xs pt-2">Waiting for the host to start the match.</p>
                    )}
                    <div className="flex flex-row items-center gap-2 pt-3">
                        <label className="text-sm md:text-xs font-bold" htmlFor="end-score">
                            First to
                        </label>
                        {isHost && room.status === 'lobby' ? (
                            <select
                                id="end-score"
                                className="text-sm md:text-xs border-2 border-inset p-1 md:py-0"
                                value={room.endScore}
                                onChange={(e: any) => net.send({ t: 'endScore', endScore: Number(e.target.value) })}
                            >
                                {END_SCORE_OPTIONS.map((score) => (
                                    <option key={score} value={score}>
                                        {score}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span id="end-score" className="text-sm md:text-xs">
                                {room.endScore}
                            </span>
                        )}
                        <span className="text-sm md:text-xs">bumps</span>
                    </div>
                </Card>
                <Card title="Level">
                    <div className="flex flex-col gap-1 pt-1">
                        <img src={`/levels/${level.imageUrl}`} alt={`Preview of the level ${level.name}`} />
                        <p className="text-sm md:text-xs font-bold py-1">{level.name}</p>
                        {isHost && room.status === 'lobby' && (
                            <button className={`w-full ${buttonClass}`} onClick={() => setShowLevelSelector(true)}>
                                Change Level
                            </button>
                        )}
                    </div>
                </Card>
                <Card title="Your Settings">
                    <ControlSettings settings={settings} updateSettings={updateSettings} />
                </Card>
            </div>
            {showLevelSelector && (
                <LevelSelector
                    close={() => setShowLevelSelector(false)}
                    selectedLevel={level}
                    setSelectedLevel={(selected: Level) => net.send({ t: 'level', level: selected.datFile })}
                />
            )}
        </>
    );
}

export default function Online() {
    usePageMeta(onlinePageMeta);
    const state = useNet();
    const [settings, updateSettings, loaded] = useOnlineSettings();
    const gamepads = useGamepads();

    useEffect(() => {
        if (loaded && settings.name && state.status === 'idle') net.connect(settings.name);
    }, [loaded, settings.name, state.status]);

    // Invite links: join rooms without a password right away, locked ones ask for it in the room list
    useEffect(() => {
        const invited = roomFromUrl();
        if (!invited || state.status !== 'online' || state.room) return;
        const room = state.rooms.find((r) => r.id === invited);
        if (room && !room.locked) net.send({ t: 'join', room: room.id, password: '' });
    }, [state.status, state.rooms.length > 0]);

    if (state.match && state.me) {
        const matchSettings: MatchSettings = {
            control: deviceFor(settings, gamepads),
            muteMusic: settings.muteMusic,
            muteEffects: settings.muteEffects,
            noGore: settings.noGore,
            noFlies: settings.noFlies,
        };
        return (
            <>
                <ErrorToast error={state.error} />
                <OnlineMatch
                    key={state.match.id}
                    match={state.match}
                    myId={state.me.id}
                    isHost={state.room?.hostId === state.me.id}
                    settings={matchSettings}
                />
            </>
        );
    }

    let content;
    if (!loaded) {
        content = null;
    } else if (!settings.name) {
        content = (
            <Card title="Welcome, bunny!" className="w-full md:w-86">
                <p className="text-sm md:text-xs pt-3">Choose a name that the other players will see.</p>
                <NameForm initial="" submitLabel="Continue" onSubmit={(name) => updateSettings({ name })} />
            </Card>
        );
    } else if (state.status !== 'online') {
        content = (
            <Card title="Connecting" className="w-full md:w-86">
                <p className="text-sm md:text-xs pt-3">
                    {state.status === 'offline'
                        ? 'The game server is not reachable right now. Retrying...'
                        : 'Connecting to the game server...'}
                </p>
            </Card>
        );
    } else if (state.room) {
        content = <Room state={state} room={state.room} settings={settings} updateSettings={updateSettings} />;
    } else {
        content = <Lobby state={state} settings={settings} updateSettings={updateSettings} />;
    }

    return (
        <Layout
            title={state.room ? 'Room' : 'Play Online'}
            online={state.status === 'online' ? state.online : undefined}
        >
            <ErrorToast error={state.error} />
            {content}
        </Layout>
    );
}
