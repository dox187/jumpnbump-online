import type { BanMap } from './sim/ban-map';
import { Sim, SimCheats, SimFx, SimState, clone_state, copy_state } from './sim/sim';

const REPLAY_BEFORE = 100;
const REPLAY_AFTER = 20;
export const REPLAY_FRAME_MS = (1000 / 60) * 2.5;
export const REPLAY_HOLD_MS = 600;

type Frame = { state: SimState; cheats: SimCheats };

/** A short, bounded history of the actual local inputs, including bot decisions and cheat changes. */
export class LocalReplay {
    private history: Frame[] = [];
    private next = 0;
    private frames: Frame[] = [];
    sim: Sim;
    frame = 0;
    from_x: number[] = [];
    from_y: number[] = [];

    /** Record after reading controls, before steering or collisions change the players. */
    record(state: SimState, cheats: SimCheats) {
        const frame = this.history[this.next];
        if (frame) {
            copy_state(frame.state, state);
            Object.assign(frame.cheats, cheats);
        } else {
            this.history.push({ state: clone_state(state), cheats: { ...cheats } });
        }
        this.next = (this.next + 1) % REPLAY_BEFORE;
    }

    start(map: BanMap, fx: SimFx) {
        if (!this.history.length) return false;
        this.frames = [...this.history.slice(this.next), ...this.history.slice(0, this.next)];
        const first = this.frames[0];
        this.sim = new Sim(clone_state(first.state), map, { ...first.cheats }, 0);
        this.sim.fx = fx;
        this.frame = 0;
        this.from_x = this.sim.state.player.map((p) => p.x);
        this.from_y = this.sim.state.player.map((p) => p.y);
        return true;
    }

    get length() {
        return this.frames.length + REPLAY_AFTER;
    }

    step() {
        if (this.frame >= this.length) return;
        const state = this.sim.state;
        for (let i = 0; i < state.player.length; i++) {
            this.from_x[i] = state.player[i].x;
            this.from_y[i] = state.player[i].y;
        }
        const recorded = this.frames[this.frame];
        if (recorded) {
            // Each tick starts from its own snapshot, preserving local cheat and control changes exactly.
            copy_state(state, recorded.state);
            Object.assign(this.sim.cheats, recorded.cheats);
        }
        this.sim.steer_players();
        this.sim.collision_check();
        this.frame++;
    }
}
