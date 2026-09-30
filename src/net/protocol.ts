/**
 * Wire protocol shared by the browser client and the Node server.
 *
 * Netcode model: the server owns the clock and the input timeline. Every 60 Hz tick it confirms one frame
 * of inputs (one packed word for all four bunnies) and broadcasts it. Clients run ahead of the server,
 * predict remote inputs, and roll back to the last confirmed state when a confirmation arrives. The
 * simulation (src/sim) is deterministic, so every peer ends up with the same state; the server runs it
 * too and resyncs any client whose state hash differs.
 */
import type { SimState } from '../sim/sim';

export const PROTOCOL_VERSION = 3;

/** Inactive connections outside rooms are released until the user chooses to reconnect. */
export const LOBBY_IDLE_MS = 5 * 60 * 1000;
export const IDLE_CLOSE_CODE = 4001;

export const FRAME_MS = 1000 / 60;
/** Bunnies per match. */
export const MAX_ROOM_PLAYERS = 4;
/** Players and spectators per room. */
export const MAX_ROOM_MEMBERS = 16;
/** A match needs at least this many players (spectators do not count). */
export const MIN_MATCH_PLAYERS = 2;
/** Inputs are ignored for the first frames of a match while the countdown runs. */
export const COUNTDOWN_FRAMES = 180;
export const NAME_MAX_LENGTH = 16;
export const ROOM_NAME_MAX_LENGTH = 24;
export const PASSWORD_MAX_LENGTH = 64;
/** Confirmed states whose frame is a multiple of this are hashed and compared with the server. */
export const HASH_INTERVAL = 60;
export const END_SCORE_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_END_SCORE = 10;
export const DEFAULT_LEVEL = 'jumpbump.dat';

export const BUNNY_NAMES = ['Dott', 'Jiffy', 'Fizz', 'Mijji'] as const;

export type RoomStatus = 'lobby' | 'loading' | 'playing';

export type RoomSummary = {
    id: string;
    name: string;
    locked: boolean;
    /** Members with a bunny. */
    players: number;
    /** Everybody in the room, spectators included. */
    members: number;
    status: RoomStatus;
    level: string;
};

export type RoomMember = {
    id: string;
    name: string;
    /** The member's bunny, or null for a spectator. */
    slot: number | null;
    host: boolean;
    /** Taking part in the running match (members who joined mid-match watch or wait for the next one). */
    inMatch: boolean;
    /** Watching the running match. */
    watching: boolean;
};

export type MatchResult = {
    /** The id of the match this is the result of. */
    match: string;
    reason: MatchEndReason;
    endScore: number;
    level: string;
    /** Per bunny slot: the player's name, or null if the slot was empty. */
    names: (string | null)[];
    bumps: number[];
    /** bumped[killer][victim] */
    bumped: number[][];
};

export type RoomDetail = {
    id: string;
    name: string;
    locked: boolean;
    hostId: string;
    level: string;
    endScore: number;
    status: RoomStatus;
    members: RoomMember[];
    lastResult: MatchResult | null;
};

export type MatchSlot = { id: string; name: string } | null;

export type MatchInfo = {
    id: string;
    level: string;
    endScore: number;
    slots: MatchSlot[];
};

export type MatchEndReason = 'score' | 'host' | 'empty';

/** A bunny hopping about in the room: position in menu screen pixels and its sprite image (0-17). */
export type HopSample = [x: number, y: number, image: number];

/** A bunny leaves the match: its player is disabled right before frame `f` is simulated. */
export type LeaveEvent = [f: number, slot: number];

export type ClientMessage =
    /** Actual UI interaction outside a room; automatic pings do not keep an idle client connected. */
    | { t: 'activity' }
    /** `token` identifies the browser tab, so a reconnect can take over its own name. */
    | { t: 'hello'; v: number; name: string; token: string }
    | { t: 'name'; name: string }
    | { t: 'create'; name: string; password: string }
    | { t: 'join'; room: string; password: string }
    | { t: 'leave' }
    /** Take a free bunny, or null to sit out and watch. */
    | { t: 'slot'; slot: number | null }
    | { t: 'level'; level: string }
    | { t: 'endScore'; endScore: number }
    | { t: 'start' }
    | { t: 'ready'; match: string }
    /** Local input mask for frame `f`; sent on every change plus a periodic heartbeat. */
    | { t: 'i'; f: number; m: number }
    /** Hash of the client's confirmed state at frame `f`. */
    | { t: 'h'; f: number; h: number }
    /** Ask for a full snapshot, e.g. after missing confirmations. */
    | { t: 'resync' }
    /** Host: end the match for everyone. Players: quit the match. Spectators: stop watching. */
    | { t: 'quit' }
    /** Watch the running match; stop watching it. */
    | { t: 'watch' }
    | { t: 'unwatch' }
    /** Where your bunny hops in the room. */
    | { t: 'hop'; s: HopSample }
    | { t: 'ping'; c: number };

export type ServerMessage =
    | { t: 'idle' }
    | { t: 'welcome'; id: string; name: string; online: number }
    /** Somebody who is online uses that name already; choose another one. */
    | { t: 'nameTaken'; name: string }
    | { t: 'error'; message: string }
    | { t: 'online'; online: number }
    | { t: 'rooms'; rooms: RoomSummary[] }
    | { t: 'room'; room: RoomDetail | null }
    | { t: 'load'; match: MatchInfo }
    | { t: 'go'; match: string; state: SimState }
    /** Watch a match as a spectator, starting from `state`; confirmations follow as for the players. */
    | { t: 'watch'; match: MatchInfo; state: SimState }
    | { t: 'hop'; id: string; s: HopSample }
    /** Confirmed packed inputs for frames f, f+1, ...; `e` lists bunnies leaving in that range. */
    | { t: 'c'; f: number; m: number[]; e?: LeaveEvent[] }
    /** How many frames early (positive) or late (negative) this client's inputs arrive. */
    | { t: 'lead'; l: number }
    | { t: 'snap'; state: SimState }
    | { t: 'over'; match: string; reason: MatchEndReason; state: SimState; result: MatchResult }
    /** You are no longer part of the running match (for example you did not finish loading in time). */
    | { t: 'dropped'; match: string; message: string }
    | { t: 'pong'; c: number };

/** Trims, collapses whitespace and removes control characters. */
export function clean_text(value: unknown, max_length: number): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max_length);
}
