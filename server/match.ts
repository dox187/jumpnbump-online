import { randomBytes, randomInt } from 'node:crypto';
import { JNB_MAX_PLAYERS } from '../src/constants';
import type { BanMap } from '../src/sim/ban-map';
import { NO_CHEATS, Sim, SimState, clone_state, create_state, hash_state, pack_inputs } from '../src/sim/sim';
import {
    FRAME_MS,
    HASH_INTERVAL,
    LeaveEvent,
    MatchEndReason,
    MatchInfo,
    MatchResult,
    MatchSlot,
    ServerMessage,
} from '../src/net/protocol';

export type Participant = {
    id: string;
    name: string;
    send: (message: ServerMessage) => void;
};

/** How long clients get to download and parse the level. */
const LOAD_TIMEOUT_MS = 20000;
/** A client that sends nothing for this long is treated as idle (e.g. its tab is in the background). */
const INPUT_TIMEOUT_MS = 1000;
/** If the event loop stalls, catch up at most this many frames at once and let the clock slip. */
const MAX_FRAMES_PER_TICK = 12;
const LEAD_REPORT_INTERVAL = 30;
const MAX_QUEUED_INPUTS = 240;
const HASHES_KEPT = 16;
const SNAPSHOT_COOLDOWN_MS = 1000;

type QueuedInput = { f: number; m: number };

export class Match {
    readonly id: string;
    readonly info: MatchInfo;
    status: 'loading' | 'playing' | 'over' = 'loading';

    private participants: (Participant | null)[];
    private ready: boolean[];
    private readonly seed: number;
    private readonly map: BanMap;
    private readonly end_score: number;
    private state: SimState;
    private sim: Sim;
    private start_time = 0;
    private readonly load_deadline: number;
    private queues: QueuedInput[][];
    private masks: number[];
    private last_input_at: number[];
    private min_lead: number[];
    private last_snapshot_at: number[];
    private pending_leaves: number[] = [];
    private hashes = new Map<number, number>();
    private on_finish: (reason: MatchEndReason, result: MatchResult | null) => void;

    constructor(options: {
        level: string;
        end_score: number;
        map: BanMap;
        participants: (Participant | null)[];
        now: number;
        on_finish: (reason: MatchEndReason, result: MatchResult | null) => void;
    }) {
        this.id = randomBytes(6).toString('hex');
        this.map = options.map;
        this.end_score = options.end_score;
        this.participants = options.participants.slice(0, JNB_MAX_PLAYERS);
        while (this.participants.length < JNB_MAX_PLAYERS) this.participants.push(null);
        this.ready = this.participants.map(() => false);
        this.queues = this.participants.map(() => []);
        this.masks = this.participants.map(() => 0);
        this.last_input_at = this.participants.map(() => options.now);
        this.min_lead = this.participants.map(() => Infinity);
        this.last_snapshot_at = this.participants.map(() => -Infinity);
        this.seed = randomInt(1, 0xffffffff);
        this.load_deadline = options.now + LOAD_TIMEOUT_MS;
        this.on_finish = options.on_finish;
        this.state = create_state(this.seed);
        this.sim = new Sim(this.state, this.map, NO_CHEATS, this.end_score);

        const slots: MatchSlot[] = this.participants.map((p) => (p ? { id: p.id, name: p.name } : null));
        this.info = { id: this.id, level: options.level, endScore: this.end_score, slots };
        this.broadcast({ t: 'load', match: this.info });
    }

    get frame() {
        return this.state.frame;
    }

    has_participant(client_id: string) {
        return this.slot_of(client_id) >= 0;
    }

    participant_ids(): string[] {
        return this.participants.filter((p): p is Participant => p !== null).map((p) => p.id);
    }

    mark_ready(client_id: string, now: number) {
        const slot = this.slot_of(client_id);
        if (slot < 0 || this.status !== 'loading') return;
        this.ready[slot] = true;
        this.last_input_at[slot] = now;
        if (this.participants.every((p, i) => !p || this.ready[i])) this.begin(now);
    }

    handle_input(client_id: string, f: number, m: number, now: number) {
        const slot = this.slot_of(client_id);
        if (slot < 0 || this.status !== 'playing') return;

        const lead = f - this.state.frame;
        if (lead < this.min_lead[slot]) this.min_lead[slot] = lead;
        this.last_input_at[slot] = now;

        const queue = this.queues[slot];
        const last = queue.length ? queue[queue.length - 1] : null;
        // Keep the queue ordered by frame even if the client's clock jumped backwards
        const frame = last && f < last.f ? last.f : f;
        if (last && last.f === frame) last.m = m;
        else queue.push({ f: frame, m });
        if (queue.length > MAX_QUEUED_INPUTS) queue.splice(0, queue.length - MAX_QUEUED_INPUTS);
    }

    handle_hash(client_id: string, f: number, h: number, now: number) {
        const slot = this.slot_of(client_id);
        if (slot < 0 || this.status !== 'playing') return;
        const expected = this.hashes.get(f);
        if (expected === undefined || expected === h) return;
        console.warn(`match ${this.id}: state of slot ${slot} diverged at frame ${f}, sending snapshot`);
        this.send_snapshot(slot, now);
    }

    handle_resync(client_id: string, now: number) {
        const slot = this.slot_of(client_id);
        if (slot < 0 || this.status !== 'playing') return;
        this.send_snapshot(slot, now);
    }

    private send_snapshot(slot: number, now: number) {
        if (now - this.last_snapshot_at[slot] < SNAPSHOT_COOLDOWN_MS) return;
        this.last_snapshot_at[slot] = now;
        this.participants[slot]?.send({ t: 'snap', state: clone_state(this.state) });
    }

    /** A participant quits the match, leaves the room or disconnects. */
    remove(client_id: string, now: number) {
        const slot = this.slot_of(client_id);
        if (slot < 0) return;
        this.participants[slot] = null;
        this.queues[slot] = [];
        this.masks[slot] = 0;
        if (this.status === 'playing') this.pending_leaves.push(slot);
        if (this.participants.every((p) => !p)) this.finish('empty');
        else if (this.status === 'loading' && this.participants.every((p, i) => !p || this.ready[i])) {
            this.begin(now);
        }
    }

    end(reason: MatchEndReason) {
        this.finish(reason);
    }

    tick(now: number) {
        if (this.status === 'loading') {
            if (now >= this.load_deadline) this.begin(now);
            return;
        }
        if (this.status !== 'playing') return;

        let due = Math.floor((now - this.start_time) / FRAME_MS) + 1;
        if (due - this.state.frame > MAX_FRAMES_PER_TICK) {
            this.start_time += (due - this.state.frame - MAX_FRAMES_PER_TICK) * FRAME_MS;
            due = this.state.frame + MAX_FRAMES_PER_TICK;
        }
        if (due <= this.state.frame) return;

        const first = this.state.frame;
        const inputs: number[] = [];
        const events: LeaveEvent[] = [];
        while (this.state.frame < due && this.status === 'playing') {
            const f = this.state.frame;
            for (const slot of this.pending_leaves) {
                this.state.player[slot].enabled = false;
                events.push([f, slot]);
            }
            this.pending_leaves = [];

            for (let slot = 0; slot < JNB_MAX_PLAYERS; slot++) {
                const queue = this.queues[slot];
                while (queue.length && queue[0].f <= f) this.masks[slot] = queue.shift()!.m;
                if (!this.participants[slot] || now - this.last_input_at[slot] > INPUT_TIMEOUT_MS) {
                    this.masks[slot] = 0;
                }
            }
            const packed = pack_inputs(this.masks);
            this.sim.step(packed);
            inputs.push(packed);

            if (this.state.frame % HASH_INTERVAL === 0) {
                this.hashes.set(this.state.frame, hash_state(this.state));
                this.hashes.delete(this.state.frame - HASH_INTERVAL * HASHES_KEPT);
            }
            if (this.state.frame % LEAD_REPORT_INTERVAL === 0) this.report_leads();
            if (this.state.endscore_reached) break;
        }

        const message: ServerMessage = { t: 'c', f: first, m: inputs };
        if (events.length) message.e = events;
        this.broadcast(message);

        if (this.state.endscore_reached) this.finish('score');
    }

    private begin(now: number) {
        if (this.status !== 'loading') return;
        for (let slot = 0; slot < JNB_MAX_PLAYERS; slot++) {
            const participant = this.participants[slot];
            if (participant && !this.ready[slot]) {
                participant.send({ t: 'dropped', match: this.id, message: 'The level did not load in time.' });
                this.participants[slot] = null;
                this.info.slots[slot] = null;
            }
        }
        if (this.participants.every((p) => !p)) {
            this.finish('empty');
            return;
        }

        for (let slot = 0; slot < JNB_MAX_PLAYERS; slot++) {
            this.state.player[slot].enabled = this.participants[slot] !== null;
            this.last_input_at[slot] = now;
        }
        this.sim.init_players();
        this.status = 'playing';
        this.start_time = now;
        this.broadcast({ t: 'go', match: this.id, state: clone_state(this.state) });
    }

    private report_leads() {
        for (let slot = 0; slot < JNB_MAX_PLAYERS; slot++) {
            const participant = this.participants[slot];
            if (participant && Number.isFinite(this.min_lead[slot])) {
                participant.send({ t: 'lead', l: this.min_lead[slot] });
            }
            this.min_lead[slot] = Infinity;
        }
    }

    private finish(reason: MatchEndReason) {
        if (this.status === 'over') return;
        const was_playing = this.status === 'playing';
        this.status = 'over';
        const result = was_playing ? this.result(reason) : null;
        if (result) {
            this.broadcast({ t: 'over', match: this.id, reason, state: clone_state(this.state), result });
        }
        this.on_finish(reason, result);
    }

    private result(reason: MatchEndReason): MatchResult {
        return {
            match: this.id,
            reason,
            endScore: this.end_score,
            level: this.info.level,
            names: this.info.slots.map((slot) => slot?.name ?? null),
            bumps: this.state.player.map((p) => p.bumps),
            bumped: this.state.player.map((p) => p.bumped.slice()),
        };
    }

    private slot_of(client_id: string) {
        return this.participants.findIndex((p) => p !== null && p.id === client_id);
    }

    private broadcast(message: ServerMessage) {
        for (const participant of this.participants) participant?.send(message);
    }
}
