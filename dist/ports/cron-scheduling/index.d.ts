/**
 * cron-scheduling port — how an app hands recurring work to a scheduler.
 *
 * Formalizes the contract soma's scheduler already injected as
 * `SchedulerServiceDependencies.createCronJob` (previously satisfied by the
 * `croner` package). Adapters implement `CronJobFactory`; app code depends
 * only on these types.
 */
/** A scheduled recurring job. */
export interface CronJobHandle {
    /** Stop firing and release timers. Idempotent. */
    stop(): void;
    /** Next time this job will fire, or null when it never will again. */
    nextRun(): Date | null;
}
/**
 * Create a scheduled job from a 5-field cron expression. MUST throw on an
 * invalid expression (callers rely on creation-time failure, not silent
 * never-firing jobs).
 */
export type CronJobFactory = (cronExpression: string, onTick: () => void | Promise<void>) => CronJobHandle;
/** Timer functions an adapter needs — injectable for tests. */
export interface CronTimers {
    setInterval: (handler: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
}
