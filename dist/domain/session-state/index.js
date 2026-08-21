"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialSessionRuntimeState = createInitialSessionRuntimeState;
exports.transitionActivityState = transitionActivityState;
exports.transitionQueryState = transitionQueryState;
exports.startProcessingTransition = startProcessingTransition;
exports.stopProcessingTransition = stopProcessingTransition;
exports.startQueryTransition = startQueryTransition;
exports.completeQueryTransition = completeQueryTransition;
exports.finalizeQueryTransition = finalizeQueryTransition;
exports.requestStopDuringRunningTransition = requestStopDuringRunningTransition;
exports.requestStopDuringPreparingTransition = requestStopDuringPreparingTransition;
exports.clearStopRequestedTransition = clearStopRequestedTransition;
exports.markInterruptFlag = markInterruptFlag;
exports.consumeInterruptFlagTransition = consumeInterruptFlagTransition;
exports.beginInterruptTransition = beginInterruptTransition;
exports.endInterruptTransition = endInterruptTransition;
exports.incrementGenerationTransition = incrementGenerationTransition;
exports.isQueryRunning = isQueryRunning;
exports.isQueryProcessing = isQueryProcessing;
function createInitialSessionRuntimeState() {
    return {
        activityState: "idle",
        queryState: "idle",
        stopRequested: false,
        wasInterruptedByNewMessage: false,
        isInterrupting: false,
        generation: 0,
    };
}
function transitionActivityState(state, nextActivityState) {
    return { ...state, activityState: nextActivityState };
}
function transitionQueryState(state, nextQueryState) {
    return { ...state, queryState: nextQueryState };
}
function startProcessingTransition(state) {
    return transitionQueryState(state, "preparing");
}
function stopProcessingTransition(state) {
    return transitionQueryState(state, "idle");
}
function startQueryTransition(state) {
    return {
        ...state,
        queryState: "running",
        stopRequested: false,
    };
}
function completeQueryTransition(state) {
    return transitionQueryState(state, "completing");
}
function finalizeQueryTransition(state) {
    return transitionQueryState(state, "idle");
}
function requestStopDuringRunningTransition(state) {
    return {
        ...state,
        stopRequested: true,
        queryState: "aborting",
    };
}
function requestStopDuringPreparingTransition(state) {
    return {
        ...state,
        stopRequested: true,
    };
}
function clearStopRequestedTransition(state) {
    return {
        ...state,
        stopRequested: false,
    };
}
function markInterruptFlag(state) {
    return {
        ...state,
        wasInterruptedByNewMessage: true,
    };
}
function consumeInterruptFlagTransition(state) {
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
function beginInterruptTransition(state) {
    if (state.isInterrupting) {
        return { started: false, nextState: state };
    }
    return {
        started: true,
        nextState: { ...state, isInterrupting: true },
    };
}
function endInterruptTransition(state) {
    return {
        ...state,
        isInterrupting: false,
    };
}
function incrementGenerationTransition(state) {
    return {
        ...state,
        generation: state.generation + 1,
    };
}
function isQueryRunning(state) {
    return (state.queryState === "running" ||
        state.queryState === "aborting" ||
        state.queryState === "completing");
}
function isQueryProcessing(state) {
    return state.queryState !== "idle";
}
