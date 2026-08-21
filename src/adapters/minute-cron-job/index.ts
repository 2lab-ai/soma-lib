/**
 * minute-cron-job — croner-free `CronJobFactory` built on the shared
 * cron-expression domain. First entry in the adapters layer (Step 3b).
 *
 * ## Evaluation contract (one state machine, v0.4.1)
 *
 * All scheduling state is a single epoch-milliseconds cursor,
 * `nextEligibleBoundary`. Each poll evaluates AT MOST the current calendar
 * minute's boundary, exactly once:
 *
 *   - **Creation minute is suppressed.** The first eligible boundary is the
 *     next minute boundary after creation — croner parity (its second-0 for
 *     the creation minute is already in the past), and a process restart
 *     right after a fire cannot double-fire the same minute.
 *   - **Exactly-once per epoch minute.** A boundary is evaluated once; the
 *     cursor then moves past it. Because the cursor is epoch-based, dedup is
 *     immune to wall-clock label games (see DST below).
 *   - **Best-effort, no catch-up.** If polling stalls across one or more
 *     boundaries (blocked event loop, laptop sleep), only the CURRENT minute's
 *     boundary is evaluated on resume; missed boundaries are skipped, never
 *     fired late. (croner similarly does not replay callbacks missed while
 *     the loop was blocked.)
 *   - **`nextRun()` derives from the same cursor**: it returns the first
 *     matching boundary the check loop can still actually fire — including
 *     the current minute's boundary while it is pending — or null.
 *
 * Firing therefore happens within the matching minute (at the first poll at
 * or after its boundary), not at second 0 exactly. Bot jobs are insensitive
 * to sub-minute timing.
 *
 * ## Wall-clock modes
 *
 *   - 'local' (default): expressions read the process-local wall clock —
 *     croner-default parity; soma's cron.yaml ("0 9 * * *" = 9am on the
 *     host) was written against this.
 *   - 'utc': expressions read UTC — soma-work's model.
 *
 * The domain engine is UTC-pure; 'local' shifts the evaluated instant by its
 * own timezone offset so wall-clock fields land in the UTC getters. The
 * offset source is injectable (`timezoneOffset`) so DST behavior is testable
 * deterministically.
 *
 * **DST policy (local mode)**: every epoch minute is evaluated exactly once
 * against its wall-clock label. On fall-back, repeated wall labels belong to
 * two distinct epoch minutes, so a schedule matching that label fires twice
 * (both real instants). On spring-forward, nonexistent labels are skipped.
 * Both current deployments are DST-free (KST host / UTC mode), so this
 * policy chooses predictability over vixie-style repeat suppression.
 *
 * ## Divergences from croner, on purpose (ROADMAP Step 3b)
 *
 *   - 5-field numeric expressions only — no seconds field, no JAN/MON names,
 *     no @daily aliases. Creation throws on anything the shared
 *     `isValidCronExpression` rejects (stricter than croner).
 *   - dom/dow are ANDed like every other field, not OR-combined vixie-style.
 *   - Sub-minute firing time (within the minute, not second 0).
 */

import { isValidCronExpression, matchesCronExpression } from '../../domain/cron-expression';
import type { CronJobFactory, CronJobHandle, CronTimers } from '../../ports/cron-scheduling';

export interface MinuteCronJobOptions {
  /** Injectable timers (tests). Defaults to global setInterval/clearInterval. */
  timers?: CronTimers;
  /** Injectable clock (tests). Defaults to () => new Date(). */
  now?: () => Date;
  /** How expressions read the clock. Default 'local' (croner parity). */
  wallClock?: 'local' | 'utc';
  /** Poll interval in ms. Default 20_000 (3 checks per minute). Positive integer. */
  pollIntervalMs?: number;
  /** Called when onTick throws/rejects — one bad run must not kill the timer. */
  onTickError?: (error: unknown) => void;
  /**
   * How far nextRun() scans before returning null, in minutes. Default 366
   * days. Positive integer. null from nextRun() means "no matching minute
   * within this horizon" (see ports/cron-scheduling).
   */
  nextRunScanLimitMinutes?: number;
  /**
   * Timezone offset in minutes for 'local' mode (Date#getTimezoneOffset
   * convention: UTC+9 → -540), per evaluated instant. Injectable so DST
   * transitions are deterministically testable. Defaults to the instant's own
   * `getTimezoneOffset()`.
   */
  timezoneOffset?: (date: Date) => number;
}

const MINUTE_MS = 60_000;

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`minute-cron-job: ${name} must be a positive integer, got ${value}`);
  }
}

export function createMinuteCronJobFactory(options: MinuteCronJobOptions = {}): CronJobFactory {
  // The lib compiles against pure ES2020 (no Node/DOM ambient types), so the
  // default timers go through globalThis — present in Node, Bun, and browsers.
  const g = globalThis as unknown as {
    setInterval: (handler: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
  const timers: CronTimers = options.timers ?? {
    setInterval: (handler, ms) => g.setInterval(handler, ms),
    clearInterval: (handle) => g.clearInterval(handle),
  };
  const now = options.now ?? (() => new Date());
  const wallClock = options.wallClock ?? 'local';
  const pollIntervalMs = options.pollIntervalMs ?? 20_000;
  const scanLimit = options.nextRunScanLimitMinutes ?? 366 * 24 * 60;
  const offsetOf = options.timezoneOffset ?? ((date: Date) => date.getTimezoneOffset());
  requirePositiveInteger(pollIntervalMs, 'pollIntervalMs');
  requirePositiveInteger(scanLimit, 'nextRunScanLimitMinutes');

  /** Shift an instant so its UTC getters expose the configured wall clock. */
  const toWallClock = (date: Date): Date =>
    wallClock === 'utc' ? date : new Date(date.getTime() - offsetOf(date) * MINUTE_MS);

  const matchesAt = (expression: string, epochMs: number): boolean =>
    matchesCronExpression(expression, toWallClock(new Date(epochMs)));

  return (cronExpression: string, onTick: () => void | Promise<void>): CronJobHandle => {
    if (!isValidCronExpression(cronExpression)) {
      throw new Error(`minute-cron-job: invalid cron expression "${cronExpression}"`);
    }

    // Single scheduling cursor — see the file header for the full contract.
    let nextEligibleBoundary = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    let stopped = false;

    const check = () => {
      if (stopped) return;
      const currentBoundary = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS;
      if (currentBoundary < nextEligibleBoundary) return; // current minute already handled (or creation minute)
      // Best-effort: evaluate ONLY the current minute; anything older was
      // missed while not polling and is skipped by advancing the cursor.
      nextEligibleBoundary = currentBoundary + MINUTE_MS;
      if (!matchesAt(cronExpression, currentBoundary)) return;
      try {
        const result = onTick();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((error) => options.onTickError?.(error));
        }
      } catch (error) {
        options.onTickError?.(error);
      }
    };

    const handle = timers.setInterval(check, pollIntervalMs);

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        timers.clearInterval(handle);
      },
      nextRun() {
        if (stopped) return null;
        // Consistent with check(): the earliest boundary that can still fire
        // is the current minute's boundary if it is still eligible (pending
        // evaluation at the next poll), else the cursor; older eligible
        // boundaries can never fire (best-effort skip).
        const currentBoundary = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS;
        const start = Math.max(nextEligibleBoundary, currentBoundary);
        for (let i = 0; i < scanLimit; i++) {
          const candidate = start + i * MINUTE_MS;
          if (matchesAt(cronExpression, candidate)) {
            return new Date(candidate);
          }
        }
        return null;
      },
    };
  };
}
