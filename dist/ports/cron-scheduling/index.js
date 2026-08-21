"use strict";
/**
 * cron-scheduling port — how an app hands recurring work to a scheduler.
 *
 * Formalizes the contract soma's scheduler already injected as
 * `SchedulerServiceDependencies.createCronJob` (previously satisfied by the
 * `croner` package). Adapters implement `CronJobFactory`; app code depends
 * only on these types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
