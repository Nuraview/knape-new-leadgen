/**
 * Orders & Purchases — the staff side.
 *
 * VK, 2026-08-03: "under orders and purchases, just add orders… the order name
 * would be iSchool, it would be some number, and status, dispatched, waiting
 * for dispatched, payment paid".
 *
 * Orders originate three ways, and the `source` on the customer records which:
 *   inbound  a form submission on the instance's marketing site, pulled through
 *            the cockpit's sample_leads. This is the common path — the forms are
 *            where buyers actually arrive.
 *   invoice  a paid invoice converted into a fulfilment record.
 *   manual   entered by hand, for Zelle / Cash App / cheque.
 *
 * Marking an order paid mints a portal grant and is what lets the customer see
 * their own order — see src/portal.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb, { isCrmConfigured } from "../database/crm";
import {
  nvCustomerAssets,
  nvCustomers,
  nvOrderItems,
  nvOrders,
} from "../database/crm-schema";
import { requireCrmAccess } from "../utils/require-crm-access";
import getBrand from "../utils/get-brand";
import { createPortalGrant } from "../portal/grant";

/** The statuses the UI offers, in the order an order moves through them. */
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "awaiting_dispatch",
  "dispatched",
  "delivered",
  "refunded",
  "cancelled",
] as const;

function requireCrm() {
  if (!isCrmConfigured()) {
    throw new HTTPException(503, {
      message: "CRM_DATABASE_URL is not configured",
    });
  }
}

/**
 * KNA-0001, KNA-0002, …
 *
 * Sequential and human-readable because this is the number the client reads out
 * on the phone. Derived from the current row count rather than a sequence so the
 * CRM database needs no extra object; collisions are caught by the UNIQUE index
 * and retried by the caller, which at this volume will effectively never happen.
 *
 * The prefix is BRANDED, not a constant: it is printed on invoices and read
 * aloud to customers, so an instance that ships another client's initials is
 * shipping their identity. Taken from BRAND_MONOGRAM/BRAND_SHORT_NAME so it
 * follows the rest of the brand config rather than needing its own variable —
 * three letters because two is ambiguous and four stops scanning as a prefix.
 */
function orderPrefix(): string {
  const brand = getBrand();
  const letters = (brand.shortName || brand.name).replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 3) || brand.monogram || "ORD").toUpperCase();
}

async function nextOrderNumber(): Promise<string> {
  const [row] = await crmDb
    .select({ n: sql<number>`count(*)::int` })
    .from(nvOrders);
  return `${orderPrefix()}-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

const order = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  .use("*", requireCrmAccess)

  /** List, newest first, with the customer joined in. */
  .get("/", async (c) => {
    requireCrm();
    const status = c.req.query("status");

    const rows = await crmDb
      .select({
        id: nvOrders.id,
        orderNumber: nvOrders.orderNumber,
        status: nvOrders.status,
        amountCents: nvOrders.amountCents,
        currency: nvOrders.currency,
        placedAt: nvOrders.placedAt,
        dispatchedAt: nvOrders.dispatchedAt,
        trackingNumber: nvOrders.trackingNumber,
        notes: nvOrders.notes,
        customerId: nvCustomers.id,
        customerName: nvCustomers.name,
        customerEmail: nvCustomers.email,
        customerOrg: nvCustomers.organization,
        customerSource: nvCustomers.source,
      })
      .from(nvOrders)
      .leftJoin(nvCustomers, eq(nvCustomers.id, nvOrders.customerId))
      .where(status ? eq(nvOrders.status, status) : undefined)
      .orderBy(desc(nvOrders.placedAt))
      .limit(500);

    return c.json({ items: rows });
  })

  .get("/:id", async (c) => {
    requireCrm();
    const id = c.req.param("id");

    const [row] = await crmDb
      .select()
      .from(nvOrders)
      .where(eq(nvOrders.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Order not found" });

    const [customer] = await crmDb
      .select()
      .from(nvCustomers)
      .where(eq(nvCustomers.id, row.customerId))
      .limit(1);

    const items = await crmDb
      .select()
      .from(nvOrderItems)
      .where(eq(nvOrderItems.orderId, id));

    const assets = await crmDb
      .select()
      .from(nvCustomerAssets)
      .where(eq(nvCustomerAssets.orderId, id));

    return c.json({ order: row, customer, items, assets });
  })

  /**
   * Create an order, upserting the customer by email.
   *
   * Email is the identity: the same buyer ordering twice must land on one
   * customer, or the portal shows them half their purchases.
   */
  .post("/", async (c) => {
    requireCrm();
    const body = await c.req.json<{
      email: string;
      name?: string;
      organization?: string;
      phone?: string;
      productName?: string;
      quantity?: number;
      amountCents?: number;
      currency?: string;
      notes?: string;
      source?: string;
      inboundLeadId?: number;
    }>();

    const email = body.email?.trim().toLowerCase();
    if (!email) throw new HTTPException(400, { message: "email is required" });

    const [existing] = await crmDb
      .select()
      .from(nvCustomers)
      .where(eq(nvCustomers.email, email))
      .limit(1);

    let customerId = existing?.id;
    if (!customerId) {
      customerId = randomUUID();
      await crmDb.insert(nvCustomers).values({
        id: customerId,
        email,
        name: body.name ?? null,
        organization: body.organization ?? null,
        phone: body.phone ?? null,
        source: body.source ?? "manual",
        inboundLeadId: body.inboundLeadId ?? null,
      });
    }

    const id = randomUUID();
    await crmDb.insert(nvOrders).values({
      id,
      orderNumber: await nextOrderNumber(),
      customerId,
      status: "pending_payment",
      amountCents: body.amountCents ?? 0,
      currency: body.currency ?? "USD",
      notes: body.notes ?? null,
    });

    if (body.productName) {
      await crmDb.insert(nvOrderItems).values({
        id: randomUUID(),
        orderId: id,
        productName: body.productName,
        quantity: body.quantity ?? 1,
        unitAmountCents: body.amountCents ?? 0,
      });
    }

    return c.json({ id }, 201);
  })

  /**
   * Update status / tracking / notes.
   *
   * Reaching `paid` mints a portal grant if the customer has never had one.
   * That is the automation from the call — "a unique link would be generated,
   * all automated, and sent as an email" — and it is tied to payment rather
   * than to creation so an unpaid order never opens the portal.
   */
  .patch("/:id", async (c) => {
    requireCrm();
    const id = c.req.param("id");
    const body = await c.req.json<{
      status?: string;
      trackingNumber?: string;
      notes?: string;
    }>();

    const [current] = await crmDb
      .select()
      .from(nvOrders)
      .where(eq(nvOrders.id, id))
      .limit(1);
    if (!current) throw new HTTPException(404, { message: "Order not found" });

    if (body.status && !ORDER_STATUSES.includes(body.status as never)) {
      throw new HTTPException(400, {
        message: `Unknown status "${body.status}"`,
      });
    }

    const now = new Date();
    await crmDb
      .update(nvOrders)
      .set({
        status: body.status ?? current.status,
        trackingNumber: body.trackingNumber ?? current.trackingNumber,
        notes: body.notes ?? current.notes,
        // Stamp the transition timestamps once, on first entry to each state.
        paidAt:
          body.status === "paid" && !current.paidAt ? now : current.paidAt,
        dispatchedAt:
          body.status === "dispatched" && !current.dispatchedAt
            ? now
            : current.dispatchedAt,
        deliveredAt:
          body.status === "delivered" && !current.deliveredAt
            ? now
            : current.deliveredAt,
        updatedAt: now,
      })
      .where(eq(nvOrders.id, id));

    let portalInvite: { token: string; url: string } | null = null;
    if (body.status === "paid" && !current.paidAt) {
      portalInvite = await createPortalGrant(current.customerId);
    }

    return c.json({ ok: true, portalInvite });
  })

  /** Attach digital content — worksheets, webinars, Zoom links, decks. */
  .post("/:id/assets", async (c) => {
    requireCrm();
    const id = c.req.param("id");
    const body = await c.req.json<{
      kind?: string;
      title: string;
      url?: string;
    }>();
    if (!body.title)
      throw new HTTPException(400, { message: "title is required" });

    const assetId = randomUUID();
    await crmDb.insert(nvCustomerAssets).values({
      id: assetId,
      orderId: id,
      kind: body.kind ?? "worksheet",
      title: body.title,
      url: body.url ?? null,
    });
    return c.json({ id: assetId }, 201);
  })

  /** Customers, with their order counts — the "list of customers" from the call. */
  .get("/customers/all", async (c) => {
    requireCrm();
    const rows = await crmDb
      .select({
        id: nvCustomers.id,
        email: nvCustomers.email,
        name: nvCustomers.name,
        organization: nvCustomers.organization,
        phone: nvCustomers.phone,
        source: nvCustomers.source,
        portalUserId: nvCustomers.portalUserId,
        createdAt: nvCustomers.createdAt,
        orderCount: sql<number>`(
          select count(*)::int from "nv_orders" o where o."customer_id" = ${nvCustomers.id}
        )`,
      })
      .from(nvCustomers)
      .orderBy(desc(nvCustomers.createdAt))
      .limit(500);
    return c.json({ items: rows });
  });

export default order;
