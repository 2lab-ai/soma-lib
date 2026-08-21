"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMinuteCronJobFactory = createMinuteCronJobFactory;
const cron_expression_1 = require("../../domain/cron-expression");
/** Shift a Date so its UTC getters expose process-local wall-clock fields. */
function toWallClock(date, mode) {
    if (mode === 'utc')
        return date;
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
}
/** Calendar-minute key of a Date under the given wall-clock mode. */
function minuteKey(date, mode) {
    return toWallClock(date, mode).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}
function createMinuteCronJobFactory(options = {}) {
    // The lib compiles against pure ES2020 (no Node/DOM ambient types), so the
    // default timers go through globalThis — present in Node, Bun, and browsers.
    const g = globalThis;
    const timers = options.timers ?? {
        setInterval: (handler, ms) => g.setInterval(handler, ms),
        clearInterval: (handle) => g.clearInterval(handle),
    };
    const now = options.now ?? (() => new Date());
    const wallClock = options.wallClock ?? 'local';
    const pollIntervalMs = options.pollIntervalMs ?? 20000;
    const scanLimit = options.nextRunScanLimitMinutes ?? 366 * 24 * 60;
    return (cronExpression, onTick) => {
        if (!(0, cron_expression_1.isValidCronExpression)(cronExpression)) {
            throw new Error(`minute-cron-job: invalid cron expression "${cronExpression}"`);
        }
        // Never fire for the minute the job was created in twice; start with the
        // current minute unevaluated so a job created mid-minute can still fire
        // within it (croner behaved the same for second-0-in-the-future).
        let lastFiredMinute = null;
        let stopped = false;
        const check = () => {
            if (stopped)
                return;
            const current = now();
            const key = minuteKey(current, wallClock);
            if (key === lastFiredMinute)
                return;
            if (!(0, cron_expression_1.matchesCronExpression)(cronExpression, toWallClock(current, wallClock)))
                return;
            lastFiredMinute = key;
            try {
                const result = onTick();
                if (result && typeof result.catch === 'function') {
                    result.catch((error) => options.onTickError?.(error));
                }
            }
            catch (error) {
                options.onTickError?.(error);
            }
        };
        const handle = timers.setInterval(check, pollIntervalMs);
        return {
            stop() {
                if (stopped)
                    return;
                stopped = true;
                timers.clearInterval(handle);
            },
            nextRun() {
                if (stopped)
                    return null;
                const start = now();
                // Scan forward from the NEXT minute boundary — nextRun() means the
                // next future fire, not the possibly-in-progress current minute.
                const firstBoundary = Math.floor(start.getTime() / 60000) * 60000 + 60000;
                for (let i = 0; i < scanLimit; i++) {
                    const candidate = new Date(firstBoundary + i * 60000);
                    if ((0, cron_expression_1.matchesCronExpression)(cronExpression, toWallClock(candidate, wallClock))) {
                        return candidate;
                    }
                }
                return null;
            },
        };
    };
}
