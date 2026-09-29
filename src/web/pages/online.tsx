import { useEffect, useRef, useState } from 'preact/hooks';
import { lazy } from 'preact-iso';
import { PageMeta, usePageMeta } from '../hooks/page-meta';
import { useNet } from '../hooks/net';
import { useGamepads } from '../hooks/gamepads';
import { OnlineSettings, useOnlineSettings } from '../hooks/online-settings';
import { ConfigureController } from '../components/configure-controller';
import { LevelDialog, Thumbnail } from '../components/level-dialog';
import { MAPPINGS, getFriendlyGamepadName, getGamepadId, getKnownGamepadDefaults } from '../controls';
import type { MatchSettings } from '../components/online-match';
import { Level } from '../constants';
import { net, NetState } from '../../net/client';
import {
    BUNNY_NAMES,
    END_SCORE_OPTIONS,
    MAX_ROOM_MEMBERS,
    MAX_ROOM_PLAYERS,
    MIN_MATCH_PLAYERS,
    MatchResult,
    NAME_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    ROOM_NAME_MAX_LENGTH,
    RoomDetail,
    RoomSummary,
} from '../../net/protocol';
import type { GameInputDevice } from '../../inputs';
import levels from '../levels.json';
import { GameAssets, game_assets, load_game_assets } from '../pixel/assets';
import {
    Button,
    Checkbox,
    Cycler,
    Dialog,
    Icon,
    Panel,
    Paragraph,
    Stage,
    Text,
    TextInput,
    gp,
} from '../pixel/components';
import { TextColor, text_width } from '../pixel/font';
import { BUNNY_SPOTS, SCENE_X, SCENE_Y, Scene, SceneBunny, SceneOwnBunny } from '../pixel/scene';
import { InputTracker, is_text_field, read_input_mask, track_input } from '../pixel/hop';
import '../pixel/pixel.css';

const OnlineMatch = lazy(() => import('../components/online-match'));

const onlinePageMeta: PageMeta = {
    title: "Jump 'n Bump Online",
    description: "Play Jump 'n Bump online with your friends: create a room, pick a level and start bumping.",
    robots: 'noindex',
};

/** Where the Source links point; set VITE_SOURCE_URL at build time when you publish your own changes. */
const SOURCE_URL = import.meta.env.VITE_SOURCE_URL || 'https://github.com/jamsinclair/jumpnbump.js';

type Toast = { message: string; color: TextColor; seq: number; at: number };

const TOAST_MS = 5000;

/** Per room, the match whose result the player has seen; the room view unmounts while a match runs. */
const seen_results = new Map<string, string>();
const ROOMS_PER_PAGE = 8;
/** Where the bunnies hop about while you are in the lobby (right of the room list). */
const LOBBY_SPOTS = [286, 326, 366, 406].map((x) => ({ x, y: SCENE_Y + 160 }));

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

/** A link in the game font; without `href` it is a button. */
function TextLink({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) {
    const [hot, setHot] = useState(false);
    const Tag = href ? 'a' : 'button';
    return (
        <Tag
            href={href}
            type={href ? undefined : 'button'}
            className="inline-flex cursor-pointer"
            onClick={onClick}
            onMouseEnter={() => setHot(true)}
            onMouseLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
        >
            <Text text={label} color={hot ? 'gold' : 'dim'} shadow />
        </Tag>
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
    note = 'The other bunnies will see this name.',
    onSubmit,
    onClose,
}: {
    initial: string;
    title: string;
    note?: string;
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
                <Paragraph text={note} width={184} />
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
                            const full = room.members >= MAX_ROOM_MEMBERS;
                            const watchers = room.members - room.players;
                            return (
                                <button
                                    key={room.id}
                                    type="button"
                                    className="gp-list-item"
                                    disabled={full}
                                    title={`${room.name} - ${room.level}${full ? ' (full)' : ''}${
                                        watchers > 0 ? ` - ${watchers} watching` : ''
                                    }`}
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
                                                color={
                                                    full ? 'dim' : room.players < MAX_ROOM_PLAYERS ? 'green' : 'wood'
                                                }
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
            <Dialog title="OPTIONS" onClose={configuring ? undefined : onClose} width={250}>
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

const SECRETS = ['jetpack', 'pogostick', 'lordoftheflies', 'bunniesinspace', 'bloodisthickerthanwater'];

function AboutDialog({ onClose }: { onClose: () => void }) {
    const [secrets, setSecrets] = useState(false);
    return (
        <Dialog title={secrets ? 'SECRETS' : 'ABOUT'} onClose={onClose} width={300}>
            <div className="gp-col">
                {secrets ? (
                    <>
                        <Paragraph
                            text="Type these words during a local game to switch them on or off. They do not work online."
                            width={284}
                        />
                        <div className="gp-col" style={{ gap: 0, alignItems: 'center' }}>
                            {SECRETS.map((word) => (
                                <Text key={word} text={word} color="gold" />
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <Paragraph
                            text="Jump 'n Bump was made in 1998 by Brainchild Design:"
                            width={284}
                            color="gold"
                        />
                        <div className="gp-col" style={{ gap: 0 }}>
                            <Paragraph text="Mattias Brynervall - code" width={284} />
                            <Paragraph text="Andreas Brynervall and Martin Magnusson - graphics" width={284} />
                            <Paragraph text="Anders Nilsson - music and sound" width={284} />
                        </div>
                        <Paragraph
                            text="Jamie Sinclair ported it to the browser (jumpnbump.js). This version adds online play."
                            width={284}
                        />
                        <Paragraph
                            text="It is free software under the GNU GPL, version 2 or later."
                            width={284}
                            color="dim"
                        />
                    </>
                )}
                <div className="gp-row justify-between">
                    <TextLink href={SOURCE_URL} label="Source code" />
                    <div className="gp-row" style={{ gap: gp(3) }}>
                        <Button label={secrets ? 'BACK' : 'SECRETS'} onClick={() => setSecrets(!secrets)} />
                        <Button label="OK" primary onClick={onClose} width={40} />
                    </div>
                </div>
            </div>
        </Dialog>
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

    // Show the results when a match ends, but not the old result of a room you have just joined,
    // and not after a match you played to the end: its score screen already showed them
    const resultKey = lastResult?.match ?? '';
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

    const players = room.members.filter((m) => m.slot !== null).length;
    const watchers = room.members.filter((m) => m.slot === null);
    const freeSlot = BUNNY_NAMES.findIndex((_, slot) => !room.members.some((m) => m.slot === slot));
    const enough = players >= MIN_MATCH_PLAYERS;

    let status: string;
    let hint = ' ';
    if (room.status !== 'lobby') {
        status = me && !me.inMatch ? 'A match is on. You can watch it.' : 'A match is on.';
        hint = me?.slot !== null ? "You'll play in the next one." : ' ';
    } else if (isHost) {
        status = enough ? 'You are the host: pick a level and start the match.' : 'A match needs at least two bunnies.';
        hint =
            me?.slot === null ? 'You only watch. Click a free bunny to play.' : 'Click a free bunny to switch to it.';
    } else {
        status = enough ? 'Waiting for the host to start the match.' : 'Waiting for more bunnies...';
        hint =
            me?.slot === null ? 'You only watch. Click a free bunny to play.' : 'Click a free bunny to switch to it.';
    }

    return (
        <>
            <At x={6} y={6}>
                <Panel className="gp-row" style={{ gap: gp(3) }}>
                    {room.locked && <Icon name="lock" />}
                    <Text text={room.name} color="gold" maxWidth={140} />
                </Panel>
            </At>
            {watchers.length > 0 && (
                <At x={8} y={34}>
                    <div className="gp-col" style={{ gap: 0 }}>
                        <Text text="Watching:" color="dim" shadow />
                        {watchers.slice(0, 3).map((w) => (
                            <Text
                                key={w.id}
                                text={w.name}
                                color={w.id === myId ? 'gold' : 'white'}
                                shadow
                                maxWidth={100}
                            />
                        ))}
                        {watchers.length > 3 && <Text text={`and ${watchers.length - 3} more`} color="dim" shadow />}
                    </div>
                </At>
            )}

            {BUNNY_NAMES.map((bunny, slot) => {
                const member = room.members.find((m) => m.slot === slot);
                // Players' bunnies hop around; the name tags are drawn on the scene (see roomBunnies)
                if (member)
                    return (
                        <span key={bunny} className="sr-only">
                            {`${bunny}: ${member.name}${member.host ? ' (host)' : ''}${member.id === myId ? ' (you)' : ''}`}
                        </span>
                    );
                const spot = BUNNY_SPOTS[slot];
                const canTake = canPick;
                const hot = hotSlot === slot && canTake;
                const name = `Play as ${bunny}`;
                const width = Math.min(74, text_width(name)) + 6;
                return (
                    <div key={bunny}>
                        {hot && (
                            // Opaque, as it covers the free bunny's tag on the scene
                            <At x={spot.x + 8 - Math.ceil(width / 2)} y={spot.y - 19}>
                                <span className="gp-tag" style={{ width: gp(width), backgroundColor: '#000' }}>
                                    <Text text={name} color="green" maxWidth={74} />
                                </span>
                            </At>
                        )}
                        <button
                            type="button"
                            className="gp-slot"
                            style={{ left: gp(spot.x - 2), top: gp(spot.y - 2), width: gp(20), height: gp(20) }}
                            disabled={!canTake}
                            aria-label={`Play as ${bunny}`}
                            title={canTake ? `Play as ${bunny}` : undefined}
                            onClick={() => {
                                net.send({ t: 'slot', slot });
                                // The button goes away once the bunny is yours, without a mouseleave or blur
                                setHotSlot(null);
                            }}
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
                        <Button
                            label="START MATCH"
                            primary
                            disabled={!enough}
                            title={enough ? undefined : 'A match needs at least two bunnies.'}
                            onClick={() => net.send({ t: 'start' })}
                            width={118}
                        />
                    )}
                </Panel>
            </At>

            <At x={SCENE_X + 6} y={216}>
                <div className="gp-col" style={{ gap: 0 }}>
                    <Text text={status} color="white" />
                    <Text text={hint} color="dim" />
                </div>
            </At>
            <At x={SCENE_X + 6} y={250}>
                <div className="gp-row" style={{ gap: gp(3) }}>
                    <Button label="INVITE" onClick={invite} />
                    <Button label="OPTIONS" onClick={onOptions} />
                    {lastResult && <Button label="LAST MATCH" onClick={() => setShowResults(true)} />}
                    {canPick && me?.slot !== null && (
                        <Button
                            label="SIT OUT"
                            title="Watch the next match instead of playing"
                            onClick={() => net.send({ t: 'slot', slot: null })}
                        />
                    )}
                    {canPick && me?.slot === null && freeSlot >= 0 && (
                        <Button label="PLAY" onClick={() => net.send({ t: 'slot', slot: freeSlot })} />
                    )}
                    {!canPick && me && !me.inMatch && (
                        <Button label="WATCH" primary onClick={() => net.send({ t: 'watch' })} />
                    )}
                    {!canPick && isHost && me && !me.inMatch && (
                        <Button label="END MATCH" onClick={() => net.send({ t: 'quit' })} />
                    )}
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

/** A room's bunnies on the scene with their name tags: free slots as ghosts, players' bunnies by name. */
function roomBunnies(room: RoomDetail, myId: string | undefined): SceneBunny[] {
    const canPick = room.status === 'lobby';
    return BUNNY_NAMES.map((bunny, slot) => {
        const member = room.members.find((m) => m.slot === slot);
        if (!member) return { slot, ghost: true, tag: { text: bunny, color: 'dim' } };
        const mine = member.id === myId;
        const color: TextColor = mine ? 'gold' : member.inMatch || canPick ? 'white' : 'dim';
        return { slot, tag: { text: member.name, color, crown: member.host, mine } };
    });
}

/**
 * Your bunny in the room (`slot`, null without one) hops around with your controls, like in the local
 * game's menu; it stands still while a dialog is open or a text field has the focus.
 */
function useOwnHop(slot: number | null, device: GameInputDevice): SceneOwnBunny | undefined {
    const deviceRef = useRef(device);
    deviceRef.current = device;
    const tracker = useRef<InputTracker | null>(null);
    const active = slot !== null;

    useEffect(() => {
        if (!active) return;
        const tracking = track_input();
        tracker.current = tracking;
        return () => {
            tracking.dispose();
            tracker.current = null;
        };
    }, [active]);

    return useMemo(() => {
        if (slot === null) return undefined;
        return {
            slot,
            input: () => {
                const held = tracker.current;
                if (!held || document.querySelector('[aria-modal="true"]') || is_text_field(document.activeElement))
                    return 0;
                // Some browsers only offer gamepads to secure (HTTPS) pages
                const gamepads = navigator.getGamepads?.() ?? [];
                return read_input_mask(deviceRef.current, held.keys, held.mouse_buttons, gamepads);
            },
            on_state: () => {
                // TODO(net): send hop
            },
        };
    }, [slot]);
}

export default function Online() {
    usePageMeta(onlinePageMeta);
    const state = useNet();
    const [settings, updateSettings, loaded] = useOnlineSettings();
    const gamepads = useGamepads();
    const [assets, setAssets] = useState<GameAssets | null>(game_assets());
    const [assetsFailed, setAssetsFailed] = useState(false);
    const [dialog, setDialog] = useState<'name' | 'create' | 'options' | 'about' | null>(null);
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

    // Remember the name the server accepted (a rename to a taken name is refused, and names are cleaned up)
    useEffect(() => {
        const accepted = state.me?.name;
        if (loaded && accepted && accepted !== settings.name) updateSettings({ name: accepted });
    }, [state.me?.name]);

    useEffect(() => {
        if (state.match_over && state.match && state.room) seen_results.set(state.room.id, state.match.id);
    }, [state.match_over, state.match?.id]);

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

    // Only players have a bunny to move (a slot 0-3); nobody hops while a match is shown
    const mySlot = state.room?.members.find((m) => m.id === state.me?.id)?.slot;
    const hopSlot = !state.match && typeof mySlot === 'number' && mySlot >= 0 && mySlot < BUNNY_NAMES.length;
    const ownHop = useOwnHop(hopSlot ? mySlot! : null, deviceFor(settings, gamepads));

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
                spectating={state.spectating}
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
        ? roomBunnies(room, state.me?.id)
        : LOBBY_SPOTS.map((spot, slot) => ({ slot, ...spot }));

    return (
        <Stage>
            <Scene assets={assets} bunnies={bunnies} own={room ? ownHop : undefined} />

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
            {loaded && settings.name && state.name_taken && (
                <NameDialog
                    initial={state.name_taken}
                    title="NAME TAKEN"
                    note={`Somebody online is already called ${state.name_taken}. Please pick another name.`}
                    onSubmit={(name) => {
                        updateSettings({ name });
                        net.connect(name);
                    }}
                />
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
                        <TextLink label="Options" onClick={() => setDialog('options')} />
                        <TextLink label="About" onClick={() => setDialog('about')} />
                        <TextLink href={SOURCE_URL} label="Source" />
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
            {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
            {lockedRoom && !room && <PasswordDialog room={lockedRoom} onClose={() => setLockedRoom(null)} />}

            <ToastView toast={toast} onDismiss={() => net.clear_error()} />
        </Stage>
    );
}
