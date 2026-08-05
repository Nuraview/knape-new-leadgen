/**
 * Reach the OWNER, and only the owner.
 *
 * Two alerts are for whoever runs the business, not for the team: an employee's
 * clock pausing, and lead ingestion stopping. Both were going to the wrong
 * place. The work-clock alert wrote to WhatsApp and nothing else, so while the
 * bridge has been unpaired since 13 July it reached nobody at all. The lead-flow
 * alert used the broadcast helper, which would have told every employee the
 * scraper was unhappy — noise they can do nothing about, and noise is what
 * teaches people to ignore a channel.
 *
 * So: resolve the admins and push to each of them individually.
 *
 * Admin is read from user_access.level rather than a hardcoded email. VK's
 * address has already changed once in this project's life, and an alerting path
 * that silently points at a stale address is worse than one that is obviously
 * missing.
 */
import { eq } from "drizzle-orm";
import db from "../database";
import { userAccessTable, userTable } from "../database/schema";
import { resolveCrmActorId } from "../lead/crm-actor";
import { sendPushToUser } from "../dialer/push";

/** Levels that mean "runs the business". */
const OWNER_LEVELS = new Set(["full", "admin", "owner"]);

/**
 * Push to every admin. Never throws — an alerting failure must not abort the
 * thing that raised the alert, which for the work clock is a penalty write.
 */
export async function notifyOwners(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<{ delivered: number }> {
  let delivered = 0;

  try {
    const admins = await db
      .select({ email: userTable.email, level: userAccessTable.level })
      .from(userAccessTable)
      .innerJoin(userTable, eq(userTable.id, userAccessTable.userId));

    for (const admin of admins) {
      if (!OWNER_LEVELS.has(admin.level)) continue;
      if (!admin.email) continue;

      // Push subscriptions key on the CRM actor id, the work clock on the app
      // user id; email is the only thing both sides share.
      const crmUserId = await resolveCrmActorId(admin.email);
      if (!crmUserId) continue;

      const result = await sendPushToUser(crmUserId, {
        type: "generic",
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/",
        tag: payload.tag ?? "nuraview",
        timestamp: new Date().toISOString(),
      });
      delivered += result.sent;
    }
  } catch (error) {
    console.error("[notify-owners] failed:", error);
  }

  return { delivered };
}

export default notifyOwners;
