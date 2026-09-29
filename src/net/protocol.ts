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

export const PROTOCOL_VERSION = 1;

export const FRAME_MS = 1000 / 60;
export const MAX_ROOM_PLAYERS = 4;
export const NAME_MAX_LENGTH = 16;
export const ROOM_NAME_MAX_LENGTH = 24;
export const PASSWORD_MAX_LENGTH = 64;
/** Confirmed states whose frame is a multiple of this are hashed and compared with the server. */
export const HASH_INTERVAL = 60;
export const END_SCORE_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_END_SCORE = 100;
export const DEFAULT_LEVEL = 'jumpbump.dat';

export const BUNNY_NAMES = ['Dott', 'Jiffy', 'Fizz', 'Mijji'] as const;

export type RoomStatus = 'lobby' | 'loading' | 'playing';

export type RoomSummary = {
    id: string;
    name: string;
    locked: boolean;
    players: number;
    status: RoomStatus;
    level: string;
};

export type RoomMember = {
    id: string;
    name: string;
    slot: number;
    host: boolean;
    /** Taking part in the running match (members who joined mid-match wait for the next one). */
    inMatch: boolean;
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

/** A bunny leaves the match: its player is disabled right before frame `f` is simulated. */
export type LeaveEvent = [f: number, slot: number];

export type ClientMessage =
    | { t: 'hello'; v: number; name: string }
    | { t: 'name'; name: string }
    | { t: 'create'; name: string; password: string }
    | { t: 'join'; room: string; password: string }
    | { t: 'leave' }
    | { t: 'slot'; slot: number }
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
    /** Host: end the match for everyone. Others: quit the match. */
    | { t: 'quit' }
    | { t: 'ping'; c: number };

export type ServerMessage =
    | { t: 'welcome'; id: string; name: string; online: number }
    | { t: 'error'; message: string }
    | { t: 'online'; online: number }
    | { t: 'rooms'; rooms: RoomSummary[] }
    | { t: 'room'; room: RoomDetail | null }
    | { t: 'load'; match: MatchInfo }
    | { t: 'go'; match: string; state: SimState }
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
