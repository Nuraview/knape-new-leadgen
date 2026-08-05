/**
 * Invoices — the staff side.
 *
 * Meeting 2026-07-30, VK: "if we deal with non-signers, because some people
 * don't want to commit but they're ready to pay… I should be able to go to the
 * invoicing and create manually." A proposal that gets signed already converts
 * itself into an invoice (proposal/lib/convert-to-invoice.ts); this is the
 * other door into the same table, for the client who pays without signing
 * anything.
 *
 * Same `Invoices` + `Invoice_LineItems` tables the conversion writes, so both
 * doors produce one list and one payment page. Admins only: this is money.
 */
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import {
  crmAccounts,
  invoiceLineItems,
  invoices,
} from "../database/crm-schema";
import { sendMarketingEmail } from "../marketing/lib/email-provider";
import { getUserWorkspaceRole } from "../utils/require-crm-access";
import { resolveCrmActorId } from "../lead/crm-actor";
import { buildInvoiceUrl } from "./lib/token";

type LineInput = {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  taxRate?: number | string;
};

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Server-side totals. The browser's arithmetic is never trusted for money. */
function computeTotals(lines: LineInput[]) {
  let subtotal = 0;
  let vat = 0;
  const rows = lines.map((l, i) => {
    const qty = Number(l.quantity ?? 1) || 0;
    const unit = Number(l.unitPrice ?? 0) || 0;
    const rate = Number(l.taxRate ?? 0) || 0;
    const lineSubtotal = Math.round(qty * unit * 100) / 100;
    const lineVat = Math.round(lineSubtotal * rate) / 100;
    subtotal += lineSubtotal;
    vat += lineVat;
    return {
      position: i,
      description: (l.description ?? "").trim() || "Services",
      quantity: String(qty),
      unitPrice: String(unit),
      taxRateSnapshot: rate ? String(rate) : null,
      lineSubtotal: lineSubtotal.toFixed(2),
      lineVat: lineVat.toFixed(2),
      lineTotal: (lineSubtotal + lineVat).toFixed(2),
    };
  });
  return {
    rows,
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    grandTotal: Math.round((subtotal + vat) * 100) / 100,
  };
}

async function requireAdmin(userId: string) {
  const role = await getUserWorkspaceRole(userId);
  if (role !== "owner" && role !== "admin") {
    throw new HTTPException(403, {
      message: "Only owners and admins can manage invoices.",
    });
  }
}

const invoice = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", async (c, next) => {
    await requireAdmin(c.get("userId"));
    await next();
  })

  /** The list. Joined to the account so a row reads as a client, not a uuid. */
  .get("/", async (c) => {
    const rows = await crmDb
      .select({
        id: invoices.id,
        number: sql<string | null>`${invoices.publicNotes}`,
        status: invoices.status,
        currency: invoices.currency,
        grandTotal: invoices.grandTotal,
        paidTotal: invoices.paidTotal,
        balanceDue: invoices.balanceDue,
        issueDate: invoices.issueDate,
        createdAt: invoices.createdAt,
        clientName: crmAccounts.name,
        accountId: invoices.accountId,
        internalNotes: invoices.internalNotes,
      })
      .from(invoices)
      .leftJoin(crmAccounts, eq(crmAccounts.id, invoices.accountId))
      .orderBy(desc(invoices.createdAt))
      .limit(200);

    return c.json({
      items: rows.map((r) => ({
        ...r,
        test: Boolean(r.internalNotes?.startsWith("[test]")),
        // The share link is derived, so the list can offer Copy link without a
        // second round trip.
        payUrl: buildInvoiceUrl(r.id),
      })),
    });
  })

  /** One invoice, with its lines — the detail drawer. */
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const [row] = await crmDb
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Invoice not found" });

    const lines = await crmDb
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, id))
      .orderBy(invoiceLineItems.position);

    const [account] = row.accountId
      ? await crmDb
          .select({ name: crmAccounts.name })
          .from(crmAccounts)
          .where(eq(crmAccounts.id, row.accountId))
          .limit(1)
      : [];

    return c.json({
      invoice: row,
      lineItems: lines,
      clientName: account?.name ?? null,
      payUrl: buildInvoiceUrl(row.id),
    });
  })

  /**
   * Create one by hand — the non-signer path.
   *
   * The client is identified by NAME (and optionally email): cold clients have
   * no account row, and making the user create one first would be a second
   * form for no reason. An existing account with the same name is reused so
   * repeat business does not fan out into duplicates.
   */
  .post("/", async (c) => {
    const body = await c.req.json<{
      clientName?: string;
      clientEmail?: string | null;
      currency?: string;
      dueDate?: string | null;
      notes?: string | null;
      lineItems?: LineInput[];
      /** Stripe TEST mode — a full dry run with no money moved. */
      test?: boolean;
    }>();

    const clientName = body.clientName?.trim();
    if (!clientName) {
      throw new HTTPException(400, { message: "Client name is required" });
    }
    const lines = (body.lineItems ?? []).filter(
      (l) => (l.description ?? "").trim() || Number(l.unitPrice ?? 0),
    );
    if (lines.length === 0) {
      throw new HTTPException(400, { message: "Add at least one line item" });
    }

    const currency = (body.currency || "USD").toUpperCase().slice(0, 3);
    const totals = computeTotals(lines);
    const createdBy = await resolveCrmActorId(c.get("userEmail"));
    if (!createdBy) {
      // Invoices.createdBy is NOT NULL and references the CRM Users table.
      throw new HTTPException(400, {
        message: "Your account is not linked to a CRM user — ask an admin.",
      });
    }

    const [existing] = await crmDb
      .select({ id: crmAccounts.id })
      .from(crmAccounts)
      .where(sql`lower(${crmAccounts.name}) = lower(${clientName})`)
      .limit(1);

    let accountId = existing?.id;
    if (!accountId) {
      accountId = crypto.randomUUID();
      await crmDb.insert(crmAccounts).values({
        id: accountId,
        v: 0,
        name: clientName,
        status: "Active",
        createdBy,
      });
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const due = body.dueDate ? new Date(body.dueDate) : null;

    await crmDb.insert(invoices).values({
      id,
      accountId,
      createdBy,
      currency,
      // ISSUED, not DRAFT: it exists to be paid, and a draft would need a
      // second click before the link works.
      status: "ISSUED",
      issueDate: now,
      dueDate: due,
      subtotal: totals.subtotal.toFixed(2),
      discountTotal: "0",
      vatTotal: totals.vat.toFixed(2),
      grandTotal: totals.grandTotal.toFixed(2),
      paidTotal: "0",
      balanceDue: totals.grandTotal.toFixed(2),
      publicNotes: body.notes?.trim() || null,
      // Staff-only marker. invoice/public.ts reads it to pick Stripe's test
      // keys; the client never sees this column.
      internalNotes: body.test ? "[test] Stripe test-mode invoice" : null,
      createdAt: now,
      updatedAt: now,
    });

    await crmDb.insert(invoiceLineItems).values(
      totals.rows.map((r) => ({
        id: crypto.randomUUID(),
        invoiceId: id,
        position: r.position,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        discountPercent: "0",
        taxRateSnapshot: r.taxRateSnapshot,
        lineSubtotal: r.lineSubtotal,
        lineVat: r.lineVat,
        lineTotal: r.lineTotal,
      })),
    );

    // Best effort: the invoice exists either way, and the link can be copied
    // from the list if the email does not go out.
    if (body.clientEmail?.trim() && !body.test) {
      const payUrl = buildInvoiceUrl(id);
      void sendMarketingEmail({
        to: body.clientEmail.trim(),
        subject: `Invoice from NuraView — ${money(totals.grandTotal, currency)}`,
        html: `
          <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
            <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Invoice</div>
            <h1 style="font-size:22px;margin:8px 0 14px">Hi ${clientName},</h1>
            <p style="font-size:15px;line-height:1.6;color:#44403c">
              Here is your invoice for <strong>${money(totals.grandTotal, currency)}</strong>.
              You can pay securely by card using the button below.
            </p>
            <a href="${payUrl}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9999px;font-size:14px;font-weight:500;margin-top:8px">Pay ${money(totals.grandTotal, currency)}</a>
            <p style="font-size:13px;color:#a8a29e;margin-top:18px">Thank you.</p>
          </div>`,
      }).catch((e) => console.error("[invoice] email failed:", e));
    }

    return c.json({ id, payUrl: buildInvoiceUrl(id), total: totals.grandTotal });
  })

  /** Email (or re-email) the pay link. */
  .post("/:id/send", async (c) => {
    const id = c.req.param("id");
    const { email } = await c.req.json<{ email?: string }>();
    const to = email?.trim();
    if (!to) throw new HTTPException(400, { message: "Recipient is required" });

    const [row] = await crmDb
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Invoice not found" });

    const payUrl = buildInvoiceUrl(id);
    const total = Number(row.grandTotal) || 0;
    await sendMarketingEmail({
      to,
      subject: `Invoice from NuraView — ${money(total, row.currency)}`,
      html: `
        <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
          <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Invoice</div>
          <h1 style="font-size:22px;margin:8px 0 14px">Payment request</h1>
          <p style="font-size:15px;line-height:1.6;color:#44403c">
            Amount due: <strong>${money(total, row.currency)}</strong>
          </p>
          <a href="${payUrl}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9999px;font-size:14px;font-weight:500">Pay now</a>
        </div>`,
    });

    return c.json({ sent: true, payUrl });
  })

  /** Mark paid by hand — bank transfer, cash, or a card taken over the phone. */
  .post("/:id/mark-paid", async (c) => {
    const id = c.req.param("id");
    const [row] = await crmDb
      .select({ grandTotal: invoices.grandTotal })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Invoice not found" });

    await crmDb
      .update(invoices)
      .set({
        status: "PAID",
        paidTotal: row.grandTotal,
        balanceDue: "0",
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id));

    return c.json({ ok: true });
  });

export default invoice;
