import ctx from './context';

export type BotDifficulty = 1 | 2 | 3;
export type BotMode = 0 | BotDifficulty;
export type LocalPhase = 'inactive' | 'lobby' | 'playing' | 'scores';
export const BOT_MODE_NAMES = ['HUMAN', 'EASY', 'MEDIUM', 'HARD'] as const;
export const BOT_MODE_COLORS = ['#ffffff', '#b6ff4a', '#ffd648', '#ff6854'] as const;

type LocalControls = {
    phase: LocalPhase;
    modes: readonly BotMode[];
    change: { slot: number; mode: BotMode } | null;
};

let state: LocalControls = { phase: 'inactive', modes: [0, 0, 0, 0], change: null };
const listeners = new Set<() => void>();

export const get_local_controls = () => state;

export function subscribe_local_controls(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function set_local_phase(phase: LocalPhase) {
    state = { phase, modes: ctx.ai.slice(), change: null };
    for (const listener of listeners) listener();
}

/** Keyboard and touch numbers share this cycle; menus outside the local engine cannot change it. */
export function cycle_local_bot(slot: number) {
    if (state.phase !== 'lobby' && state.phase !== 'playing') return;
    const mode = ((ctx.ai[slot] + 1) % 4) as BotMode;
    ctx.ai[slot] = mode;
    state = { ...state, modes: ctx.ai.slice(), change: { slot, mode } };
    for (const listener of listeners) listener();
}
