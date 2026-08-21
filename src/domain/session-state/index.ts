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

export function createInitialSessionRuntimeState(): SessionRuntimeState {
  return {
    activityState: "idle",
    queryState: "idle",
    stopRequested: false,
    wasInterruptedByNewMessage: false,
    isInterrupting: false,
    generation: 0,
  };
}

export function transitionActivityState(
  state: SessionRuntimeState,
  nextActivityState: ActivityState
): SessionRuntimeState {
  return { ...state, activityState: nextActivityState };
}

export function transitionQueryState(
  state: SessionRuntimeState,
  nextQueryState: QueryState
): SessionRuntimeState {
  return { ...state, queryState: nextQueryState };
}

export function startProcessingTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return transitionQueryState(state, "preparing");
}

export function stopProcessingTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return transitionQueryState(state, "idle");
}

export function startQueryTransition(state: SessionRuntimeState): SessionRuntimeState {
  return {
    ...state,
    queryState: "running",
    stopRequested: false,
  };
}

export function completeQueryTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return transitionQueryState(state, "completing");
}

export function finalizeQueryTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return transitionQueryState(state, "idle");
}

export function requestStopDuringRunningTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return {
    ...state,
    stopRequested: true,
    queryState: "aborting",
  };
}

export function requestStopDuringPreparingTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return {
    ...state,
    stopRequested: true,
  };
}

export function clearStopRequestedTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return {
    ...state,
    stopRequested: false,
  };
}

export function markInterruptFlag(state: SessionRuntimeState): SessionRuntimeState {
  return {
    ...state,
    wasInterruptedByNewMessage: true,
  };
}

export function consumeInterruptFlagTransition(
  state: SessionRuntimeState
): InterruptConsumptionResult {
  if (!state.wasInterruptedByNewMessage) {
    return {
      wasInterrupted: false,
      nextState: { ...state, wasInterruptedByNewMessage: false },
    };
  }

  return {
    wasInterrupted: true,
    nextState: {
      ...state,
      wasInterruptedByNewMessage: false,
      stopRequested: false,
    },
  };
}

export function beginInterruptTransition(
  state: SessionRuntimeState
): BeginInterruptResult {
  if (state.isInterrupting) {
    return { started: false, nextState: state };
  }
  return {
    started: true,
    nextState: { ...state, isInterrupting: true },
  };
}

export function endInterruptTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return {
    ...state,
    isInterrupting: false,
  };
}

export function incrementGenerationTransition(
  state: SessionRuntimeState
): SessionRuntimeState {
  return {
    ...state,
    generation: state.generation + 1,
  };
}

export function isQueryRunning(state: SessionRuntimeState): boolean {
  return (
    state.queryState === "running" ||
    state.queryState === "aborting" ||
    state.queryState === "completing"
  );
}

export function isQueryProcessing(state: SessionRuntimeState): boolean {
  return state.queryState !== "idle";
}
