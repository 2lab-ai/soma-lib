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
/**
 * Match a 5-field cron expression (min hour dom mon dow) against a Date.
 * Supports: numbers, *, comma-separated lists, ranges (1-5), step values (star/N).
 */
export declare function matchesCronExpression(expression: string, date: Date): boolean;
export declare function isValidCronExpression(expression: string): boolean;
export declare function isValidCronName(name: string): boolean;
