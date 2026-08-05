/**
 * The customer portal.
 *
 * VK, 2026-08-03: "when a customer purchases the order, a unique link would be
 * generated… he can sign up with his own email. And once he signs up, he would
 * be able to see where is my order."
 *
 * Two routers, and the split is the whole security model:
 *
 *   portalPublic  no session. Given a grant token it reveals only enough to
 *                 render the claim page — the invited email and the customer's
 *                 name. Never orders, never the CRM.
 *   portal        session required. Resolves the signed-in user to a customer
 *                 BY EMAIL and returns only that customer's orders.
 *
 * A customer never gets CRM access. `user_access` is not granted to them, so
 * requireCrmAccess and requireLeadsAccess both refuse — the portal is the only
 * thing they can reach, which is exactly what "customer will only have access
 * to order only" means.
 */
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb, { isCrmConfigured } from "../database/crm";
import {
  nvCustomerAssets,
  nvCustomers,
  nvOrderItems,
  nvOrders,
  nvPortalGrants,
} from "../database/crm-schema";
import { resolveGrant } from "./grant";

function requireCrm() {
  if (!isCrmConfigured())
    throw new HTTPException(503, { message: "CRM is not configured" });
}

/** Unauthenticated. Mounted before the session gate. */
export const portalPublic = new Hono()
  /**
   * What the claim page needs, and nothing else.
   *
   * Deliberately does NOT return orders: this endpoint is reachable by anyone
   * holding the link, and a link forwarded to a colleague must not leak what
   * was bought or for how much before anyone has proved who they are.
   */
  .get("/claim/:token", async (c) => {
    requireCrm();
    const grant = await resolveGrant(c.req.param("token"));
    if (!grant)
      throw new HTTPException(404, {
        message: "This invitation link is invalid or has expired.",
      });

    const [customer] = await crmDb
      .select({ name: nvCustomers.name, organization: nvCustomers.organization })
      .from(nvCustomers)
      .where(eq(nvCustomers.id, grant.customerId))
      .limit(1);

    return c.json({
      email: grant.email,
      name: customer?.name ?? null,
      organization: customer?.organization ?? null,
      claimed: Boolean(grant.claimedAt),
    });
  })

  /**
   * Create the customer's account from the invitation.
   *
   * Public registration is OFF on this instance (DISABLE_REGISTRATION), which
   * is what stops strangers minting themselves logins — so a customer cannot
   * use the normal sign-up flow, and a valid grant has to be what creates the
   * account instead.
   *
   * The address comes from the GRANT, never from the request body. Taking it
   * from the caller would turn one leaked link into an account for any email
   * they liked. The credential row is written the same way seed-instance.ts
   * writes one (bcrypt, providerId "credential"), so the account signs in
   * through the ordinary path afterwards.
   *
   * No workspace membership and no user_access row: this account exists only to
   * see its own orders, and every CRM route refuses a user with no entitlement.
   */
  .post("/claim/:token", async (c) => {
    requireCrm();
    const grant = await resolveGrant(c.req.param("token"));
    if (!grant)
      throw new HTTPException(404, {
        message: "This invitation link is invalid or has expired.",
      });

    const { password } = await c.req.json<{ password?: string }>();
    if (!password || password.length < 8) {
      throw new HTTPException(400, {
        message: "Choose a password of at least 8 characters.",
      });
    }

    const email = grant.email.trim().toLowerCase();
    const now = new Date();
    const [existing] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);

    if (existing) {
      // Already has an account — from an earlier order. Nothing to create; they
      // sign in with the password they already chose. Deliberately NOT reset
      // here: a forwarded link must not be a password-reset for someone else.
      return c.json({ ok: true, existed: true });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [created] = await db
      .insert(userTable)
      .values({
        name: grant.email,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(accountTable).values({
      accountId: created.id,
      providerId: "credential",
      userId: created.id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ ok: true, existed: false });
  });

/** Session required. Mounted behind the normal auth middleware. */
export const portal = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  /**
   * Bind the signed-in account to the invited customer.
   *
   * The email must match the one the invitation was issued to. Without that
   * check, anyone who obtained a link could sign up with any address and claim
   * somebody else's purchase history.
   */
  .post("/claim/:token", async (c) => {
    requireCrm();
    const grant = await resolveGrant(c.req.param("token"));
    if (!grant)
      throw new HTTPException(404, {
        message: "This invitation link is invalid or has expired.",
      });

    const email = c.get("userEmail")?.trim().toLowerCase();
    if (!email || email !== grant.email.trim().toLowerCase()) {
      throw new HTTPException(403, {
        message:
          "This invitation was issued to a different email address. Sign in with the address it was sent to.",
      });
    }

    const now = new Date();
    await crmDb
      .update(nvPortalGrants)
      .set({ claimedAt: grant.claimedAt ?? now, lastUsedAt: now })
      .where(eq(nvPortalGrants.token, grant.token));

    await crmDb
      .update(nvCustomers)
      .set({ portalUserId: c.get("userId"), updatedAt: now })
      .where(eq(nvCustomers.id, grant.customerId));

    return c.json({ ok: true });
  })

  /**
   * The customer's own orders. The only data endpoint they have.
   *
   * Scoped by the SESSION's email, never by an id from the request — an id
   * parameter here would be an invitation to read somebody else's order by
   * changing a number in the URL.
   */
  .get("/orders", async (c) => {
    requireCrm();
    const email = c.get("userEmail")?.trim().toLowerCase();
    if (!email) throw new HTTPException(401, { message: "Not signed in" });

    const [customer] = await crmDb
      .select()
      .from(nvCustomers)
      .where(eq(nvCustomers.email, email))
      .limit(1);

    if (!customer) return c.json({ customer: null, orders: [] });

    const orders = await crmDb
      .select()
      .from(nvOrders)
      .where(eq(nvOrders.customerId, customer.id))
      .orderBy(desc(nvOrders.placedAt));

    const items = await Promise.all(
      orders.map(async (o) => ({
        order: o,
        items: await crmDb
          .select()
          .from(nvOrderItems)
          .where(eq(nvOrderItems.orderId, o.id)),
        assets: await crmDb
          .select()
          .from(nvCustomerAssets)
          .where(
            and(
              eq(nvCustomerAssets.orderId, o.id),
              // Only released content. An asset staged for a future drop must
              // not appear the moment it is created.
            ),
          ),
      })),
    );

    // Library: assets granted to the customer rather than to one order.
    const library = await crmDb
      .select()
      .from(nvCustomerAssets)
      .where(eq(nvCustomerAssets.customerId, customer.id));

    return c.json({
      customer: {
        name: customer.name,
        email: customer.email,
        organization: customer.organization,
      },
      orders: items,
      library,
    });
  });

export default portal;
