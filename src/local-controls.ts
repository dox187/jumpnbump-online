import ctx from './context';
import { COUNTDOWN_FRAMES, DEFAULT_END_SCORE, END_SCORE_OPTIONS } from './net/protocol';

export type BotDifficulty = 1 | 2 | 3;
export type BotMode = 0 | BotDifficulty;
export type LocalPhase = 'inactive' | 'lobby' | 'playing' | 'replay' | 'ending' | 'scores';
export const BOT_MODE_NAMES = ['HUMAN', 'EASY', 'MEDIUM', 'HARD'] as const;
export const BOT_MODE_COLORS = ['#ffffff', '#b6ff4a', '#ffd648', '#ff6854'] as const;
export const LOCAL_END_SCORE_OPTIONS = [...END_SCORE_OPTIONS, 0] as const;

type LocalControls = {
    phase: LocalPhase;
    modes: readonly BotMode[];
    endScore: number;
    countdown: number | null;
    change: { slot: number; mode: BotMode } | null;
};

let state: LocalControls = {
    phase: 'inactive',
    modes: [0, 0, 0, 0],
    endScore: DEFAULT_END_SCORE,
    countdown: null,
    change: null,
};
const listeners = new Set<() => void>();

export const get_local_controls = () => state;

export function subscribe_local_controls(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function set_local_phase(phase: LocalPhase) {
    state = {
        ...state,
        phase,
        modes: ctx.ai.slice(),
        countdown: phase === 'playing' ? Math.ceil(COUNTDOWN_FRAMES / 60) : null,
        change: null,
    };
    for (const listener of listeners) listener();
}

/** The local engine's tick clock owns both the starting signal and its score-limit caption. */
export function set_local_countdown(countdown: number | null) {
    if (state.phase !== 'playing' || state.countdown === countdown) return;
    state = { ...state, countdown };
    for (const listener of listeners) listener();
}

/** Match rules can only be changed while choosing players in the local lobby. Zero means no limit. */
export function set_local_end_score(endScore: number) {
    if (state.phase !== 'lobby' || !(LOCAL_END_SCORE_OPTIONS as readonly number[]).includes(endScore)) return;
    if (state.endScore === endScore) return;
    state = { ...state, endScore };
    for (const listener of listeners) listener();
}

export function cycle_local_end_score() {
    const index = (LOCAL_END_SCORE_OPTIONS as readonly number[]).indexOf(state.endScore);
    set_local_end_score(LOCAL_END_SCORE_OPTIONS[(index + 1) % LOCAL_END_SCORE_OPTIONS.length]);
}

export function skip_local_replay() {
    if (state.phase === 'replay') set_local_phase('ending');
}

/** Keyboard and touch numbers share this cycle; menus outside the local engine cannot change it. */
export function cycle_local_bot(slot: number) {
    if (state.phase !== 'lobby' && state.phase !== 'playing') return;
    const mode = ((ctx.ai[slot] + 1) % 4) as BotMode;
    ctx.ai[slot] = mode;
    state = { ...state, modes: ctx.ai.slice(), change: { slot, mode } };
    for (const listener of listeners) listener();
}
