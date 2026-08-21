"use strict";
/**
 * cron-expression — pure domain for 5-field cron expression semantics.
 *
 * Extracted verbatim from soma-work `somalib/cron/cron-storage.ts` (Step 3,
 * 2026-08-21) where the hand-rolled engine lived tangled with the storage
 * adapter. Pure functions, no I/O — the scheduling POLICY (polling loops,
 * timers, dedup, misfire handling) and the job model stay in the apps.
 *
 * Semantics: expressions are evaluated in UTC (see the B1 test family —
 * server-local timezones must never shift a match). Day-of-week accepts both
 * 0 and 7 for Sunday.
 *
 * Consumers:
 *   - soma-work: CronScheduler polls every minute and calls
 *     `matchesCronExpression(job.expression, now)`; the Slack cron UI calls
 *     `isValidCronExpression` / `isValidCronName` on user input.
 *   - soma: still schedules with the `croner` package (timer-based, its own
 *     syntax surface). Migrating soma's scheduler onto this engine is a
 *     deliberate future step (see ROADMAP backlog), not smuggled in here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesCronExpression = matchesCronExpression;
exports.isValidCronExpression = isValidCronExpression;
exports.isValidCronName = isValidCronName;
/**
 * Match a 5-field cron expression (min hour dom mon dow) against a Date.
 * Supports: numbers, *, comma-separated lists, ranges (1-5), step values (star/N).
 */
function matchesCronExpression(expression, date) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    // Use UTC methods — cron expressions are evaluated in UTC
    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const dom = date.getUTCDate();
    const month = date.getUTCMonth() + 1; // 1-based
    const dow = date.getUTCDay(); // 0=Sunday
    // Day-of-week: 0 and 7 both mean Sunday. Evaluate Sunday under BOTH aliases
    // so ranges and steps honor the contract too — `5-7` and `5-7/1` must match
    // Sunday (runtime value 0), not just the exact number `7`. (Fixed in
    // v0.3.1 — the origin implementation aliased exact numbers only, silently
    // skipping Sunday for ranges ending in 7, diverging from standard cron.)
    const dowMatches = matchField(fields[4], dow, 0, 7) || (dow === 0 && matchField(fields[4], 7, 0, 7));
    return (matchField(fields[0], minute, 0, 59) &&
        matchField(fields[1], hour, 0, 23) &&
        matchField(fields[2], dom, 1, 31) &&
        matchField(fields[3], month, 1, 12) &&
        dowMatches);
}
function matchField(field, value, min, max) {
    // Handle comma-separated values
    const parts = field.split(',');
    return parts.some((part) => matchPart(part.trim(), value, min, max));
}
function matchPart(part, value, min, max) {
    // Wildcard
    if (part === '*')
        return true;
    // Step: */N or range/N
    if (part.includes('/')) {
        const [rangePart, stepStr] = part.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0)
            return false;
        let start = min;
        let end = max;
        if (rangePart !== '*') {
            if (rangePart.includes('-')) {
                [start, end] = rangePart.split('-').map(Number);
            }
            else {
                start = parseInt(rangePart, 10);
            }
        }
        for (let i = start; i <= end; i += step) {
            if (i === value)
                return true;
        }
        return false;
    }
    // Range: N-M
    if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        return value >= start && value <= end;
    }
    // Exact number. (Sunday 0===7 aliasing happens at the field level in
    // matchesCronExpression — the value is evaluated under both aliases — so
    // no special case is needed here.)
    const num = parseInt(part, 10);
    return num === value;
}
function isValidCronExpression(expression) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    // Regex: *, N, N-M, */N, N-M/N, comma-separated combinations
    const cronFieldRegex = /^((\*|\d+(-\d+)?)(\/\d+)?)(,((\*|\d+(-\d+)?)(\/\d+)?))*$/;
    if (!fields.every((f) => cronFieldRegex.test(f)))
        return false;
    // Range validation per field: [min, max]
    const ranges = [
        [0, 59], // minute
        [0, 23], // hour
        [1, 31], // day of month
        [1, 12], // month
        [0, 7], // day of week (0 and 7 = Sunday)
    ];
    for (let i = 0; i < 5; i++) {
        const [min, max] = ranges[i];
        const parts = fields[i].split(',');
        for (const part of parts) {
            // Check step value: */0 is invalid (division by zero)
            if (part.includes('/')) {
                const step = parseInt(part.split('/')[1], 10);
                if (isNaN(step) || step <= 0)
                    return false;
            }
            // Check reversed ranges: 5-1 is invalid
            if (part.includes('-') && !part.startsWith('*')) {
                const rangePart = part.split('/')[0]; // strip step
                const [startStr, endStr] = rangePart.split('-');
                const start = parseInt(startStr, 10);
                const end = parseInt(endStr, 10);
                if (!isNaN(start) && !isNaN(end) && start > end)
                    return false;
            }
        }
        // Check numeric values in range
        const nums = fields[i].match(/\d+/g);
        if (nums &&
            nums.some((n) => {
                const v = parseInt(n, 10);
                return v < min || v > max;
            })) {
            return false;
        }
    }
    return true;
}
function isValidCronName(name) {
    return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}
