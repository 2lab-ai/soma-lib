/**
 * minute-cron-job — croner-free `CronJobFactory` built on the shared
 * cron-expression domain. First entry in the adapters layer (Step 3b).
 *
 * Model: poll on a short interval (default 20s) and fire AT MOST once per
 * calendar minute when the expression matches — the same once-per-minute
 * contract soma-work's CronScheduler implements with `lastRunMinute`. Firing
 * therefore happens within the matching minute, not at second 0 exactly
 * (croner fired at second 0; bot jobs are insensitive to sub-minute timing).
 *
 * Wall-clock modes:
 *   - 'local' (default): expressions are read against the process-local wall
 *     clock — parity with croner's default, which is what soma's cron.yaml
 *     was written against ("0 9 * * *" = 9am KST on the fable host).
 *   - 'utc': expressions are read in UTC — soma-work's model.
 * The domain engine itself is UTC-pure; 'local' is implemented by shifting
 * the evaluated Date by the timezone offset before matching (wall-clock
 * fields land in the UTC getters the engine reads).
 *
 * Divergences from croner, on purpose (documented in ROADMAP Step 3b):
 *   - 5-field numeric expressions only — no seconds field, no JAN/MON names,
 *     no @daily aliases. Creation throws on anything the shared
 *     `isValidCronExpression` rejects (stricter than croner).
 *   - dom/dow are ANDed like every other field (the shared engine's
 *     semantics), not OR-combined vixie-style when both are restricted.
 */
import type { CronJobFactory, CronTimers } from '../../ports/cron-scheduling';
export interface MinuteCronJobOptions {
    /** Injectable timers (tests). Defaults to global setInterval/clearInterval. */
    timers?: CronTimers;
    /** Injectable clock (tests). Defaults to () => new Date(). */
    now?: () => Date;
    /** How expressions read the clock. Default 'local' (croner parity). */
    wallClock?: 'local' | 'utc';
    /** Poll interval in ms. Default 20_000 (3 checks per minute). */
    pollIntervalMs?: number;
    /** Called when onTick throws/rejects — one bad run must not kill the timer. */
    onTickError?: (error: unknown) => void;
    /** How far nextRun() scans before giving up, in minutes. Default 366 days. */
    nextRunScanLimitMinutes?: number;
}
export declare function createMinuteCronJobFactory(options?: MinuteCronJobOptions): CronJobFactory;
