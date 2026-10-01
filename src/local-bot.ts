import { BAN } from './constants';
import type { BanMap } from './sim/ban-map';
import {
    INPUT_LEFT,
    INPUT_RIGHT,
    INPUT_UP,
    NO_CHEATS,
    Sim,
    SimCheats,
    SimPlayer,
    copy_state,
    create_state,
    pack_inputs,
} from './sim/sim';

const THINK_INTERVAL = 6;
const LOOKAHEAD = 36;
const ACTIONS = [0, INPUT_LEFT, INPUT_RIGHT, INPUT_UP, INPUT_LEFT | INPUT_UP, INPUT_RIGHT | INPUT_UP].map((mask) => [
    mask,
    mask,
]);
// Back out from beneath a ledge, then turn and jump onto it.
ACTIONS.push([INPUT_LEFT, INPUT_RIGHT | INPUT_UP], [INPUT_RIGHT, INPUT_LEFT | INPUT_UP]);
const TILE_SIZE = 16;
const FIXED = 65536;

/** A local computer player. Planning uses private, silent copies of the normal physics. */
export class LocalBot {
    private map: BanMap | null = null;
    private sim: Sim | null = null;
    private source = create_state(1);
    private frame = 0;
    private mask = 0;
    private target = -1;
    private target_cell = -1;
    private jump_tiles = 3;
    private distances = new Int16Array(0);
    private queue = new Int16Array(0);
    private visits = new Uint8Array(0);
    private anchor_x = 0;
    private anchor_y = 0;
    private escape_until = 0;
    private escape_direction = 1;

    reset() {
        this.frame = 0;
        this.mask = 0;
        this.target = -1;
        this.target_cell = -1;
        this.escape_until = 0;
        this.visits.fill(0);
    }

    input(players: SimPlayer[], slot: number, map: BanMap, cheats: SimCheats = NO_CHEATS): number {
        const player = players[slot];
        if (!player.enabled || player.dead_flag) {
            this.reset();
            return 0;
        }
        if (this.map !== map) {
            this.map = map;
            this.sim = new Sim(create_state(1), map);
            const cells = map.tiles.length * map.tiles[0].length;
            this.distances = new Int16Array(cells);
            this.queue = new Int16Array(cells);
            this.visits = new Uint8Array(cells);
            this.reset();
        }

        const x = player.x / FIXED;
        const y = player.y / FIXED;
        if (this.frame === 0) {
            this.anchor_x = x;
            this.anchor_y = y;
        }
        if (this.frame % THINK_INTERVAL === 0 || !this.is_target(players, slot, this.target)) {
            this.target = this.find_target(players, slot);
            if (this.target < 0) {
                this.reset();
                return 0;
            }
            const target = players[this.target];
            const jump_tiles = cheats.jetpack ? map.tiles.length : cheats.bunnies_in_space ? 6 : 3;
            if (jump_tiles !== this.jump_tiles) {
                this.jump_tiles = jump_tiles;
                this.target_cell = -1;
            }
            this.route_to(target.x / FIXED, target.y / FIXED);
            const cell = this.cell(x, y);
            this.visits[cell] = Math.min(80, this.visits[cell] + 1);
            if (this.frame % 300 === 0) {
                for (let i = 0; i < this.visits.length; i++) this.visits[i] >>= 1;
            }
            // A failed approach must eventually give way to a different takeoff point.
            if (this.frame > 0 && this.frame % 90 === 0) {
                if (Math.abs(x - this.anchor_x) < 12 && Math.abs(y - this.anchor_y) < 48) {
                    this.escape_direction = this.mask & INPUT_RIGHT ? -1 : 1;
                    this.escape_until = this.frame + 36;
                }
                this.anchor_x = x;
                this.anchor_y = y;
            }
            this.mask = this.plan(players, slot, cheats);
        }
        this.frame++;
        return this.jump_input(this.mask, player, cheats);
    }

    private is_target(players: SimPlayer[], slot: number, target: number) {
        return target >= 0 && target !== slot && players[target].enabled && !players[target].dead_flag;
    }

    private find_target(players: SimPlayer[], slot: number) {
        let best = Infinity;
        let target = -1;
        for (let i = 0; i < players.length; i++) {
            if (!this.is_target(players, slot, i)) continue;
            const dx = Math.abs(players[i].x - players[slot].x) / FIXED;
            const dy = Math.abs(players[i].y - players[slot].y) / FIXED;
            // Keep a target through small changes in distance instead of flickering between bunnies.
            const distance = (dx + dy * 1.2) * (i === this.target ? 0.8 : 1);
            if (distance < best) {
                best = distance;
                target = i;
            }
        }
        return target;
    }

    private cell(x: number, y: number) {
        const width = this.map.tiles[0].length;
        const column = Math.max(0, Math.min(width - 1, Math.round(x / TILE_SIZE)));
        const row = Math.max(0, Math.min(this.map.tiles.length - 1, Math.round(y / TILE_SIZE)));
        return row * width + column;
    }

    private open(cell: number) {
        const width = this.map.tiles[0].length;
        const tile = this.map.tiles[Math.floor(cell / width)]?.[cell % width];
        return tile === BAN.VOID || tile === BAN.WATER;
    }

    private can_rise(cell: number) {
        const width = this.map.tiles[0].length;
        const row = Math.floor(cell / width);
        const column = cell % width;
        const spring_tiles = this.jump_tiles * 2 + 1;
        if (this.map.tiles[row][column] === BAN.WATER) return true;
        for (let below = 1; below <= spring_tiles; below++) {
            const tile = this.map.tiles[row + below]?.[column];
            if (tile === BAN.SPRING) return true;
            if (tile === BAN.SOLID || tile === BAN.ICE || tile === BAN.WATER) return below <= this.jump_tiles;
        }
        return this.jump_tiles >= this.map.tiles.length;
    }

    /** A small flood fill guides approaches around walls; the lookahead checks actual jump reach. */
    private route_to(x: number, y: number) {
        let cell = this.cell(x, y);
        if (!this.open(cell)) {
            let best = Infinity;
            const width = this.map.tiles[0].length;
            for (let i = 0; i < this.distances.length; i++) {
                if (!this.open(i)) continue;
                const distance =
                    Math.abs((i % width) * TILE_SIZE - x) + Math.abs(Math.floor(i / width) * TILE_SIZE - y);
                if (distance < best) {
                    best = distance;
                    cell = i;
                }
            }
        }
        if (cell === this.target_cell) return;
        this.target_cell = cell;
        this.distances.fill(-1);
        const width = this.map.tiles[0].length;
        let read = 0;
        let write = 1;
        this.queue[0] = cell;
        this.distances[cell] = 0;
        while (read < write) {
            const current = this.queue[read++];
            const column = current % width;
            for (const next of [
                column > 0 ? current - 1 : -1,
                column + 1 < width ? current + 1 : -1,
                current - width,
                current + width,
            ]) {
                if (next < 0 || next >= this.distances.length || this.distances[next] >= 0 || !this.open(next))
                    continue;
                // This is a reverse search: entering the cell below means jumping up from it.
                if (next === current + width && !this.can_rise(next)) continue;
                this.distances[next] = this.distances[current] + 1;
                this.queue[write++] = next;
            }
        }
    }

    private distance(x: number, y: number, target: SimPlayer) {
        const width = this.map.tiles[0].length;
        const column = Math.max(0, Math.min(width - 1, Math.floor(x / TILE_SIZE)));
        const row = Math.max(0, Math.min(this.map.tiles.length - 1, Math.floor(y / TILE_SIZE)));
        let best = Infinity;
        // Interpolate between reachable cells so small movements still make measurable progress.
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                if (column + dx >= width || row + dy >= this.map.tiles.length) continue;
                const cell = (row + dy) * width + column + dx;
                if (this.distances[cell] < 0) continue;
                best = Math.min(
                    best,
                    this.distances[cell] * TILE_SIZE +
                        Math.abs(x - (column + dx) * TILE_SIZE) +
                        Math.abs(y - (row + dy) * TILE_SIZE)
                );
            }
        }
        return Number.isFinite(best) ? best : 400 + Math.abs(x - target.x / FIXED) + Math.abs(y - target.y / FIXED);
    }

    private jump_input(mask: number, player: SimPlayer, cheats: SimCheats) {
        // Release jump on landing before asking for the next one. Keep it held during ascent.
        if (mask & INPUT_UP && !cheats.jetpack && !player.jump_ready && (player.y_add >= 0 || player.in_water)) {
            return mask & ~INPUT_UP;
        }
        return mask;
    }

    private plan(players: SimPlayer[], slot: number, cheats: SimCheats) {
        this.source.player = players;
        const sim = this.sim;
        sim.cheats = cheats;
        const masks = players.map(
            (p) => (p.x_add < 0 ? INPUT_LEFT : p.x_add > 0 ? INPUT_RIGHT : 0) | (p.action_up ? INPUT_UP : 0)
        );
        const start = players[slot];
        let best = -Infinity;
        let action = 0;
        for (const [mask, follow] of ACTIONS) {
            copy_state(sim.state, this.source);
            // Never predict a respawn or consult its random location.
            for (const p of sim.state.player) if (p.dead_flag) p.enabled = false;
            let score = mask === this.mask ? 0.5 : 0;
            for (let frame = 0; frame < LOOKAHEAD; frame++) {
                const p = sim.state.player[slot];
                // Do not reach the original jetpack's fixed-point overflow ahead of the real game.
                if (sim.state.player.some((other) => other.enabled && other.y < -0x7ff00000)) break;
                masks[slot] = this.jump_input(frame < 12 ? mask : follow, p, cheats);
                sim.step(pack_inputs(masks));
                if (p.dead_flag) {
                    score -= 2000 - frame * 10;
                    break;
                }
                if (p.bumps > start.bumps) {
                    score += 2000 - frame * 10;
                    break;
                }
                for (const other of sim.state.player) if (other.dead_flag) other.enabled = false;
                if ((frame + 1) % 12 !== 0) continue;
                const target = sim.state.player[this.target];
                const x = p.x / FIXED;
                const y = p.y / FIXED;
                const dx = Math.abs(target.x / FIXED - x);
                const above = (target.y - p.y) / FIXED;
                score -= this.distance(x, y, target) * 0.5 + dx * 0.15;
                if (dx < 64) {
                    score += Math.min(48, Math.max(0, above)) * (1 - dx / 64);
                    if (above < 0 && above > -48) score -= Math.max(0, 40 - dx) * 1.5;
                } else {
                    score -= this.visits[this.cell(x, y)] * 2;
                }
                if (this.frame < this.escape_until) {
                    score += (x - start.x / FIXED) * this.escape_direction * 2;
                }
            }
            if (score > best) {
                best = score;
                action = mask;
            }
        }
        return action;
    }
}
