/**
 * Proposals — read surface.
 *
 * Ported from apps/web/app/(routes)/proposals + data/get-proposals.ts, which
 * went through the Prisma-compat facade. Here it is plain Drizzle against the
 * CRM database.
 *
 * SCOPE, stated plainly: this is the list, the detail and the activity trail —
 * everything needed to find a proposal and read it. The authoring side (the
 * Tiptap section editor, pricing editor, portfolio manager), PDF generation
 * (puppeteer, which needs the Node sidecar) and the public client-facing share
 * page with its approve/reject/PayPal routes are NOT here yet and still run on
 * the legacy app.
 *
 * That split is deliberate rather than an accident of time: the public share
 * links and PayPal callbacks are URLs already sitting in clients' inboxes, so
 * they move once — at cutover, together, after being replayed — not piecemeal.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import ai from "./ai";
import write from "./write";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import { requireCrmAccess } from "../utils/require-crm-access";
import payments from "./payments";

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

const proposal = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)
  /** List. Templates are a separate view (isTemplate), same table. */
  .get("/", async (c) => {
    const templates = c.req.query("templates") === "1";

    const items = rows(
      await crmDb.execute(sql`
        SELECT id, number, title, status, "clientName", "clientCompany",
               "clientEmail", currency, "grandTotal", "isTemplate",
               "templateName", "shareToken" IS NOT NULL AS is_shared,
               "sentAt", "firstViewedAt", "lastViewedAt", "viewCount",
               "decisionAt", "expiresAt", "paidAt", "createdAt"
          FROM "crm_Proposals"
         WHERE "deletedAt" IS NULL
           AND "isTemplate" = ${templates}
         ORDER BY "createdAt" DESC
         LIMIT 100
      `),
    );

    return c.json({ items });
  })
  /**
   * One proposal with its children.
   *
   * Loaded as explicit queries rather than a join: the legacy code notes that
   * the compat facade never reliably hydrated `include` for these tables, and
   * the row counts here are tiny (22 proposals in production).
   */
  .get("/:id", async (c) => {
    const id = c.req.param("id");

    const [head] = rows(
      await crmDb.execute(sql`
        SELECT * FROM "crm_Proposals"
         WHERE id = ${id}::uuid AND "deletedAt" IS NULL
         LIMIT 1
      `),
    );

    if (!head) throw new HTTPException(404, { message: "PROPOSAL_NOT_FOUND" });

    const [lineItems, assets, activity] = await Promise.all([
      crmDb.execute(sql`
        SELECT * FROM "crm_Proposal_LineItems"
         WHERE "proposalId" = ${id}::uuid ORDER BY position ASC
      `),
      crmDb.execute(sql`
        SELECT * FROM "crm_Proposal_Assets"
         WHERE "proposalId" = ${id}::uuid ORDER BY position ASC
      `),
      crmDb.execute(sql`
        SELECT * FROM "crm_Proposal_Activity"
         WHERE "proposalId" = ${id}::uuid ORDER BY "createdAt" DESC LIMIT 100
      `),
    ]);

    return c.json({
      ...head,
      lineItems: rows(lineItems),
      assets: rows(assets),
      activity: rows(activity),
    });
  });


// AI drafting. Mounted BEFORE the authoring router: its paths (/ai/... and
// /:id/ai/...) do not collide with anything in there today, and registering it
// first means a future POST /:id/:action cannot start swallowing them.
proposal.route("/", ai);
// Authoring: create / update / share / duplicate / template / delete.
// Mounted at the root so POST /proposal and PATCH /proposal/:id sit alongside
// the existing GETs without either file having to know about the other's routes.
proposal.route("/", write);
// Stripe Checkout for deposits and balances.
proposal.route("/", payments);

export default proposal;
