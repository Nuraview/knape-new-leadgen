import { Cron } from "croner";
import { SCHEDULED_JOBS } from "./jobs";

const jobs: Cron[] = [];

/**
 * Croner does not catch rejections from an async handler, so anything that
 * throws inside a scheduled job becomes an unhandled rejection and, under
 * Node's default policy, kills the process.
 *
 * That is not hypothetical: a transient "Connection terminated due to
 * connection timeout" inside checkProjectWebhookReminders took the whole API
 * down. These jobs run every 5 minutes, so a brief database blip meant a full
 * outage — reminders are best-effort background work and must never be able to
 * stop the server from serving requests.
 */
export function guarded(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[scheduler] ${name} failed (continuing):`, error);
    }
  };
}

/**
 * In-process scheduling, for the long-lived VPS container only.
 *
 * The serverless deployment never calls this — a Vercel Function is torn down
 * between requests, so a croner timer registered inside one would be collected
 * before it ever fired. There the same jobs are driven over HTTP; see
 * ./jobs.ts and src/cron/index.ts.
 */
export function initializeScheduler(): void {
  for (const job of SCHEDULED_JOBS) {
    jobs.push(new Cron(job.schedule, guarded(job.name, job.run)));
  }

  console.log(
    `⏰ Scheduler started (${SCHEDULED_JOBS.length} jobs: ${SCHEDULED_JOBS.map((j) => j.name).join(", ")})`,
  );
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
