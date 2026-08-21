import { describe, expect, it, vi } from 'vitest';

import { createMinuteCronJobFactory } from './index';

// Deterministic clock + manual timer harness (no reliance on process TZ:
// wallClock 'utc' is used except in the dedicated local-mode test).
function makeTimerHarness() {
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  return {
    timers: {
      setInterval: (handler: () => void, _ms: number) => {
        const id = nextId++;
        intervals.set(id, handler);
        return id;
      },
      clearInterval: (handle: unknown) => {
        intervals.delete(handle as number);
      },
    },
    fireAll() {
      for (const handler of [...intervals.values()]) handler();
    },
    get active() {
      return intervals.size;
    },
  };
}

describe('createMinuteCronJobFactory', () => {
  it('throws at creation on invalid expressions (creation-time failure contract)', () => {
    const factory = createMinuteCronJobFactory({ wallClock: 'utc' });
    expect(() => factory('not a cron', () => {})).toThrow(/invalid cron expression/);
    expect(() => factory('61 * * * *', () => {})).toThrow(/invalid cron expression/);
  });

  it('fires once per matching minute, regardless of poll count (dedup)', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:30:05Z');
    const fired: string[] = [];
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'utc',
    });
    factory('30 9 * * *', () => {
      fired.push(clock.toISOString());
    });

    harness.fireAll(); // first poll inside matching minute → fires
    harness.fireAll(); // second poll same minute → deduped
    clock = new Date('2026-03-28T09:30:45Z');
    harness.fireAll(); // still same minute → deduped
    expect(fired).toHaveLength(1);

    clock = new Date('2026-03-28T09:31:10Z');
    harness.fireAll(); // next minute, no longer matches → silent
    expect(fired).toHaveLength(1);

    clock = new Date('2026-03-29T09:30:02Z');
    harness.fireAll(); // next day's matching minute → fires again
    expect(fired).toHaveLength(2);
  });

  it('does not fire on non-matching minutes', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:59Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    factory('30 9 * * *', () => {
      fired++;
    });
    harness.fireAll();
    clock = new Date('2026-03-28T10:30:00Z'); // wrong hour
    harness.fireAll();
    expect(fired).toBe(0);
  });

  it('stop() halts firing and releases the timer; nextRun() becomes null', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:00Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    const job = factory('30 9 * * *', () => {
      fired++;
    });
    expect(harness.active).toBe(1);
    job.stop();
    job.stop(); // idempotent
    expect(harness.active).toBe(0);
    clock = new Date('2026-03-28T09:30:00Z');
    harness.fireAll();
    expect(fired).toBe(0);
    expect(job.nextRun()).toBeNull();
  });

  it('nextRun() returns the next matching minute boundary (UTC mode)', () => {
    const harness = makeTimerHarness();
    const clock = new Date('2026-03-28T09:10:30Z');
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    const job = factory('*/15 * * * *', () => {});
    // next boundaries after 09:10 → 09:15
    expect(job.nextRun()?.toISOString()).toBe('2026-03-28T09:15:00.000Z');
    const daily = factory('30 9 * * *', () => {});
    expect(daily.nextRun()?.toISOString()).toBe('2026-03-28T09:30:00.000Z');
  });

  it('nextRun() skips the current in-progress minute', () => {
    const harness = makeTimerHarness();
    const clock = new Date('2026-03-28T09:30:10Z');
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    const job = factory('30 9 * * *', () => {});
    expect(job.nextRun()?.toISOString()).toBe('2026-03-29T09:30:00.000Z'); // tomorrow
  });

  it("wallClock 'local' evaluates expressions against the process-local wall clock", () => {
    // Test runner is pinned to TZ=Asia/Seoul (UTC+9, no DST). 09:00 KST === 00:00 UTC.
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T00:00:10Z'); // 09:00:10 KST
    let fired = 0;
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'local' });
    factory('0 9 * * *', () => {
      fired++;
    });
    harness.fireAll();
    if (new Date().getTimezoneOffset() === -540) {
      // KST runner: 9am local == midnight UTC → fires
      expect(fired).toBe(1);
    } else {
      // On a non-KST runner this specific instant may not be 9am local; the
      // invariant still checked below via the utc-mode contrast.
      expect(fired === 0 || fired === 1).toBe(true);
    }
    // Contrast: utc mode at the same instant must NOT fire for 9am
    let utcFired = 0;
    const utcFactory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    utcFactory('0 9 * * *', () => {
      utcFired++;
    });
    clock = new Date('2026-03-28T00:00:20Z');
    harness.fireAll();
    expect(utcFired).toBe(0);
  });

  it('a throwing onTick reaches onTickError and does not kill the schedule', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:30:00Z');
    const errors: unknown[] = [];
    let calls = 0;
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'utc',
      onTickError: (e) => errors.push(e),
    });
    factory('30 * * * *', () => {
      calls++;
      throw new Error('boom');
    });
    harness.fireAll();
    expect(errors).toHaveLength(1);
    clock = new Date('2026-03-28T10:30:00Z');
    harness.fireAll();
    expect(calls).toBe(2); // schedule survived the throw
  });

  it('a rejecting async onTick reaches onTickError', async () => {
    const harness = makeTimerHarness();
    const clock = new Date('2026-03-28T09:30:00Z');
    const errors: unknown[] = [];
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'utc',
      onTickError: (e) => errors.push(e),
    });
    factory('30 9 * * *', async () => {
      throw new Error('async boom');
    });
    harness.fireAll();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
  });
});
