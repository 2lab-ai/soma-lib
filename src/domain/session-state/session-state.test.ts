import { describe, expect, test } from 'vitest';
import * as api from './index';
import {
  beginInterruptTransition,
  clearStopRequestedTransition,
  completeQueryTransition,
  consumeInterruptFlagTransition,
  createInitialSessionRuntimeState,
  finalizeQueryTransition,
  incrementGenerationTransition,
  isQueryProcessing,
  isQueryRunning,
  markInterruptFlag,
  requestStopDuringPreparingTransition,
  requestStopDuringRunningTransition,
  startProcessingTransition,
  startQueryTransition,
  transitionActivityState,
} from './index';

describe("session state-machine transitions", () => {
  test("moves query through preparing -> running -> completing -> idle", () => {
    let state = createInitialSessionRuntimeState();
    state = startProcessingTransition(state);
    expect(state.queryState).toBe("preparing");
    expect(isQueryProcessing(state)).toBe(true);

    state = startQueryTransition(state);
    expect(state.queryState).toBe("running");
    expect(state.stopRequested).toBe(false);
    expect(isQueryRunning(state)).toBe(true);

    state = completeQueryTransition(state);
    expect(state.queryState).toBe("completing");

    state = finalizeQueryTransition(state);
    expect(state.queryState).toBe("idle");
    expect(isQueryRunning(state)).toBe(false);
  });

  test("BUG soma-ps2x: preparing is processing but not yet running", () => {
    const state = startProcessingTransition(createInitialSessionRuntimeState());

    expect(state.queryState).toBe("preparing");
    expect(isQueryProcessing(state)).toBe(true);
    expect(isQueryRunning(state)).toBe(false);
  });

  test("marks stop request when stopping running and preparing queries", () => {
    let state = createInitialSessionRuntimeState();
    state = startQueryTransition(startProcessingTransition(state));
    state = requestStopDuringRunningTransition(state);
    expect(state.stopRequested).toBe(true);
    expect(state.queryState).toBe("aborting");

    state = clearStopRequestedTransition(state);
    expect(state.stopRequested).toBe(false);

    state = requestStopDuringPreparingTransition(startProcessingTransition(state));
    expect(state.stopRequested).toBe(true);
    expect(state.queryState).toBe("preparing");
  });

  test("consumes interrupt flag and clears stop request when interrupted", () => {
    let state = createInitialSessionRuntimeState();
    state = requestStopDuringPreparingTransition(state);
    state = markInterruptFlag(state);

    const consumed = consumeInterruptFlagTransition(state);
    expect(consumed.wasInterrupted).toBe(true);
    expect(consumed.nextState.wasInterruptedByNewMessage).toBe(false);
    expect(consumed.nextState.stopRequested).toBe(false);
  });

  test("supports full interrupt lifecycle during running query", () => {
    let state = createInitialSessionRuntimeState();
    state = startProcessingTransition(state);
    state = startQueryTransition(state);
    state = requestStopDuringRunningTransition(state);
    state = markInterruptFlag(state);

    const consumed = consumeInterruptFlagTransition(state);
    expect(consumed.wasInterrupted).toBe(true);
    expect(consumed.nextState.stopRequested).toBe(false);
    expect(consumed.nextState.wasInterruptedByNewMessage).toBe(false);

    state = completeQueryTransition(consumed.nextState);
    state = finalizeQueryTransition(state);
    expect(state.queryState).toBe("idle");
    expect(state.stopRequested).toBe(false);
  });

  test("interrupt start is idempotent", () => {
    const state = createInitialSessionRuntimeState();
    const first = beginInterruptTransition(state);
    expect(first.started).toBe(true);
    expect(first.nextState.isInterrupting).toBe(true);

    const second = beginInterruptTransition(first.nextState);
    expect(second.started).toBe(false);
    expect(second.nextState.isInterrupting).toBe(true);
  });

  test("increments generation and keeps activity transitions pure", () => {
    let state = createInitialSessionRuntimeState();
    state = transitionActivityState(state, "working");
    expect(state.activityState).toBe("working");

    state = incrementGenerationTransition(state);
    state = incrementGenerationTransition(state);
    expect(state.generation).toBe(2);
  });
});

describe("coverage for remaining transitions", () => {
  test("stopProcessingTransition and transitionQueryState return to idle", () => {
    const { createInitialSessionRuntimeState, startProcessingTransition, stopProcessingTransition, transitionQueryState } = api;
    let state = startProcessingTransition(createInitialSessionRuntimeState());
    state = stopProcessingTransition(state);
    expect(state.queryState).toBe("idle");
    state = transitionQueryState(state, "aborting");
    expect(state.queryState).toBe("aborting");
  });

  test("endInterruptTransition clears the interrupting flag", () => {
    const { createInitialSessionRuntimeState, beginInterruptTransition, endInterruptTransition } = api;
    const begun = beginInterruptTransition(createInitialSessionRuntimeState());
    const ended = endInterruptTransition(begun.nextState);
    expect(ended.isInterrupting).toBe(false);
  });

  test("consuming a never-set interrupt flag reports not interrupted and preserves stopRequested", () => {
    const { createInitialSessionRuntimeState, requestStopDuringPreparingTransition, consumeInterruptFlagTransition } = api;
    const state = requestStopDuringPreparingTransition(createInitialSessionRuntimeState());
    const consumed = consumeInterruptFlagTransition(state);
    expect(consumed.wasInterrupted).toBe(false);
    expect(consumed.nextState.stopRequested).toBe(true); // only an actual interrupt clears it
  });
});

describe("predicate table + immutability contracts (review nice-to-have)", () => {
  test("both predicates across every QueryState", () => {
    const table: Array<[string, boolean, boolean]> = [
      // [queryState, isQueryProcessing, isQueryRunning]
      ["idle", false, false],
      ["preparing", true, false],
      ["running", true, true],
      ["aborting", true, true],
      ["completing", true, true],
    ];
    for (const [qs, processing, running] of table) {
      const state = api.transitionQueryState(api.createInitialSessionRuntimeState(), qs as api.QueryState);
      expect(api.isQueryProcessing(state)).toBe(processing);
      expect(api.isQueryRunning(state)).toBe(running);
    }
  });

  test("transitions never mutate their input state", () => {
    const initial = api.createInitialSessionRuntimeState();
    const frozen = Object.freeze({ ...initial });
    api.startProcessingTransition(frozen);
    api.startQueryTransition(frozen);
    api.requestStopDuringRunningTransition(frozen);
    api.markInterruptFlag(frozen);
    api.beginInterruptTransition(frozen);
    api.consumeInterruptFlagTransition(frozen);
    api.incrementGenerationTransition(frozen);
    expect(frozen).toEqual(initial); // frozen input unchanged — throws above if mutated in strict mode
  });
});
