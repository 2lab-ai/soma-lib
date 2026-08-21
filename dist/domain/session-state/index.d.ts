/**
 * session-state — pure state machine for an agent chat session's runtime.
 *
 * Extracted verbatim from soma `src/core/session/state-machine.ts` (Step 4a,
 * 2026-08-22). Pure transition functions over an immutable
 * `SessionRuntimeState` — no I/O, no timers. The session OBJECT (stores,
 * serialization, thread/workdir wiring) stays app-side; this is only the
 * state algebra.
 *
 * Two orthogonal axes:
 *   - `ActivityState` ('idle' | 'working' | 'waiting') — what the bot is
 *     doing from the USER's point of view. soma-work shares this exact
 *     vocabulary (`src/types.ts`) for its Slack sessions: working = actively
 *     processing, waiting = blocked on user input (choice/permission), idle =
 *     done. Step 4a: soma-work adopts the shared TYPE; adopting the
 *     transition functions inside its SessionRegistry is a later sub-step.
 *   - `QueryState` ('idle' | 'preparing' | 'running' | 'aborting' |
 *     'completing') — the engine-query lifecycle, with stop/interrupt flags
 *     and a generation counter for stale-callback fencing.
 *
 * Provenance: soma derives from Fabrizio Rinaldi's MIT claude-telegram-bot —
 * see the attribution note in LICENSE.
 */
export type ActivityState = "idle" | "working" | "waiting";
export type QueryState = "idle" | "preparing" | "running" | "aborting" | "completing";
export interface SessionRuntimeState {
    activityState: ActivityState;
    queryState: QueryState;
    stopRequested: boolean;
    wasInterruptedByNewMessage: boolean;
    isInterrupting: boolean;
    generation: number;
}
export interface InterruptConsumptionResult {
    wasInterrupted: boolean;
    nextState: SessionRuntimeState;
}
export interface BeginInterruptResult {
    started: boolean;
    nextState: SessionRuntimeState;
}
export declare function createInitialSessionRuntimeState(): SessionRuntimeState;
export declare function transitionActivityState(state: SessionRuntimeState, nextActivityState: ActivityState): SessionRuntimeState;
export declare function transitionQueryState(state: SessionRuntimeState, nextQueryState: QueryState): SessionRuntimeState;
export declare function startProcessingTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function stopProcessingTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function startQueryTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function completeQueryTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function finalizeQueryTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function requestStopDuringRunningTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function requestStopDuringPreparingTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function clearStopRequestedTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function markInterruptFlag(state: SessionRuntimeState): SessionRuntimeState;
export declare function consumeInterruptFlagTransition(state: SessionRuntimeState): InterruptConsumptionResult;
export declare function beginInterruptTransition(state: SessionRuntimeState): BeginInterruptResult;
export declare function endInterruptTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function incrementGenerationTransition(state: SessionRuntimeState): SessionRuntimeState;
export declare function isQueryRunning(state: SessionRuntimeState): boolean;
export declare function isQueryProcessing(state: SessionRuntimeState): boolean;
