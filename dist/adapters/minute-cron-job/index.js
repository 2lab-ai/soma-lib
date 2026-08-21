"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMinuteCronJobFactory = createMinuteCronJobFactory;
const cron_expression_1 = require("../../domain/cron-expression");
const MINUTE_MS = 60000;
function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`minute-cron-job: ${name} must be a positive integer, got ${value}`);
    }
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
    const offsetOf = options.timezoneOffset ?? ((date) => date.getTimezoneOffset());
    requirePositiveInteger(pollIntervalMs, 'pollIntervalMs');
    requirePositiveInteger(scanLimit, 'nextRunScanLimitMinutes');
    /** Shift an instant so its UTC getters expose the configured wall clock. */
    const toWallClock = (date) => wallClock === 'utc' ? date : new Date(date.getTime() - offsetOf(date) * MINUTE_MS);
    const matchesAt = (expression, epochMs) => (0, cron_expression_1.matchesCronExpression)(expression, toWallClock(new Date(epochMs)));
    return (cronExpression, onTick) => {
        if (!(0, cron_expression_1.isValidCronExpression)(cronExpression)) {
            throw new Error(`minute-cron-job: invalid cron expression "${cronExpression}"`);
        }
        // Single scheduling cursor — see the file header for the full contract.
        let nextEligibleBoundary = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
        let stopped = false;
        const check = () => {
            if (stopped)
                return;
            const currentBoundary = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS;
            if (currentBoundary < nextEligibleBoundary)
                return; // current minute already handled (or creation minute)
            // Best-effort: evaluate ONLY the current minute; anything older was
            // missed while not polling and is skipped by advancing the cursor.
            nextEligibleBoundary = currentBoundary + MINUTE_MS;
            if (!matchesAt(cronExpression, currentBoundary))
                return;
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
