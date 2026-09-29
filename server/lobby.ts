import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import type { WebSocket } from 'ws';
import {
    ClientMessage,
    DEFAULT_END_SCORE,
    DEFAULT_LEVEL,
    END_SCORE_OPTIONS,
    MAX_ROOM_MEMBERS,
    MAX_ROOM_PLAYERS,
    MIN_MATCH_PLAYERS,
    MatchEndReason,
    MatchResult,
    NAME_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PROTOCOL_VERSION,
    ROOM_NAME_MAX_LENGTH,
    RoomDetail,
    RoomStatus,
    RoomSummary,
    ServerMessage,
    clean_text,
} from '../src/net/protocol';
import { level_info, level_name, load_level_map } from './levels';
import { Match, Participant } from './match';

const scrypt_async = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const MAX_ROOMS = 200;
const MAX_CLIENTS_PER_IP = 16;
const FAILED_JOIN_WINDOW_MS = 60000;
const MAX_FAILED_JOINS = 5;
const MESSAGE_RATE_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 400;
const TICK_INTERVAL_MS = 4;
const LIST_BROADCAST_DELAY_MS = 100;
const TOKEN_MAX_LENGTH = 64;
/** Hop samples from one client beyond this rate are dropped. */
const MAX_HOPS_PER_SECOND = 30;

type Client = {
    id: string;
    ws: WebSocket;
    ip: string;
    name: string;
    /** Chosen by the browser tab; a reconnect with the same token may take over the name. */
    token: string;
    greeted: boolean;
    hop_window_start: number;
    hop_count: number;
    room: Room | null;
    message_window_start: number;
    message_count: number;
    busy: boolean;
};

type Member = {
    client: Client;
    /** The member's bunny, or null for a spectator. */
    slot: number | null;
    joined: number;
};

type Room = {
    id: string;
    name: string;
    password: { salt: Buffer; hash: Buffer } | null;
    host_id: string;
    members: Map<string, Member>;
    level: string;
    end_score: number;
    status: RoomStatus;
    match: Match | null;
    last_result: MatchResult | null;
};

function random_id(bytes: number) {
    return randomBytes(bytes).toString('base64url');
}

async function hash_password(password: string) {
    const salt = randomBytes(16);
    return { salt, hash: await scrypt_async(password, salt, 32) };
}

async function verify_password(password: string, stored: { salt: Buffer; hash: Buffer }) {
    const hash = await scrypt_async(password, stored.salt, 32);
    return timingSafeEqual(hash, stored.hash);
}

function is_int(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Names are unique among the players online, ignoring case. */
function name_key(name: string) {
    return name.normalize('NFC').toLocaleLowerCase();
}

export class Lobby {
    private clients = new Map<string, Client>();
    private rooms = new Map<string, Room>();
    private failed_joins = new Map<string, number[]>();
    private list_timer: ReturnType<typeof setTimeout> | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;
    private readonly levels_dir: string;

    constructor(levels_dir: string) {
        this.levels_dir = levels_dir;
        setInterval(() => {
            const now = performance.now();
            for (const [ip, failures] of this.failed_joins) {
                if (failures.every((t) => now - t >= FAILED_JOIN_WINDOW_MS)) this.failed_joins.delete(ip);
            }
        }, FAILED_JOIN_WINDOW_MS).unref();
    }

    connect(ws: WebSocket, ip: string) {
        let from_ip = 0;
        for (const client of this.clients.values()) if (client.ip === ip) from_ip++;
        if (from_ip >= MAX_CLIENTS_PER_IP) {
            ws.close(1008, 'Too many connections');
            return;
        }

        const client: Client = {
            id: random_id(9),
            ws,
            ip,
            name: '',
            token: '',
            greeted: false,
            hop_window_start: 0,
            hop_count: 0,
            room: null,
            message_window_start: performance.now(),
            message_count: 0,
            busy: false,
        };
        this.clients.set(client.id, client);

        ws.on('message', (data, is_binary) => {
            if (is_binary) return;
            const now = performance.now();
            if (now - client.message_window_start > MESSAGE_RATE_WINDOW_MS) {
                client.message_window_start = now;
                client.message_count = 0;
            }
            if (++client.message_count > MAX_MESSAGES_PER_WINDOW) {
                ws.close(1008, 'Too many messages');
                return;
            }
            let message: ClientMessage;
            try {
                message = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (!message || typeof message !== 'object' || typeof message.t !== 'string') return;
            this.handle(client, message, now).catch((error) => {
                console.error('message handler failed', error);
                this.send(client, { t: 'error', message: 'Something went wrong on the server.' });
            });
        });

        ws.on('close', () => {
            this.leave_room(client);
            this.clients.delete(client.id);
            if (client.greeted) this.schedule_list_broadcast();
        });
    }

    private async handle(client: Client, message: ClientMessage, now: number) {
        if (!client.greeted) {
            if (message.t !== 'hello') return;
            if (message.v !== PROTOCOL_VERSION) {
                this.send(client, { t: 'error', message: 'Your game is out of date. Please reload the page.' });
                client.ws.close(1008, 'Protocol version mismatch');
                return;
            }
            const name = clean_text(message.name, NAME_MAX_LENGTH) || 'Bunny';
            const token = typeof message.token === 'string' ? message.token.slice(0, TOKEN_MAX_LENGTH) : '';
            const holder = this.name_holder(name, client);
            if (holder && token && holder.token === token) {
                // The same tab reconnected before the server noticed that its old connection was gone
                this.drop_client(holder, 'Replaced by a new connection');
            } else if (holder) {
                this.send(client, { t: 'nameTaken', name });
                return;
            }
            client.name = name;
            client.token = token;
            client.greeted = true;
            this.send(client, { t: 'welcome', id: client.id, name: client.name, online: this.online_count() });
            this.send(client, { t: 'rooms', rooms: this.room_list() });
            this.schedule_list_broadcast();
            return;
        }

        const room = client.room;
        const is_host = room !== null && room.host_id === client.id;

        switch (message.t) {
            case 'ping':
                if (typeof message.c === 'number') this.send(client, { t: 'pong', c: message.c });
                return;

            case 'i':
                if (room?.match && is_int(message.f, 0, 2 ** 31) && is_int(message.m, 0, 7)) {
                    room.match.handle_input(client.id, message.f, message.m, now);
                }
                return;

            case 'h':
                if (room?.match && is_int(message.f, 0, 2 ** 31) && is_int(message.h, 0, 2 ** 32 - 1)) {
                    room.match.handle_hash(client.id, message.f, message.h, now);
                }
                return;

            case 'resync':
                room?.match?.handle_resync(client.id, now);
                return;

            case 'ready':
                if (room?.match && room.match.id === message.match) room.match.mark_ready(client.id, now);
                return;

            case 'name': {
                const name = clean_text(message.name, NAME_MAX_LENGTH);
                if (!name) return;
                if (this.name_holder(name, client)) {
                    this.send(client, { t: 'error', message: `Somebody online is already called ${name}.` });
                    this.send(client, { t: 'welcome', id: client.id, name: client.name, online: this.online_count() });
                    return;
                }
                client.name = name;
                this.send(client, { t: 'welcome', id: client.id, name: client.name, online: this.online_count() });
                if (room) this.broadcast_room(room);
                return;
            }

            case 'create':
                return this.create_room(client, message.name, message.password);

            case 'join':
                return this.join_room(client, message.room, message.password);

            case 'leave':
                this.leave_room(client);
                this.send(client, { t: 'room', room: null });
                this.send(client, { t: 'rooms', rooms: this.room_list() });
                return;

            case 'slot': {
                if (!room || room.status !== 'lobby') return;
                const member = room.members.get(client.id)!;
                if (message.slot === null) {
                    member.slot = null;
                } else {
                    if (!is_int(message.slot, 0, MAX_ROOM_PLAYERS - 1)) return;
                    if ([...room.members.values()].some((m) => m.slot === message.slot)) return;
                    member.slot = message.slot;
                }
                this.broadcast_room(room);
                this.schedule_list_broadcast();
                return;
            }

            case 'watch':
                if (room?.match) {
                    room.match.add_spectator(client.id, (m) => this.send(client, m));
                    this.broadcast_room(room);
                }
                return;

            case 'unwatch':
                if (room?.match?.is_watching(client.id)) {
                    room.match.remove_spectator(client.id);
                    this.broadcast_room(room);
                }
                return;

            case 'hop': {
                const member = room?.members.get(client.id);
                if (!room || !member || member.slot === null || room.match?.has_participant(client.id)) return;
                const sample = message.s;
                if (!Array.isArray(sample) || sample.length !== 3) return;
                if (!is_int(sample[0], -32, 432) || !is_int(sample[1], -512, 288) || !is_int(sample[2], 0, 17)) {
                    return;
                }
                if (now - client.hop_window_start > 1000) {
                    client.hop_window_start = now;
                    client.hop_count = 0;
                }
                if (++client.hop_count > MAX_HOPS_PER_SECOND) return;
                const hop: ServerMessage = { t: 'hop', id: client.id, s: [sample[0], sample[1], sample[2]] };
                for (const other of room.members.values()) if (other.client !== client) this.send(other.client, hop);
                return;
            }

            case 'level': {
                if (!room || !is_host || room.status !== 'lobby' || typeof message.level !== 'string') return;
                if (!level_info(message.level)) return;
                try {
                    await load_level_map(this.levels_dir, message.level);
                } catch (error) {
                    console.error(`level ${message.level} failed to load`, error);
                    this.send(client, { t: 'error', message: 'That level could not be loaded.' });
                    return;
                }
                if (room.status !== 'lobby' || client.room !== room || room.host_id !== client.id) return;
                room.level = message.level;
                this.broadcast_room(room);
                this.schedule_list_broadcast();
                return;
            }

            case 'endScore':
                if (!room || !is_host || room.status !== 'lobby') return;
                if (!(END_SCORE_OPTIONS as readonly number[]).includes(message.endScore)) return;
                room.end_score = message.endScore;
                this.broadcast_room(room);
                return;

            case 'start':
                if (room && is_host && room.status === 'lobby') await this.start_match(room);
                return;

            case 'quit':
                if (!room?.match) return;
                if (is_host) room.match.end('host');
                else {
                    room.match.remove(client.id, now);
                    room.match?.remove_spectator(client.id);
                    this.broadcast_room(room);
                }
                return;
        }
    }

    private async create_room(client: Client, raw_name: unknown, raw_password: unknown) {
        if (client.busy) return;
        if (this.rooms.size >= MAX_ROOMS) {
            this.send(client, { t: 'error', message: 'The server has too many rooms right now.' });
            return;
        }
        const name = clean_text(raw_name, ROOM_NAME_MAX_LENGTH) || `${client.name}'s room`;
        const password = typeof raw_password === 'string' ? raw_password.slice(0, PASSWORD_MAX_LENGTH) : '';

        client.busy = true;
        let stored = null;
        try {
            if (password) stored = await hash_password(password);
        } finally {
            client.busy = false;
        }
        if (client.ws.readyState !== client.ws.OPEN) return;

        this.leave_room(client);
        const room: Room = {
            id: random_id(6),
            name,
            password: stored,
            host_id: client.id,
            members: new Map(),
            level: DEFAULT_LEVEL,
            end_score: DEFAULT_END_SCORE,
            status: 'lobby',
            match: null,
            last_result: null,
        };
        room.members.set(client.id, { client, slot: 0, joined: performance.now() });
        this.rooms.set(room.id, room);
        client.room = room;
        this.broadcast_room(room);
        this.schedule_list_broadcast();
    }

    private async join_room(client: Client, room_id: unknown, raw_password: unknown) {
        if (client.busy || typeof room_id !== 'string') return;
        const room = this.rooms.get(room_id);
        if (!room) {
            this.send(client, { t: 'error', message: 'That room does not exist anymore.' });
            return;
        }
        if (client.room === room) return;
        if (room.members.size >= MAX_ROOM_MEMBERS) {
            this.send(client, { t: 'error', message: 'That room is full.' });
            return;
        }

        if (room.password) {
            const now = performance.now();
            const failures = (this.failed_joins.get(client.ip) ?? []).filter((t) => now - t < FAILED_JOIN_WINDOW_MS);
            this.failed_joins.set(client.ip, failures);
            if (failures.length >= MAX_FAILED_JOINS) {
                this.send(client, { t: 'error', message: 'Too many wrong passwords. Try again in a minute.' });
                return;
            }
            const password = typeof raw_password === 'string' ? raw_password.slice(0, PASSWORD_MAX_LENGTH) : '';
            client.busy = true;
            let ok = false;
            try {
                ok = await verify_password(password, room.password);
            } finally {
                client.busy = false;
            }
            if (!ok) {
                failures.push(now);
                this.send(client, { t: 'error', message: 'Wrong password.' });
                return;
            }
            if (failures.length === 0) this.failed_joins.delete(client.ip);
        }

        // The room may have changed while the password was being checked
        if (client.ws.readyState !== client.ws.OPEN || this.rooms.get(room.id) !== room) return;
        if (room.members.size >= MAX_ROOM_MEMBERS) {
            this.send(client, { t: 'error', message: 'That room is full.' });
            return;
        }

        this.leave_room(client);
        // A free bunny while the room waits; otherwise (match running, all four taken) a spectator
        const used = new Set([...room.members.values()].map((m) => m.slot));
        let slot: number | null = null;
        if (room.status === 'lobby') {
            for (let s = 0; s < MAX_ROOM_PLAYERS && slot === null; s++) if (!used.has(s)) slot = s;
        }
        room.members.set(client.id, { client, slot, joined: performance.now() });
        client.room = room;
        room.match?.add_spectator(client.id, (m) => this.send(client, m));
        this.broadcast_room(room);
        this.schedule_list_broadcast();
    }

    private leave_room(client: Client) {
        const room = client.room;
        if (!room) return;
        client.room = null;
        room.members.delete(client.id);
        room.match?.remove(client.id, performance.now());
        room.match?.remove_spectator(client.id);

        if (room.members.size === 0) {
            room.match?.end('empty');
            this.rooms.delete(room.id);
        } else {
            if (room.host_id === client.id) {
                const next = [...room.members.values()].sort((a, b) => a.joined - b.joined)[0];
                room.host_id = next.client.id;
            }
            this.broadcast_room(room);
        }
        this.schedule_list_broadcast();
    }

    private async start_match(room: Room) {
        const players = () => [...room.members.values()].filter((m) => m.slot !== null).length;
        if (players() < MIN_MATCH_PLAYERS) {
            this.broadcast_room_message(room, { t: 'error', message: 'A match needs at least two bunnies.' });
            return;
        }
        let map;
        try {
            map = await load_level_map(this.levels_dir, room.level);
        } catch (error) {
            console.error(`level ${room.level} failed to load`, error);
            this.broadcast_room_message(room, { t: 'error', message: 'The selected level could not be loaded.' });
            return;
        }
        if (room.status !== 'lobby' || this.rooms.get(room.id) !== room || players() < MIN_MATCH_PLAYERS) return;

        const participants: (Participant | null)[] = new Array(MAX_ROOM_PLAYERS).fill(null);
        for (const member of room.members.values()) {
            const client = member.client;
            if (member.slot === null) continue;
            participants[member.slot] = { id: client.id, name: client.name, send: (m) => this.send(client, m) };
        }

        room.status = 'loading';
        const match: Match = new Match({
            level: room.level,
            end_score: room.end_score,
            map,
            participants,
            now: performance.now(),
            on_finish: (reason, result) => this.match_finished(room, match, reason, result),
        });
        room.match = match;
        for (const member of room.members.values()) {
            const client = member.client;
            if (member.slot === null) match.add_spectator(client.id, (m) => this.send(client, m));
        }
        this.broadcast_room(room);
        this.schedule_list_broadcast();
        this.ensure_ticker();
    }

    private match_finished(room: Room, match: Match, reason: MatchEndReason, result: MatchResult | null) {
        if (room.match && room.match !== match) return;
        room.match = null;
        room.status = 'lobby';
        if (result) room.last_result = result;
        console.log(`room ${room.id}: match ${match.id} ended (${reason}) after ${match.frame} frames`);
        if (this.rooms.get(room.id) === room) {
            this.broadcast_room(room);
            this.schedule_list_broadcast();
        }
    }

    private ensure_ticker() {
        if (this.ticker) return;
        this.ticker = setInterval(() => {
            const now = performance.now();
            let active = 0;
            for (const room of this.rooms.values()) {
                if (!room.match) continue;
                active++;
                room.match.tick(now);
                if (room.match?.status === 'playing' && room.status !== 'playing') {
                    room.status = 'playing';
                    this.broadcast_room(room);
                    this.schedule_list_broadcast();
                }
            }
            if (active === 0 && this.ticker) {
                clearInterval(this.ticker);
                this.ticker = null;
            }
        }, TICK_INTERVAL_MS);
    }

    private room_detail(room: Room): RoomDetail {
        const match = room.match;
        return {
            id: room.id,
            name: room.name,
            locked: room.password !== null,
            hostId: room.host_id,
            level: room.level,
            endScore: room.end_score,
            status: room.status,
            members: [...room.members.values()]
                .sort((a, b) => (a.slot ?? MAX_ROOM_PLAYERS) - (b.slot ?? MAX_ROOM_PLAYERS) || a.joined - b.joined)
                .map((m) => ({
                    id: m.client.id,
                    name: m.client.name,
                    slot: m.slot,
                    host: m.client.id === room.host_id,
                    inMatch: match ? match.has_participant(m.client.id) : false,
                    watching: match ? match.is_watching(m.client.id) : false,
                })),
            lastResult: room.last_result,
        };
    }

    private room_list(): RoomSummary[] {
        return [...this.rooms.values()].map((room) => ({
            id: room.id,
            name: room.name,
            locked: room.password !== null,
            players: [...room.members.values()].filter((m) => m.slot !== null).length,
            members: room.members.size,
            status: room.status,
            level: level_name(room.level),
        }));
    }

    private broadcast_room(room: Room) {
        if (room.match?.status === 'playing') room.status = 'playing';
        const detail = this.room_detail(room);
        for (const member of room.members.values()) this.send(member.client, { t: 'room', room: detail });
    }

    private broadcast_room_message(room: Room, message: ServerMessage) {
        for (const member of room.members.values()) this.send(member.client, message);
    }

    private schedule_list_broadcast() {
        if (this.list_timer) return;
        this.list_timer = setTimeout(() => {
            this.list_timer = null;
            const rooms: ServerMessage = { t: 'rooms', rooms: this.room_list() };
            const online: ServerMessage = { t: 'online', online: this.online_count() };
            for (const client of this.clients.values()) {
                if (!client.greeted) continue;
                this.send(client, online);
                if (!client.room) this.send(client, rooms);
            }
        }, LIST_BROADCAST_DELAY_MS);
    }

    /** Another client online that uses this name. */
    private name_holder(name: string, except: Client): Client | null {
        const key = name_key(name);
        for (const other of this.clients.values()) {
            if (other !== except && other.greeted && name_key(other.name) === key) return other;
        }
        return null;
    }

    private drop_client(client: Client, reason: string) {
        this.leave_room(client);
        this.clients.delete(client.id);
        client.ws.close(4000, reason);
    }

    private online_count() {
        let count = 0;
        for (const client of this.clients.values()) if (client.greeted) count++;
        return count;
    }

    private send(client: Client, message: ServerMessage) {
        if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(message));
    }
}
