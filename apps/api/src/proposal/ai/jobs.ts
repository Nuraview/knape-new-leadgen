/**
 * The queue behind "Draft with AI".
 *
 * Writing a proposal takes a minute or two — mostly gpt-5 reasoning before it
 * emits a visible token. Holding an HTTP request open that long works, but it
 * puts a person in front of a spinner with nothing to do, and any refresh or
 * flaky connection throws the work away.
 *
 * So the route enqueues and returns, and the browser polls this row.
 *
 * IN-PROCESS, deliberately. The obvious alternative is the self-hosted Inngest
 * on the VPS, which is genuinely more durable — but its functions live in
 * another repository, so that is a cross-repo change for work that takes ninety
 * seconds and is retried by pressing a button again. The cost of staying in
 * process is that a deploy mid-draft abandons the job; that is handled by
 * failing stale rows at boot (migrate-crm-proposal-columns.ts) rather than
 * leaving them RUNNING for ever.
 */
import { and, eq, sql } from "drizzle-orm";
import crmDb from "../../database/crm";
import { crmProposalAiJobs } from "../../database/crm-schema";

export type JobKind = "DRAFT" | "BRIEF" | "REGENERATE";
export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type JobRow = {
  id: string;
  kind: string;
  status: string;
  leadId: string | null;
  proposalId: string | null;
  error: string | null;
  warnings: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * How long a job may sit before a poller should stop believing in it.
 *
 * The OpenAI call itself gives up at 180s, so anything past this has died in a
 * way that did not get to write FAILED — a hard crash, or the process being
 * killed between the two writes.
 */
export const JOB_STALE_MS = 5 * 60_000;

export async function createJob(input: {
  kind: JobKind;
  leadId?: string | null;
  proposalId?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await crmDb.insert(crmProposalAiJobs).values({
    id,
    kind: input.kind,
    status: "PENDING",
    leadId: input.leadId ?? null,
    proposalId: input.proposalId ?? null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function setStatus(
  id: string,
  status: JobStatus,
  patch: Partial<{
    proposalId: string | null;
    error: string | null;
    warnings: unknown;
    meta: unknown;
  }> = {},
) {
  await crmDb
    .update(crmProposalAiJobs)
    .set({
      status,
      updatedAt: new Date(),
      ...(patch.proposalId !== undefined ? { proposalId: patch.proposalId } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.warnings !== undefined
        ? { warnings: patch.warnings as never }
        : {}),
      ...(patch.meta !== undefined ? { meta: patch.meta as never } : {}),
    })
    .where(eq(crmProposalAiJobs.id, id));
}

export async function getJob(id: string): Promise<JobRow | null> {
  const [row] = await crmDb
    .select()
    .from(crmProposalAiJobs)
    .where(eq(crmProposalAiJobs.id, id))
    .limit(1);
  if (!row) return null;

  /*
   * Report a job that died without writing FAILED as failed.
   *
   * Read-time rather than by a sweeper: the only thing that cares is the
   * browser polling it, and a stale row is harmless until somebody looks.
   */
  if (
    (row.status === "PENDING" || row.status === "RUNNING") &&
    Date.now() - row.updatedAt.getTime() > JOB_STALE_MS
  ) {
    await setStatus(row.id, "FAILED", {
      error: "The draft stopped responding. Try again.",
    }).catch(() => {});
    return { ...(row as JobRow), status: "FAILED", error: "The draft stopped responding. Try again." };
  }

  return row as JobRow;
}

/** Is this lead already being drafted? Stops a double-click costing twice. */
export async function findActiveJobForLead(
  leadId: string,
): Promise<JobRow | null> {
  const [row] = await crmDb
    .select()
    .from(crmProposalAiJobs)
    .where(
      and(
        eq(crmProposalAiJobs.leadId, leadId),
        sql`${crmProposalAiJobs.status} IN ('PENDING','RUNNING')`,
        sql`${crmProposalAiJobs.updatedAt} > now() - interval '5 minutes'`,
      ),
    )
    .limit(1);
  return (row as JobRow) ?? null;
}

/**
 * Run `work` in the background and record how it went.
 *
 * Never rejects. An unhandled rejection from a detached promise takes the whole
 * API process down, which would turn one failed proposal into an outage — so
 * everything is caught, and a failure to even record the failure is swallowed
 * after being logged.
 */
export function runJob(
  id: string,
  work: () => Promise<{
    proposalId: string;
    warnings: string[];
    meta: Record<string, unknown>;
  }>,
): void {
  void (async () => {
    try {
      await setStatus(id, "RUNNING");
      const result = await work();
      await setStatus(id, "COMPLETED", {
        proposalId: result.proposalId,
        warnings: result.warnings,
        meta: result.meta,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The draft failed.";
      console.error(`[proposal-ai] job ${id} failed:`, message);
      await setStatus(id, "FAILED", { error: message }).catch((e) => {
        console.error(`[proposal-ai] could not record failure for ${id}:`, e);
      });
    }
  })();
}
