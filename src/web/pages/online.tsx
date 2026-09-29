import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { lazy } from 'preact-iso';
import { PageMeta, usePageMeta } from '../hooks/page-meta';
import { useNet } from '../hooks/net';
import { useGamepads } from '../hooks/gamepads';
import { OnlineSettings, useOnlineSettings } from '../hooks/online-settings';
import { Level } from '../components/level-selector';
import { ConfigureController } from '../components/configure-controller';
import { MAPPINGS, getFriendlyGamepadName, getGamepadId, getKnownGamepadDefaults } from '../components/controls';
import type { MatchSettings } from '../components/online-match';
import { RECOMMENDED_LEVELS } from '../constants';
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
import { GameAssets, game_assets, level_thumbnail, load_game_assets } from '../pixel/assets';
import {
    Button,
    Checkbox,
    Cycler,
    Dialog,
    Icon,
    Panel,
    Paragraph,
    PixelCanvas,
    Stage,
    Text,
    TextInput,
    gp,
} from '../pixel/components';
import { TextColor, text_width } from '../pixel/font';
import { BUNNY_SPOTS, SCENE_X, SCENE_Y, Scene, SceneBunny } from '../pixel/scene';
import '../pixel/pixel.css';

const OnlineMatch = lazy(() => import('../components/online-match'));

const onlinePageMeta: PageMeta = {
    title: "Jump 'n Bump Online",
    description: "Play Jump 'n Bump online with your friends: create a room, pick a level and start bumping.",
    keywords: ["Jump 'n Bump", 'online multiplayer', 'browser game', 'retro game', 'bunny game'],
    ogDescription: "Play Jump 'n Bump online with your friends.",
    ogUrl: '/',
    robots: 'noindex',
};

type Toast = { message: string; color: TextColor; seq: number; at: number };

const TOAST_MS = 5000;

/** The last match result the player has seen, per room; the room view unmounts while a match runs. */
const seen_results = new Map<string, string>();
const ROOMS_PER_PAGE = 8;
const LEVELS_PER_PAGE = 15;
/** Where the bunnies hop about while you are in the lobby (right of the room list). */
const LOBBY_SPOTS = [286, 326, 366, 406].map((x) => ({ x, y: SCENE_Y + 160 }));

const ORDERED_LEVELS: Level[] = [
    ...levels.filter((l) => RECOMMENDED_LEVELS.includes(l.datFile)),
    ...levels.filter((l) => !RECOMMENDED_LEVELS.includes(l.datFile)),
];

function levelFor(datFile: string): Level {
    return levels.find((l) => l.datFile === datFile) ?? { name: datFile, datFile, imageUrl: 'jumpbump.jpg' };
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

const CONTROL_LABELS: Record<string, string> = {
    keyboard_arrows: 'Arrow keys',
    keyboard_awd: 'A, W, D',
    keyboard_jil: 'J, I, L',
    keyboard_numpad: 'Numpad 4 8 6',
    mouse: 'Mouse buttons',
};

/** Places children at a stage position (game pixels). */
function At({
    x,
    y,
    right,
    bottom,
    children,
    className = '',
}: {
    x?: number;
    y?: number;
    right?: number;
    bottom?: number;
    children: any;
    className?: string;
}) {
    const style: Record<string, string> = {};
    if (x !== undefined) style.left = gp(x);
    if (y !== undefined) style.top = gp(y);
    if (right !== undefined) style.right = gp(right);
    if (bottom !== undefined) style.bottom = gp(bottom);
    return (
        <div className={`gp-abs ${className}`} style={style}>
            {children}
        </div>
    );
}

function TextLink({ href, label }: { href: string; label: string }) {
    const [hot, setHot] = useState(false);
    return (
        <a
            href={href}
            className="inline-flex"
            onMouseEnter={() => setHot(true)}
            onMouseLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
        >
            <Text text={label} color={hot ? 'gold' : 'dim'} shadow />
        </a>
    );
}

function ToastView({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const remaining = toast ? toast.at + TOAST_MS - Date.now() : 0;
        if (remaining <= 0) {
            setVisible(false);
            return;
        }
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), remaining);
        return () => clearTimeout(timer);
    }, [toast?.seq]);

    if (!toast || !visible) return null;
    return (
        <div
            className="gp-toast gp-panel"
            role="alert"
            onClick={() => {
                setVisible(false);
                onDismiss();
            }}
        >
            <Text text={toast.message} color={toast.color} />
        </div>
    );
}

function NameDialog({
    initial,
    title,
    onSubmit,
    onClose,
}: {
    initial: string;
    title: string;
    onSubmit: (name: string) => void;
    onClose?: () => void;
}) {
    const [name, setName] = useState(initial);
    const trimmed = name.trim();
    return (
        <Dialog title={title} onClose={onClose} width={200}>
            <form
                className="gp-col"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (trimmed) onSubmit(trimmed);
                }}
            >
                <Paragraph text="The other bunnies will see this name." width={184} />
                <TextInput
                    value={name}
                    onInput={setName}
                    label="Your name"
                    placeholder="Your name"
                    maxLength={NAME_MAX_LENGTH}
                    width={184}
                    autoFocus
                />
                <div className="gp-row justify-end">
                    {onClose && <Button label="CANCEL" onClick={onClose} />}
                    <Button label="OK" type="submit" primary disabled={!trimmed} width={40} />
                </div>
            </form>
        </Dialog>
    );
}

function CreateRoomDialog({ myName, onClose }: { myName: string; onClose: () => void }) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    return (
        <Dialog title="NEW ROOM" onClose={onClose} width={220}>
            <form
                className="gp-col"
                onSubmit={(e) => {
                    e.preventDefault();
                    net.send({ t: 'create', name, password });
                    onClose();
                }}
            >
                <Text text="Room name" color="wood" />
                <TextInput
                    value={name}
                    onInput={setName}
                    label="Room name"
                    placeholder={`${myName}'s room`}
                    maxLength={ROOM_NAME_MAX_LENGTH}
                    width={204}
                    autoFocus
                />
                <Text text="Password" color="wood" />
                <TextInput
                    value={password}
                    onInput={setPassword}
                    label="Room password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    password
                    width={204}
                    placeholder="None: anyone can join"
                    autoComplete="new-password"
                />
                <div className="gp-row justify-end">
                    <Button label="CANCEL" onClick={onClose} />
                    <Button label="CREATE" type="submit" primary />
                </div>
            </form>
        </Dialog>
    );
}

function PasswordDialog({ room, onClose }: { room: RoomSummary; onClose: () => void }) {
    const [password, setPassword] = useState('');
    return (
        <Dialog title="LOCKED ROOM" onClose={onClose} width={210}>
            <form
                className="gp-col"
                onSubmit={(e) => {
                    e.preventDefault();
                    net.send({ t: 'join', room: room.id, password });
                    onClose();
                }}
            >
                <div className="gp-row">
                    <Icon name="lock" />
                    <Text text={room.name} color="gold" maxWidth={180} />
                </div>
                <TextInput
                    value={password}
                    onInput={setPassword}
                    label={`Password for ${room.name}`}
                    placeholder="Password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    password
                    width={194}
                    autoFocus
                    autoComplete="current-password"
                />
                <div className="gp-row justify-end">
                    <Button label="CANCEL" onClick={onClose} />
                    <Button label="JOIN" type="submit" primary disabled={!password} />
                </div>
            </form>
        </Dialog>
    );
}

const TIPS = [
    'Create a room, then send the invite link to your friends.',
    "Jump on the other bunnies' heads to score a bump.",
    'Up to four bunnies can play in one room.',
    'Rooms with a lock need a password.',
    'The host picks one of over 250 levels.',
];

/** Messages under the forest, one after the other, like in the original menu. */
function Tips() {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setIndex((i) => (i + 1) % TIPS.length), 6000);
        return () => clearInterval(timer);
    }, []);
    return (
        <div key={index} className="gp-fade" style={{ display: 'flex', justifyContent: 'center', width: gp(400) }}>
            <Text text={TIPS[index]} color="white" />
        </div>
    );
}

function Lobby({
    state,
    onCreate,
    onJoinLocked,
}: {
    state: NetState;
    onCreate: () => void;
    onJoinLocked: (room: RoomSummary) => void;
}) {
    const [page, setPage] = useState(0);
    const paged = state.rooms.length > ROOMS_PER_PAGE;
    const per_page = paged ? ROOMS_PER_PAGE - 1 : ROOMS_PER_PAGE;
    const pages = Math.max(1, Math.ceil(state.rooms.length / per_page));
    const current = Math.min(page, pages - 1);
    const shown = state.rooms.slice(current * per_page, (current + 1) * per_page);

    const join = (room: RoomSummary) => {
        if (room.locked) onJoinLocked(room);
        else net.send({ t: 'join', room: room.id, password: '' });
    };

    return (
        <>
            <At x={34} y={66}>
                <Panel className="gp-col" style={{ width: gp(218), height: gp(146) }}>
                    <div className="gp-row justify-between">
                        <Text text="ROOMS" color="gold" />
                        <Button label="NEW ROOM" primary onClick={onCreate} />
                    </div>
                    <div className="gp-col" style={{ gap: 0, flexGrow: 1 }}>
                        {shown.length === 0 && (
                            <div className="gp-col" style={{ paddingTop: gp(16), alignItems: 'center' }}>
                                <Text text="No rooms yet." color="white" />
                                <Paragraph
                                    text="Make a new one and invite your friends!"
                                    width={170}
                                    color="dim"
                                    center
                                />
                            </div>
                        )}
                        {shown.map((room) => {
                            const full = room.players >= MAX_ROOM_PLAYERS;
                            return (
                                <button
                                    key={room.id}
                                    type="button"
                                    className="gp-list-item"
                                    disabled={full}
                                    title={`${room.name} - ${room.level}${full ? ' (full)' : ''}`}
                                    onClick={() => join(room)}
                                >
                                    <span style={{ width: gp(7), display: 'inline-flex' }}>
                                        {room.locked && <Icon name="lock" />}
                                    </span>
                                    <span style={{ width: gp(136), display: 'inline-flex' }}>
                                        <Text text={room.name} color={full ? 'dim' : 'white'} maxWidth={134} />
                                    </span>
                                    <span style={{ width: gp(30), display: 'inline-flex', justifyContent: 'flex-end' }}>
                                        {room.status !== 'lobby' ? (
                                            <Text text="play" color="red" />
                                        ) : (
                                            <Text
                                                text={`${room.players}/${MAX_ROOM_PLAYERS}`}
                                                color={full ? 'dim' : 'green'}
                                            />
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {paged && (
                        <div className="gp-row justify-center">
                            <Cycler
                                label="Room list page"
                                value={current}
                                options={[...Array(pages).keys()]}
                                format={(p) => `${p + 1}/${pages}`}
                                onChange={(p: number) => setPage(p)}
                                width={30}
                            />
                        </div>
                    )}
                </Panel>
            </At>
            <At x={SCENE_X} y={222}>
                <Tips />
            </At>
        </>
    );
}

function LevelDialog({
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
    const [page, setPage] = useState(() =>
        Math.max(0, Math.floor(ORDERED_LEVELS.findIndex((l) => l.datFile === selected) / LEVELS_PER_PAGE))
    );
    const pages = Math.max(1, Math.ceil(filtered.length / LEVELS_PER_PAGE));
    const current = Math.min(page, pages - 1);
    const shown = filtered.slice(current * LEVELS_PER_PAGE, (current + 1) * LEVELS_PER_PAGE);

    return (
        <Dialog title="CHOOSE A LEVEL" onClose={onClose} width={440}>
            <div className="gp-col">
                <div className="gp-row justify-between">
                    <TextInput
                        value={search}
                        onInput={(value) => {
                            setSearch(value);
                            setPage(0);
                        }}
                        label="Search levels"
                        placeholder="Search..."
                        width={180}
                        autoFocus
                    />
                    <Cycler
                        label="Level page"
                        value={current}
                        options={[...Array(pages).keys()]}
                        format={(p) => `${p + 1}/${pages}`}
                        onChange={(p: number) => setPage(p)}
                        width={40}
                    />
                </div>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: gp(2),
                        height: gp(201),
                        alignContent: 'start',
                    }}
                >
                    {shown.map((level) => (
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
                    {shown.length === 0 && <Text text="No level with that name." color="dim" />}
                </div>
            </div>
        </Dialog>
    );
}

function Thumbnail({
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
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    useEffect(() => {
        let active = true;
        setCanvas(null);
        level_thumbnail(`/levels/${level.imageUrl}`, width, height).then(
            (c) => active && setCanvas(c),
            () => {}
        );
        return () => {
            active = false;
        };
    }, [level.imageUrl, width, height]);
    return (
        <span
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

function OptionsDialog({
    settings,
    updateSettings,
    onClose,
}: {
    settings: OnlineSettings;
    updateSettings: (patch: Partial<OnlineSettings>) => void;
    onClose: () => void;
}) {
    const gamepads = useGamepads();
    const [configuring, setConfiguring] = useState<Gamepad | null>(null);
    const [musicAvailable, setMusicAvailable] = useState(true);
    useEffect(() => setMusicAvailable(window.isSecureContext && typeof AudioWorkletNode !== 'undefined'), []);

    const options = [...MAPPINGS.map((m) => m.id), ...gamepads.map(getGamepadId)];
    const current = options.includes(settings.control) ? settings.control : MAPPINGS[0].id;
    const selectedGamepad = gamepads.find((g) => getGamepadId(g) === current);
    const label = (id: string) => {
        const gamepad = gamepads.find((g) => getGamepadId(g) === id);
        return gamepad ? getFriendlyGamepadName(gamepad) : (CONTROL_LABELS[id] ?? id);
    };

    return (
        <>
            <Dialog title="OPTIONS" onClose={onClose} width={250}>
                <div className="gp-col">
                    <Text text="Controls" color="wood" />
                    <div className="gp-row">
                        <Cycler
                            label="Controls"
                            value={current}
                            options={options}
                            format={label}
                            onChange={(control) => updateSettings({ control })}
                            width={150}
                        />
                        {selectedGamepad && <Button label="SET UP" onClick={() => setConfiguring(selectedGamepad)} />}
                    </div>
                    <Paragraph
                        text="Plug in a gamepad and press one of its buttons to add it here."
                        width={234}
                        color="dim"
                    />
                    <div className="gp-col" style={{ gap: gp(2), paddingTop: gp(2) }}>
                        <Checkbox
                            label="Mute music"
                            checked={settings.muteMusic}
                            onChange={(muteMusic) => updateSettings({ muteMusic })}
                        />
                        <Checkbox
                            label="Mute sound effects"
                            checked={settings.muteEffects}
                            onChange={(muteEffects) => updateSettings({ muteEffects })}
                        />
                        <Checkbox
                            label="No gore"
                            checked={settings.noGore}
                            onChange={(noGore) => updateSettings({ noGore })}
                        />
                        <Checkbox
                            label="No flies"
                            checked={settings.noFlies}
                            onChange={(noFlies) => updateSettings({ noFlies })}
                        />
                    </div>
                    {!musicAvailable && (
                        <Paragraph
                            text="Music needs an HTTPS address; only the sound effects will play."
                            width={234}
                            color="dim"
                        />
                    )}
                    <div className="gp-row justify-end">
                        <Button label="DONE" primary onClick={onClose} />
                    </div>
                </div>
            </Dialog>
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
        </>
    );
}

function ResultsDialog({ result, onClose }: { result: MatchResult; onClose: () => void }) {
    const slots = result.names.map((name, i) => ({ name, i })).filter((s) => s.name !== null);
    const best = Math.max(...slots.map((s) => result.bumps[s.i]));
    const reason = { score: `First to ${result.endScore}`, host: 'Ended by the host', empty: 'Everybody left' }[
        result.reason
    ];
    return (
        <Dialog title="LAST MATCH" onClose={onClose} width={330}>
            <div className="gp-col">
                <Text text={`${levelFor(result.level).name} - ${reason}`} color="dim" maxWidth={310} />
                <table className="gp-table" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th>
                                <Text text="bumped:" color="wood" />
                            </th>
                            {slots.map((s) => (
                                <th key={s.i}>
                                    <Text text={s.name!} color="white" maxWidth={50} />
                                </th>
                            ))}
                            <th>
                                <Text text="Total" color="gold" />
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {slots.map((row) => (
                            <tr key={row.i}>
                                <td>
                                    <Text text={row.name!} color="white" maxWidth={64} />
                                </td>
                                {slots.map((column) => (
                                    <td key={column.i}>
                                        <Text
                                            text={column.i === row.i ? '-' : String(result.bumped[row.i][column.i])}
                                            color={column.i === row.i ? 'dim' : 'white'}
                                        />
                                    </td>
                                ))}
                                <td>
                                    <Text
                                        text={String(result.bumps[row.i])}
                                        color={result.bumps[row.i] === best ? 'gold' : 'white'}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <Paragraph text="Each row: how often that bunny landed on the others." width={310} color="dim" />
                <div className="gp-row justify-end">
                    <Button label="OK" primary onClick={onClose} width={40} />
                </div>
            </div>
        </Dialog>
    );
}

function Room({
    state,
    room,
    onOptions,
    onToast,
}: {
    state: NetState;
    room: RoomDetail;
    onOptions: () => void;
    onToast: (message: string, color?: TextColor) => void;
}) {
    const [showLevels, setShowLevels] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [hotSlot, setHotSlot] = useState<number | null>(null);
    const myId = state.me?.id;
    const me = room.members.find((m) => m.id === myId);
    const isHost = room.hostId === myId;
    const level = levelFor(room.level);
    const lastResult = room.lastResult;
    const canPick = room.status === 'lobby';

    // Show the results when a match ends, but not the old result of a room you have just joined
    const resultKey = lastResult ? JSON.stringify(lastResult) : '';
    useEffect(() => {
        const seen = seen_results.get(room.id);
        if (seen !== undefined && resultKey && resultKey !== seen) setShowResults(true);
        seen_results.set(room.id, resultKey);
    }, [room.id, resultKey]);

    const invite = () => {
        const link = `${window.location.origin}/?room=${room.id}`;
        navigator.clipboard?.writeText(link).then(
            () =>
                onToast(
                    room.locked ? 'Invite link copied. They need the password too.' : 'Invite link copied!',
                    'green'
                ),
            () => window.prompt('Copy this invite link:', link)
        );
    };

    let status: string;
    if (room.status !== 'lobby')
        status = me && !me.inMatch ? "A match is on. You'll be in the next one." : 'A match is on.';
    else if (isHost) status = 'You are the host: pick a level and start the match.';
    else status = 'Waiting for the host to start the match.';

    return (
        <>
            <At x={6} y={6}>
                <Panel className="gp-row" style={{ gap: gp(3) }}>
                    {room.locked && <Icon name="lock" />}
                    <Text text={room.name} color="gold" maxWidth={140} />
                </Panel>
            </At>

            {BUNNY_NAMES.map((bunny, slot) => {
                const member = room.members.find((m) => m.slot === slot);
                const spot = BUNNY_SPOTS[slot];
                const canTake = !member && canPick;
                const mine = member?.id === myId;
                const hot = hotSlot === slot && canTake;
                const name = member ? member.name : hot ? `Play as ${bunny}` : bunny;
                const max = member ? 66 : 74;
                const width = Math.min(max, text_width(name)) + 6;
                const color: TextColor = member
                    ? mine
                        ? 'gold'
                        : member.inMatch || canPick
                          ? 'white'
                          : 'dim'
                    : hot
                      ? 'green'
                      : 'dim';
                return (
                    <div key={bunny}>
                        <At x={spot.x + 8 - Math.ceil(width / 2)} y={spot.y - 19}>
                            <span className="gp-tag" style={{ width: gp(width) }}>
                                <Text text={name} color={color} maxWidth={max} />
                            </span>
                        </At>
                        {member?.host && (
                            <At
                                x={spot.x + 8 - Math.ceil(width / 2) - 3}
                                y={spot.y - 24}
                                className="pointer-events-none"
                            >
                                <Icon name="crown" />
                            </At>
                        )}
                        {mine && (
                            <At x={spot.x + 5} y={spot.y - 27} className="gp-bob pointer-events-none">
                                <Icon name="down" />
                            </At>
                        )}
                        <button
                            type="button"
                            className="gp-slot"
                            style={{ left: gp(spot.x - 2), top: gp(spot.y - 2), width: gp(20), height: gp(20) }}
                            disabled={!canTake}
                            aria-label={member ? `${bunny}: ${member.name}` : `Play as ${bunny}`}
                            title={canTake ? `Play as ${bunny}` : undefined}
                            onClick={() => net.send({ t: 'slot', slot })}
                            onMouseEnter={() => setHotSlot(slot)}
                            onMouseLeave={() => setHotSlot(null)}
                            onFocus={() => setHotSlot(slot)}
                            onBlur={() => setHotSlot(null)}
                        />
                    </div>
                );
            })}

            <At x={342} y={6}>
                <Panel className="gp-col" style={{ width: gp(132), alignItems: 'center' }}>
                    <Text text="LEVEL" color="gold" />
                    <Thumbnail level={level} width={100} height={64} />
                    <Paragraph text={level.name} width={118} center />
                    {isHost && canPick && <Button label="CHANGE" onClick={() => setShowLevels(true)} width={118} />}
                    <div className="gp-row justify-between" style={{ width: gp(118) }}>
                        <Text text="First to" color="wood" />
                        <Cycler
                            label="Score limit"
                            value={room.endScore}
                            options={END_SCORE_OPTIONS}
                            onChange={(endScore) => net.send({ t: 'endScore', endScore })}
                            disabled={!isHost || !canPick}
                            width={26}
                        />
                    </div>
                    {isHost && canPick && (
                        <Button label="START MATCH" primary onClick={() => net.send({ t: 'start' })} width={118} />
                    )}
                </Panel>
            </At>

            <At x={SCENE_X + 6} y={216}>
                <div className="gp-col" style={{ gap: 0 }}>
                    <Text text={status} color="white" />
                    <Text text={canPick ? 'Click a free bunny to switch to it.' : ' '} color="dim" />
                </div>
            </At>
            <At x={SCENE_X + 6} y={250}>
                <div className="gp-row" style={{ gap: gp(3) }}>
                    <Button label="INVITE" onClick={invite} />
                    <Button label="OPTIONS" onClick={onOptions} />
                    {lastResult && <Button label="LAST MATCH" onClick={() => setShowResults(true)} />}
                    <Button label="LEAVE" onClick={() => net.send({ t: 'leave' })} />
                </div>
            </At>

            {showLevels && (
                <LevelDialog
                    selected={room.level}
                    onSelect={(selected) => net.send({ t: 'level', level: selected.datFile })}
                    onClose={() => setShowLevels(false)}
                />
            )}
            {showResults && lastResult && <ResultsDialog result={lastResult} onClose={() => setShowResults(false)} />}
        </>
    );
}

export default function Online() {
    usePageMeta(onlinePageMeta);
    const state = useNet();
    const [settings, updateSettings, loaded] = useOnlineSettings();
    const gamepads = useGamepads();
    const [assets, setAssets] = useState<GameAssets | null>(game_assets());
    const [assetsFailed, setAssetsFailed] = useState(false);
    const [dialog, setDialog] = useState<'name' | 'create' | 'options' | null>(null);
    const [lockedRoom, setLockedRoom] = useState<RoomSummary | null>(null);
    const [toast, setToast] = useState<Toast | null>(null);
    const toastSeq = useRef(0);

    const showToast = (message: string, color: TextColor = 'red') =>
        setToast({ message, color, seq: ++toastSeq.current, at: Date.now() });

    useEffect(() => {
        load_game_assets().then(setAssets, (error) => {
            console.error('could not load the game graphics', error);
            setAssetsFailed(true);
        });
    }, []);

    useEffect(() => {
        if (state.error)
            setToast({ message: state.error.message, color: 'red', seq: ++toastSeq.current, at: state.error.at });
    }, [state.error?.seq]);

    useEffect(() => {
        if (loaded && settings.name && state.status === 'idle') net.connect(settings.name);
    }, [loaded, settings.name, state.status]);

    // Invite links: open rooms are joined right away, locked ones ask for the password
    const invited = useRef(roomFromUrl());
    useEffect(() => {
        if (!invited.current || state.status !== 'online' || state.room) return;
        const room = state.rooms.find((r) => r.id === invited.current);
        if (!room) return;
        invited.current = null;
        if (room.locked) setLockedRoom(room);
        else net.send({ t: 'join', room: room.id, password: '' });
    }, [state.status, state.rooms]);

    if (state.match && state.me) {
        const matchSettings: MatchSettings = {
            control: deviceFor(settings, gamepads),
            muteMusic: settings.muteMusic,
            muteEffects: settings.muteEffects,
            noGore: settings.noGore,
            noFlies: settings.noFlies,
        };
        return (
            <OnlineMatch
                key={state.match.id}
                match={state.match}
                myId={state.me.id}
                isHost={state.room?.hostId === state.me.id}
                settings={matchSettings}
            />
        );
    }

    if (!assets) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center text-white">
                {assetsFailed ? 'The game graphics could not be loaded. Please reload the page.' : ''}
            </div>
        );
    }

    const room = state.room;
    const online = state.status === 'online';
    const bunnies: SceneBunny[] = room
        ? BUNNY_NAMES.map((_, slot) => ({ slot, ghost: !room.members.some((m) => m.slot === slot) }))
        : LOBBY_SPOTS.map((spot, slot) => ({ slot, ...spot }));

    return (
        <Stage>
            <Scene assets={assets} bunnies={bunnies} />

            {!room && online && (
                <>
                    <At x={6} y={6}>
                        <div className="gp-row" style={{ gap: gp(3) }}>
                            <Text text="You:" color="dim" shadow />
                            <Button
                                label={state.me?.name ?? settings.name}
                                onClick={() => setDialog('name')}
                                title="Change your name"
                            />
                        </div>
                    </At>
                    <At right={6} y={8}>
                        <Text text={`Online: ${state.online}`} color="green" shadow />
                    </At>
                </>
            )}

            {loaded && !settings.name && (
                <NameDialog initial="" title="WELCOME, BUNNY!" onSubmit={(name) => updateSettings({ name })} />
            )}

            {loaded && settings.name && !online && (
                <At x={140} y={110}>
                    <Panel className="gp-col" style={{ width: gp(200), alignItems: 'center' }}>
                        <Text
                            text={state.status === 'offline' ? 'SERVER NOT REACHABLE' : 'CONNECTING...'}
                            color="gold"
                        />
                        <Text
                            text={state.status === 'offline' ? 'Trying again...' : 'Hold on to your ears.'}
                            color="dim"
                        />
                    </Panel>
                </At>
            )}

            {online && !room && (
                <Lobby state={state} onCreate={() => setDialog('create')} onJoinLocked={setLockedRoom} />
            )}
            {online && room && (
                <Room state={state} room={room} onOptions={() => setDialog('options')} onToast={showToast} />
            )}

            {!room && (
                <At x={SCENE_X + 8} y={262}>
                    <div className="gp-row" style={{ gap: gp(8) }}>
                        <TextLink href="/local" label="Local game" />
                        <TextLink href="/levels" label="Levels" />
                        <TextLink href="/about" label="About" />
                        <TextLink
                            href={import.meta.env.VITE_SOURCE_URL || 'https://github.com/jamsinclair/jumpnbump.js'}
                            label="Source"
                        />
                    </div>
                </At>
            )}

            {dialog === 'name' && (
                <NameDialog
                    initial={state.me?.name ?? settings.name}
                    title="YOUR NAME"
                    onClose={() => setDialog(null)}
                    onSubmit={(name) => {
                        updateSettings({ name });
                        net.send({ t: 'name', name });
                        setDialog(null);
                    }}
                />
            )}
            {dialog === 'create' && (
                <CreateRoomDialog myName={state.me?.name ?? settings.name} onClose={() => setDialog(null)} />
            )}
            {dialog === 'options' && (
                <OptionsDialog settings={settings} updateSettings={updateSettings} onClose={() => setDialog(null)} />
            )}
            {lockedRoom && !room && <PasswordDialog room={lockedRoom} onClose={() => setLockedRoom(null)} />}

            <ToastView toast={toast} onDismiss={() => net.clear_error()} />
        </Stage>
    );
}
