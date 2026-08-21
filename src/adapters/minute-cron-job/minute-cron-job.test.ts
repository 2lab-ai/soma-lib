import { describe, expect, it, vi } from 'vitest';

import { createMinuteCronJobFactory } from './index';

// Deterministic clock + manual timer harness — no reliance on the process TZ:
// wallClock 'utc' everywhere except the dedicated local-mode/DST tests, which
// inject their own timezoneOffset function.
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

  it('rejects pathological options at factory creation', () => {
    expect(() => createMinuteCronJobFactory({ pollIntervalMs: 0 })).toThrow(/pollIntervalMs/);
    expect(() => createMinuteCronJobFactory({ pollIntervalMs: -5 })).toThrow(/pollIntervalMs/);
    expect(() => createMinuteCronJobFactory({ pollIntervalMs: 1.5 })).toThrow(/pollIntervalMs/);
    expect(() => createMinuteCronJobFactory({ pollIntervalMs: Number.NaN })).toThrow(/pollIntervalMs/);
    expect(() => createMinuteCronJobFactory({ nextRunScanLimitMinutes: 0 })).toThrow(/nextRunScanLimitMinutes/);
  });

  it('suppresses the creation minute (croner second-0 / restart parity)', () => {
    // A process restarting at HH:00:10 must NOT re-fire an hourly job whose
    // previous incarnation already fired at HH:00.
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:00:10Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    const job = factory('0 * * * *', () => {
      fired++;
    });
    harness.fireAll(); // still inside creation minute → suppressed
    clock = new Date('2026-03-28T09:00:55Z');
    harness.fireAll();
    expect(fired).toBe(0);
    // nextRun agrees: the next fire is the NEXT hour, not the creation minute
    expect(job.nextRun()?.toISOString()).toBe('2026-03-28T10:00:00.000Z');
    clock = new Date('2026-03-28T10:00:15Z');
    harness.fireAll();
    expect(fired).toBe(1);
  });

  it('fires exactly once per matching minute, regardless of poll count (dedup)', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:05Z');
    const fired: string[] = [];
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    factory('30 9 * * *', () => {
      fired.push(clock.toISOString());
    });

    clock = new Date('2026-03-28T09:30:05Z');
    harness.fireAll(); // first poll in matching minute → fires
    harness.fireAll(); // same minute → deduped
    clock = new Date('2026-03-28T09:30:45Z');
    harness.fireAll(); // still same minute → deduped
    expect(fired).toHaveLength(1);

    clock = new Date('2026-03-28T09:31:10Z');
    harness.fireAll(); // next minute, no match → silent
    expect(fired).toHaveLength(1);

    clock = new Date('2026-03-29T09:30:02Z');
    harness.fireAll(); // next day's matching minute → fires again
    expect(fired).toHaveLength(2);
  });

  it('skips minutes missed while not polling (best-effort, no catch-up)', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:05Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    factory('30 9 * * *', () => {
      fired++;
    });
    // Event loop stalls across the matching minute: next poll happens at 09:33.
    clock = new Date('2026-03-28T09:33:20Z');
    harness.fireAll();
    expect(fired).toBe(0); // 09:30 was missed → skipped, not fired late
    // And it does not fire on later non-matching minutes either
    clock = new Date('2026-03-28T09:34:20Z');
    harness.fireAll();
    expect(fired).toBe(0);
  });

  it('nextRun() reports the pending current-minute boundary before evaluation, and the next one after', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:30Z');
    const factory = createMinuteCronJobFactory({ timers: harness.timers, now: () => clock, wallClock: 'utc' });
    const job = factory('30 9 * * *', () => {});
    // 09:30 boundary is in the future and eligible
    expect(job.nextRun()?.toISOString()).toBe('2026-03-28T09:30:00.000Z');
    // Now inside 09:30, boundary not yet evaluated (no poll ran): still pending
    clock = new Date('2026-03-28T09:30:10Z');
    expect(job.nextRun()?.toISOString()).toBe('2026-03-28T09:30:00.000Z');
    // Poll evaluates (fires) the boundary → nextRun moves to tomorrow
    harness.fireAll();
    expect(job.nextRun()?.toISOString()).toBe('2026-03-29T09:30:00.000Z');
  });

  it('stop() halts firing, releases the timer, and nulls nextRun()', () => {
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

  it("wallClock 'local' evaluates against the injected wall clock (deterministic, TZ-independent)", () => {
    // Fixed UTC+9 (KST-like): getTimezoneOffset convention → -540.
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-27T23:59:30Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'local',
      timezoneOffset: () => -540,
    });
    const job = factory('0 9 * * *', () => {
      fired++;
    });
    // 09:00 local == 00:00 UTC — nextRun computed under local projection
    expect(job.nextRun()?.toISOString()).toBe('2026-03-28T00:00:00.000Z');
    clock = new Date('2026-03-28T00:00:10Z'); // 09:00:10 local
    harness.fireAll();
    expect(fired).toBe(1);
  });

  it('DST fall-back policy: each epoch minute fires once — a repeated wall label fires twice', () => {
    // Offset switches UTC+2 → UTC+1 at T=2026-10-25T01:00:00Z. Wall label
    // 02:30 occurs at UTC 00:30 (offset -120) AND UTC 01:30 (offset -60).
    const T = Date.parse('2026-10-25T01:00:00Z');
    const harness = makeTimerHarness();
    let clock = new Date('2026-10-24T23:00:10Z');
    const fired: string[] = [];
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'local',
      timezoneOffset: (d) => (d.getTime() < T ? -120 : -60),
    });
    factory('30 2 * * *', () => {
      fired.push(clock.toISOString());
    });
    // Walk every minute from 23:01Z to 02:00Z, polling at :05 past the boundary
    for (let t = Date.parse('2026-10-24T23:01:00Z'); t <= Date.parse('2026-10-25T02:00:00Z'); t += 60_000) {
      clock = new Date(t + 5_000);
      harness.fireAll();
    }
    expect(fired).toEqual(['2026-10-25T00:30:05.000Z', '2026-10-25T01:30:05.000Z']);
  });

  it('DST spring-forward policy: nonexistent wall labels are skipped', () => {
    // Offset switches UTC+1 → UTC+2 at T=2026-03-29T01:00:00Z. Wall labels
    // 02:00–02:59 never occur (01:59+1h → 03:00+2h).
    const T = Date.parse('2026-03-29T01:00:00Z');
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T23:30:10Z');
    let fired = 0;
    const factory = createMinuteCronJobFactory({
      timers: harness.timers,
      now: () => clock,
      wallClock: 'local',
      timezoneOffset: (d) => (d.getTime() < T ? -60 : -120),
    });
    const job = factory('30 2 * * *', () => {
      fired++;
    });
    for (let t = Date.parse('2026-03-28T23:31:00Z'); t <= Date.parse('2026-03-29T03:00:00Z'); t += 60_000) {
      clock = new Date(t + 5_000);
      harness.fireAll();
    }
    expect(fired).toBe(0);
    // nextRun agrees: the next 02:30 label is the following day (UTC 00:30 under +2)
    expect(job.nextRun()?.toISOString()).toBe('2026-03-30T00:30:00.000Z');
  });

  it('a throwing onTick reaches onTickError and does not kill the schedule', () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:00Z');
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
    clock = new Date('2026-03-28T09:30:05Z');
    harness.fireAll();
    expect(errors).toHaveLength(1);
    clock = new Date('2026-03-28T10:30:05Z');
    harness.fireAll();
    expect(calls).toBe(2); // schedule survived the throw
  });

  it('a rejecting async onTick reaches onTickError', async () => {
    const harness = makeTimerHarness();
    let clock = new Date('2026-03-28T09:29:00Z');
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
    clock = new Date('2026-03-28T09:30:05Z');
    harness.fireAll();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
  });
});
