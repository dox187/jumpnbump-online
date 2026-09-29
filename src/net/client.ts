/**
 * Browser connection to the multiplayer server: keeps the lobby state, reconnects after network
 * hiccups and hands match traffic to whichever game is currently running.
 */
import { ClientMessage, MatchInfo, PROTOCOL_VERSION, RoomDetail, RoomSummary, ServerMessage } from './protocol';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline';

export type NetState = {
    status: NetStatus;
    me: { id: string; name: string } | null;
    online: number;
    rooms: RoomSummary[];
    room: RoomDetail | null;
    /** The latest error from the server, with a counter so the UI can tell repeated errors apart. */
    error: { message: string; seq: number; at: number } | null;
    rtt: number;
    /** The match we take part in, from 'load' until we leave its score screen. */
    match: MatchInfo | null;
    match_over: boolean;
};

type MatchHandler = (message: ServerMessage) => void;

const PING_INTERVAL_MS = 2000;
const MAX_RETRY_MS = 10000;

class NetClient {
    state: NetState = {
        status: 'idle',
        me: null,
        online: 0,
        rooms: [],
        room: null,
        error: null,
        rtt: 100,
        match: null,
        match_over: false,
    };

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

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    connect(name: string) {
        this.name = name;
        this.wanted = true;
        if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
            this.send({ t: 'name', name });
            return;
        }
        this.open();
    }

    send(message: ClientMessage) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    }

    /** The running game registers here; messages that arrived before it did are replayed. */
    set_match_handler(handler: MatchHandler | null) {
        this.match_handler = handler;
        if (handler) for (const message of this.match_buffer.splice(0)) handler(message);
    }

    /** Leave the current match view (after the score screen, or after quitting). */
    leave_match() {
        this.match_buffer = [];
        this.update({ match: null, match_over: false });
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
        this.update({ status: this.state.status === 'offline' ? 'offline' : 'connecting' });

        ws.onopen = () => {
            this.retry_ms = 1000;
            ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: this.name }));
            this.ping_timer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_INTERVAL_MS);
        };
        ws.onmessage = (event) => {
            let message: ServerMessage;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            this.handle(message);
        };
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this.ws = null;
            if (this.ping_timer) clearInterval(this.ping_timer);
            this.ping_timer = null;
            const lost_room = this.state.room !== null || this.state.match !== null;
            this.match_buffer = [];
            this.update({ status: this.wanted ? 'offline' : 'idle', room: null, match: null, match_over: false });
            if (lost_room) this.error('The connection to the server was lost.');
            if (this.wanted) {
                this.retry_timer = setTimeout(() => this.open(), this.retry_ms);
                this.retry_ms = Math.min(MAX_RETRY_MS, this.retry_ms * 2);
            }
        };
    }

    private handle(message: ServerMessage) {
        switch (message.t) {
            case 'welcome':
                this.update({ status: 'online', me: { id: message.id, name: message.name }, online: message.online });
                return;
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
                this.update({ rtt: this.state.rtt * 0.7 + (performance.now() - message.c) * 0.3 });
                return;
            case 'load':
                this.match_buffer = [];
                this.update({ match: message.match, match_over: false });
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
