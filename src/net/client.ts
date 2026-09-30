/**
 * Browser connection to the multiplayer server: keeps the lobby state, reconnects after network
 * hiccups and hands match traffic to whichever game is currently running.
 */
import {
    ClientMessage,
    HopSample,
    IDLE_CLOSE_CODE,
    MatchInfo,
    PROTOCOL_VERSION,
    RoomDetail,
    RoomSummary,
    ServerMessage,
} from './protocol';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'inactive';

export type NetState = {
    status: NetStatus;
    me: { id: string; name: string } | null;
    online: number;
    rooms: RoomSummary[];
    room: RoomDetail | null;
    /** The latest error from the server, with a counter so the UI can tell repeated errors apart. */
    error: { message: string; seq: number; at: number } | null;
    rtt: number;
    /** Latest measured round trip, for display; null until the first reply or while disconnected. */
    ping: number | null;
    /** The match we take part in or watch, from 'load' / 'watch' until we leave its score screen. */
    match: MatchInfo | null;
    match_over: boolean;
    /** We only watch `match`. */
    spectating: boolean;
    /** The server refused our name because somebody online uses it. */
    name_taken: string | null;
};

export type HopTrack = { sample: HopSample; at: number }[];

type MatchHandler = (message: ServerMessage) => void;

const PING_INTERVAL_MS = 2000;
const MAX_RETRY_MS = 10000;
const HOP_SAMPLES_KEPT = 8;
const ACTIVITY_INTERVAL_MS = 10000;

/** Identifies this browser tab across reconnects (and reloads), so the server lets it keep its name. */
function tab_token() {
    try {
        let token = sessionStorage.getItem('net-token');
        if (!token) {
            token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(
                ''
            );
            sessionStorage.setItem('net-token', token);
        }
        return token;
    } catch {
        return '';
    }
}

class NetClient {
    state: NetState = {
        status: 'idle',
        me: null,
        online: 0,
        rooms: [],
        room: null,
        error: null,
        rtt: 100,
        ping: null,
        match: null,
        match_over: false,
        spectating: false,
        name_taken: null,
    };

    /** Recent hop samples of the other members' bunnies in the room, by member id; not part of the state. */
    readonly hops = new Map<string, HopTrack>();

    private listeners = new Set<() => void>();
    private ws: WebSocket | null = null;
    private name = '';
    private wanted = false;
    private retry_ms = 1000;
    private retry_timer: ReturnType<typeof setTimeout> | null = null;
    private ping_timer: ReturnType<typeof setInterval> | null = null;
    private match_handler: MatchHandler | null = null;
    private match_buffer: ServerMessage[] = [];
    private error_seq = 0;
    private had_room = false;
    private token = '';
    private activity_sent = -Infinity;
    private activity_timer: ReturnType<typeof setTimeout> | null = null;

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    connect(name: string) {
        this.name = name;
        this.wanted = true;
        if (this.state.status === 'inactive') this.update({ status: 'connecting', error: null });
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Still waiting for a free name, or renaming once we are in
            if (this.state.status === 'online') this.send({ t: 'name', name });
            else this.send(this.hello());
            return;
        }
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
        this.open();
    }

    private hello(): ClientMessage {
        if (!this.token) this.token = tab_token();
        return { t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.token };
    }

    send(message: ClientMessage) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    }

    /** Called by real browsing input, never by animation frames, room-list updates or heartbeat replies. */
    activity() {
        if (!this.wanted || this.state.room || this.ws?.readyState !== WebSocket.OPEN) return;
        const remaining = ACTIVITY_INTERVAL_MS - (performance.now() - this.activity_sent);
        if (remaining > 0) {
            // Send the last interaction in a burst too, so the timeout is not measured from its first event.
            if (!this.activity_timer) {
                this.activity_timer = setTimeout(() => {
                    this.activity_timer = null;
                    this.activity();
                }, remaining);
            }
            return;
        }
        this.activity_sent = performance.now();
        this.send({ t: 'activity' });
    }

    private stop_timers() {
        if (this.retry_timer) clearTimeout(this.retry_timer);
        if (this.ping_timer) clearInterval(this.ping_timer);
        if (this.activity_timer) clearTimeout(this.activity_timer);
        this.retry_timer = this.ping_timer = this.activity_timer = null;
    }

    /** The running game registers here; messages that arrived before it did are replayed. */
    set_match_handler(handler: MatchHandler | null) {
        this.match_handler = handler;
        if (handler) for (const message of this.match_buffer.splice(0)) handler(message);
    }

    /** Leave the current match view (after the score screen, or after quitting). */
    leave_match() {
        this.match_buffer = [];
        this.update({ match: null, match_over: false, spectating: false });
    }

    clear_error() {
        if (this.state.error) this.update({ error: null });
    }

    private open() {
        if (this.retry_timer) {
            clearTimeout(this.retry_timer);
            this.retry_timer = null;
        }
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${location.host}/ws`);
        this.ws = ws;
        this.activity_sent = -Infinity;
        this.update({ status: this.state.status === 'offline' ? 'offline' : 'connecting', ping: null });

        ws.onopen = () => {
            if (this.ws !== ws) return;
            ws.send(JSON.stringify(this.hello()));
            this.send({ t: 'ping', c: performance.now() });
            this.ping_timer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_INTERVAL_MS);
        };
        ws.onmessage = (event) => {
            if (this.ws !== ws) return;
            let message: ServerMessage;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            this.handle(message);
        };
        ws.onclose = (event) => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.stop_timers();
            const inactive = event.code === IDLE_CLOSE_CODE || this.state.status === 'inactive';
            if (inactive) this.wanted = false;
            const lost_room = this.state.room !== null || this.state.match !== null;
            this.match_buffer = [];
            this.hops.clear();
            this.update({
                status: inactive ? 'inactive' : this.wanted ? 'offline' : 'idle',
                ping: null,
                room: null,
                match: null,
                match_over: false,
                spectating: false,
            });
            if (lost_room) this.error('The connection to the server was lost.');
            if (this.wanted) {
                this.retry_timer = setTimeout(() => this.open(), this.retry_ms);
                this.retry_ms = Math.min(MAX_RETRY_MS, this.retry_ms * 2);
            }
        };
    }

    private handle(message: ServerMessage) {
        switch (message.t) {
            case 'idle':
                this.wanted = false;
                this.stop_timers();
                this.update({ status: 'inactive', ping: null });
                return;
            case 'welcome':
                this.retry_ms = 1000;
                this.update({
                    status: 'online',
                    me: { id: message.id, name: message.name },
                    online: message.online,
                    name_taken: null,
                });
                return;
            case 'nameTaken':
                this.update({ name_taken: message.name });
                return;
            case 'hop': {
                let track = this.hops.get(message.id);
                if (!track) this.hops.set(message.id, (track = []));
                track.push({ sample: message.s, at: performance.now() });
                if (track.length > HOP_SAMPLES_KEPT) track.shift();
                return;
            }
            case 'online':
                this.update({ online: message.online });
                return;
            case 'rooms':
                this.update({ rooms: message.rooms });
                return;
            case 'room': {
                const room = message.room;
                const me = this.state.me;
                const patch: Partial<NetState> = { room };
                // A match we were loading or playing ended without an 'over' for us (we quit, or it was cancelled)
                const in_match = room?.members.find((m) => m.id === me?.id)?.inMatch ?? false;
                if (this.state.match && !this.state.match_over && room && room.status === 'lobby' && !in_match) {
                    patch.match = null;
                    this.match_buffer = [];
                }
                if (!room) patch.match = null;
                // Forget the hops of members who left or switched bunnies; their bunny starts at its spot again
                for (const id of this.hops.keys()) {
                    const now_slot = room?.members.find((m) => m.id === id)?.slot ?? null;
                    const old_slot = this.state.room?.members.find((m) => m.id === id)?.slot ?? null;
                    if (now_slot === null || now_slot !== old_slot) this.hops.delete(id);
                }
                if (room && !this.had_room) history.replaceState(null, '', `/?room=${room.id}`);
                if (!room && this.had_room) history.replaceState(null, '', '/');
                this.had_room = room !== null;
                this.update(patch);
                return;
            }
            case 'error':
                this.error(message.message);
                return;
            case 'pong':
                if (!Number.isFinite(message.c)) return;
                const elapsed = Math.max(0, performance.now() - message.c);
                this.update({ rtt: this.state.rtt * 0.7 + elapsed * 0.3, ping: Math.round(elapsed) });
                return;
            case 'load':
                this.match_handler = null;
                this.match_buffer = [];
                this.update({ match: message.match, match_over: false, spectating: false });
                return;
            case 'watch':
                this.match_handler = null;
                this.match_buffer = [];
                this.update({ match: message.match, match_over: false, spectating: true });
                this.forward(message);
                return;
            case 'dropped':
                if (this.state.match?.id !== message.match) return;
                this.error(message.message);
                this.leave_match();
                return;
            case 'over':
                if (this.state.match?.id !== message.match) return;
                this.update({ match_over: true });
                this.forward(message);
                return;
            case 'go':
            case 'c':
            case 'lead':
            case 'snap':
                if (this.state.match) this.forward(message);
                return;
        }
    }

    private forward(message: ServerMessage) {
        if (this.match_handler) this.match_handler(message);
        else this.match_buffer.push(message);
    }

    private error(message: string) {
        this.update({ error: { message, seq: ++this.error_seq, at: Date.now() } });
    }

    private update(patch: Partial<NetState>) {
        this.state = { ...this.state, ...patch };
        for (const listener of this.listeners) listener();
    }
}

export const net = new NetClient();
