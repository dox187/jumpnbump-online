/**
 * Client side of the netcode: runs the local clock a little ahead of the server, predicts the
 * frames the server has not confirmed yet, and rolls back whenever confirmed inputs arrive.
 *
 * Pure logic without DOM access, so it runs in the browser and in Node tests alike.
 */
import { JNB_MAX_PLAYERS } from '../constants';
import type { BanMap } from '../sim/ban-map';
import {
    INPUT_BITS,
    INPUT_MASK,
    NO_CHEATS,
    Sim,
    SimFx,
    SimState,
    clone_state,
    copy_state,
    hash_state,
} from '../sim/sim';
import { COUNTDOWN_FRAMES, ClientMessage, FRAME_MS, HASH_INTERVAL, LeaveEvent, ServerMessage } from './protocol';

/** The server's reported lead we aim for: inputs should arrive this many frames before they are needed. */
const TARGET_LEAD = 1;
/** Never predict further than this; the local clock stalls until confirmations catch up. */
const MAX_PREDICTION = 40;
/** Resend the current input at least this often so the server knows we are alive. */
const HEARTBEAT_FRAMES = 6;
/** A gap longer than this between updates (background tab, debugger) resynchronises the clock. */
const MAX_UPDATE_GAP_MS = 250;
/** Clock errors beyond this many frames are fixed by jumping instead of speeding up or slowing down. */
const JUMP_THRESHOLD = 20;
const INPUT_HISTORY = 256;
/** Spectators show confirmed frames only, paced at 60 Hz, keeping this many frames in hand against jitter. */
const SPECTATOR_BUFFER = 3;
/** A spectator this many frames behind the newest confirmation catches up faster. */
const SPECTATOR_MAX_BUFFER = 12;
const SPECTATOR_STALL_MS = 500;

export type SessionOptions = {
    /** Our bunny, or -1 to watch as a spectator: no inputs, no prediction. */
    slot: number;
    state: SimState;
    map: BanMap;
    end_score: number;
    send: (message: ClientMessage) => void;
    now: number;
    rtt_ms: number;
    fx?: SimFx | null;
    /** Called after every frame that is simulated for the first time, to advance cosmetic effects. */
    on_new_frame?: (state: SimState) => void;
    /** Called with the confirmed state and its inputs right before each confirmed frame is simulated. */
    on_confirm?: (state: SimState, packed: number) => void;
};

export type SessionStats = {
    confirmed_frame: number;
    local_frame: number;
    prediction: number;
    lead: number;
    /** Confirmed frames whose inputs differed from what we had predicted. */
    mispredictions: number;
    snapshots: number;
    /** The local clock is waiting for confirmations from the server. */
    stalled: boolean;
};

export class NetSession {
    readonly slot: number;
    readonly confirmed: SimState;
    readonly predicted: SimState;
    final_state: SimState | null = null;
    /** Set whenever the predicted state changed and should be drawn. */
    dirty = true;

    private confirmed_sim: Sim;
    private predicted_sim: Sim;
    private send: (message: ClientMessage) => void;
    private fx: SimFx | null;
    private on_new_frame: (state: SimState) => void;
    private on_confirm: (state: SimState, packed: number) => void;
    private readonly spectator: boolean;
    private starved_ms = 0;

    private pending: number[] = [];
    private pending_first = 0;
    private leave_events: LeaveEvent[] = [];
    private last_confirmed_input = 0;
    /** The server has confirmed every frame below this one (as far as we know). */
    private server_frame = 0;

    private local_frame: number;
    private local_mask = 0;
    private local_inputs = new Int8Array(INPUT_HISTORY);
    /** Packed inputs used by the latest prediction, to count mispredictions. */
    private predicted_inputs = new Int32Array(INPUT_HISTORY);
    private predicted_until = 0;
    private last_sent_frame = -Infinity;
    private last_sent_mask = -1;

    /** Highest frame whose cosmetic effects were already produced. */
    private fx_frame = -1;
    private fired_deaths: number[] = new Array(JNB_MAX_PLAYERS).fill(0);

    private accumulator = 0;
    private last_time: number;
    private speed = 1;
    private reported_lead = TARGET_LEAD;
    private mispredictions = 0;
    private stalled = false;
    private awaiting_snapshot = false;
    private snapshots = 0;

    constructor(options: SessionOptions) {
        this.slot = options.slot;
        this.send = options.send;
        this.confirmed = clone_state(options.state);
        this.predicted = clone_state(options.state);
        this.confirmed_sim = new Sim(this.confirmed, options.map, NO_CHEATS, options.end_score);
        this.predicted_sim = new Sim(this.predicted, options.map, NO_CHEATS, options.end_score);
        this.fx = options.fx ? { ...options.fx, allow_kill_fx: this.allow_kill_fx } : null;
        this.on_new_frame = options.on_new_frame ?? (() => {});
        this.on_confirm = options.on_confirm ?? (() => {});
        this.spectator = options.slot < 0;
        this.last_time = options.now;
        this.pending_first = this.confirmed.frame;
        this.server_frame = this.confirmed.frame;
        this.fx_frame = this.confirmed.frame - 1;
        // Start far enough ahead that our first inputs reach the server before it needs them
        this.local_frame = this.confirmed.frame + Math.ceil(options.rtt_ms / FRAME_MS) + TARGET_LEAD + 1;
        this.local_inputs.fill(0);
    }

    get finished() {
        return this.final_state !== null;
    }

    /** The next local frame; it advances at 60 Hz while the match runs. Spectators see confirmed frames. */
    get frame() {
        return this.spectator ? this.confirmed.frame : this.local_frame;
    }

    /** The state to draw: the final state once the match is over, the prediction (or for spectators the
     * confirmed state) before. */
    get view(): SimState {
        return this.final_state ?? (this.spectator ? this.confirmed : this.predicted);
    }

    stats(): SessionStats {
        return {
            confirmed_frame: this.confirmed.frame,
            local_frame: this.local_frame,
            prediction: this.local_frame - this.confirmed.frame,
            lead: this.reported_lead,
            mispredictions: this.mispredictions,
            snapshots: this.snapshots,
            stalled: this.stalled,
        };
    }

    handle_message(message: ServerMessage) {
        switch (message.t) {
            case 'c': {
                const expected = this.pending_first + this.pending.length;
                this.server_frame = Math.max(this.server_frame, message.f + message.m.length);
                if (message.f > expected) {
                    // Confirmations went missing; ask for a snapshot and wait for it
                    if (!this.awaiting_snapshot) {
                        console.warn(`netcode: confirmations jumped from ${expected} to ${message.f}, resyncing`);
                        this.awaiting_snapshot = true;
                        this.send({ t: 'resync' });
                    }
                    return;
                }
                const skip = expected - message.f;
                for (let i = skip; i < message.m.length; i++) this.pending.push(message.m[i]);
                if (message.e) this.leave_events.push(...message.e);
                return;
            }
            case 'lead':
                this.reported_lead = message.l;
                this.adjust_clock(message.l);
                return;
            case 'snap': {
                this.snapshots++;
                this.awaiting_snapshot = false;
                const state = message.state;
                copy_state(this.confirmed, state);
                const drop = state.frame - this.pending_first;
                if (drop > 0) this.pending.splice(0, drop);
                else if (drop < 0) this.pending = [];
                this.pending_first = state.frame;
                this.leave_events = this.leave_events.filter(([f]) => f >= state.frame);
                this.server_frame = Math.max(this.server_frame, state.frame);
                this.dirty = true;
                return;
            }
            case 'over':
                // The last confirmations may still be waiting; the final frames count for the replay
                this.apply_confirmations();
                this.final_state = clone_state(message.state);
                this.dirty = true;
                return;
        }
    }

    /** Advances the local clock, applies confirmations and re-predicts. Call once per animation frame. */
    update(now: number, local_mask: number) {
        if (this.finished) return;
        if (this.spectator) {
            this.update_spectator(now);
            return;
        }
        this.local_mask = local_mask & INPUT_MASK;

        let elapsed = now - this.last_time;
        this.last_time = now;
        if (elapsed < 0) elapsed = 0;
        if (elapsed > MAX_UPDATE_GAP_MS) {
            // We were not running; skip ahead instead of simulating the gap in one burst
            elapsed = FRAME_MS;
            this.accumulator = 0;
        }
        this.accumulator += elapsed * this.speed;
        while (this.accumulator >= FRAME_MS) {
            if (this.local_frame - this.server_frame >= MAX_PREDICTION) {
                this.accumulator = 0;
                break;
            }
            this.accumulator -= FRAME_MS;
            this.sample_input();
        }
        this.stalled = this.local_frame - this.server_frame >= MAX_PREDICTION;
        // After a stall we may be behind the server: jump so our inputs count again
        if (this.local_frame <= this.server_frame) this.jump_to(this.server_frame + TARGET_LEAD + 1);

        // Catching up on a long backlog (e.g. after a background tab): no sound or particle storm
        if (this.server_frame - this.confirmed.frame > MAX_PREDICTION) {
            this.fx_frame = Math.max(this.fx_frame, this.server_frame - 2);
        }

        const confirmed_before = this.confirmed.frame;
        this.apply_confirmations();
        if (this.confirmed.frame !== confirmed_before) this.dirty = true;
        if (this.dirty) this.predict();
    }

    /** Plays the confirmed frames back at 60 Hz a few frames behind the server, never predicting. */
    private update_spectator(now: number) {
        let elapsed = now - this.last_time;
        this.last_time = now;
        if (elapsed < 0) elapsed = 0;
        if (elapsed > MAX_UPDATE_GAP_MS) elapsed = FRAME_MS;
        this.accumulator += elapsed;
        let due = Math.floor(this.accumulator / FRAME_MS);
        this.accumulator -= due * FRAME_MS;
        // Late confirmations make us wait, so a small buffer builds up by itself; a big one is caught up
        const available = this.pending.length;
        if (available > SPECTATOR_MAX_BUFFER) due = available - SPECTATOR_BUFFER;
        this.starved_ms = available === 0 ? this.starved_ms + elapsed : 0;
        this.stalled = this.starved_ms > SPECTATOR_STALL_MS;
        if (due > 0) {
            const before = this.confirmed.frame;
            this.apply_confirmations(due);
            if (this.confirmed.frame !== before) this.dirty = true;
        }
    }

    private sample_input() {
        const f = this.local_frame;
        this.local_inputs[f % INPUT_HISTORY] = this.local_mask;
        if (this.local_mask !== this.last_sent_mask || f - this.last_sent_frame >= HEARTBEAT_FRAMES) {
            this.send({ t: 'i', f, m: this.local_mask });
            this.last_sent_mask = this.local_mask;
            this.last_sent_frame = f;
        }
        this.local_frame++;
        this.dirty = true;
    }

    private jump_to(frame: number) {
        while (this.local_frame < frame) {
            this.local_inputs[this.local_frame % INPUT_HISTORY] = this.local_mask;
            this.local_frame++;
        }
        this.send({ t: 'i', f: this.local_frame - 1, m: this.local_mask });
        this.last_sent_mask = this.local_mask;
        this.last_sent_frame = this.local_frame - 1;
        this.dirty = true;
    }

    private adjust_clock(lead: number) {
        const error = lead - TARGET_LEAD;
        if (error < -JUMP_THRESHOLD) {
            this.jump_to(this.local_frame - error);
            this.speed = 1;
        } else if (error > JUMP_THRESHOLD) {
            // Far ahead: pause the local clock for a while
            this.accumulator -= error * FRAME_MS;
            this.speed = 1;
        } else {
            this.speed = Math.min(1.15, Math.max(0.9, 1 - error * 0.02));
        }
    }

    private apply_confirmations(limit = Infinity) {
        for (let applied = 0; applied < limit && this.pending.length && !this.finished; applied++) {
            const f = this.confirmed.frame;
            if (f !== this.pending_first) {
                console.warn(`netcode: confirmed state at ${f} but pending inputs start at ${this.pending_first}`);
                this.pending = [];
                this.pending_first = f;
                return;
            }
            const packed = this.pending.shift()!;
            this.pending_first++;
            if (f < this.predicted_until && this.predicted_inputs[f % INPUT_HISTORY] !== packed) this.mispredictions++;
            this.apply_leave_events(this.confirmed, f, true);
            this.on_confirm(this.confirmed, packed);

            const first_time = f > this.fx_frame;
            this.confirmed_sim.fx = first_time ? this.fx : null;
            this.confirmed_sim.step(packed);
            if (first_time) {
                this.fx_frame = f;
                this.on_new_frame(this.confirmed);
            }
            this.last_confirmed_input = packed;
            if (!this.spectator && this.confirmed.frame % HASH_INTERVAL === 0) {
                this.send({ t: 'h', f: this.confirmed.frame, h: hash_state(this.confirmed) });
            }
        }
    }

    private apply_leave_events(state: SimState, f: number, consume: boolean) {
        if (!this.leave_events.length) return;
        for (const [frame, slot] of this.leave_events) if (frame <= f) state.player[slot].enabled = false;
        if (consume) this.leave_events = this.leave_events.filter(([frame]) => frame > f);
    }

    private predict() {
        this.dirty = true;
        copy_state(this.predicted, this.confirmed);

        const shift = this.slot * INPUT_BITS;
        const remote = this.last_confirmed_input & ~(INPUT_MASK << shift);
        for (let f = this.confirmed.frame; f < this.local_frame; f++) {
            // The server ignores everybody's inputs during the countdown
            const own =
                f < COUNTDOWN_FRAMES
                    ? 0
                    : f >= this.local_frame - INPUT_HISTORY
                      ? this.local_inputs[f % INPUT_HISTORY]
                      : this.local_mask;
            const packed = remote | (own << shift);
            this.predicted_inputs[f % INPUT_HISTORY] = packed;
            this.apply_leave_events(this.predicted, f, false);
            const first_time = f > this.fx_frame;
            this.predicted_sim.fx = first_time ? this.fx : null;
            this.predicted_sim.step(packed);
            if (first_time) {
                this.fx_frame = f;
                this.on_new_frame(this.predicted);
            }
        }
        this.predicted_until = this.local_frame;
    }

    /** A death's gore and sound are shown only the first time that death is simulated. */
    private allow_kill_fx = (state: SimState, killer: number, victim: number) => {
        let deaths = 0;
        for (let i = 0; i < JNB_MAX_PLAYERS; i++) deaths += state.player[i].bumped[victim];
        if (deaths < this.fired_deaths[victim]) return false;
        this.fired_deaths[victim] = deaths + 1;
        return true;
    };
}
