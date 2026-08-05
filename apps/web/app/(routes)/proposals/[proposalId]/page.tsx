import Container from "@/app/(routes)/components/ui/Container";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Pencil, Eye } from "lucide-react";
import { getProposalById } from "../data/get-proposals";
import { sanitizeProposalHtml } from "@/lib/proposals/sanitize-html";
import { StatusBadge } from "../components/status-badge";
import { ProposalActions } from "./components/proposal-actions";
import { PortfolioManager } from "./components/portfolio-manager";
import { getProposalSenders } from "@/lib/proposals/senders";
import { orm } from "@/lib/db-compat";
import { PAYMENT_METHOD_META } from "@/types/proposal";
import { lookupGeo } from "@/lib/proposals/geo";

function money(amount: unknown, currency: string) {
  const n = typeof amount === "string" ? parseFloat(amount) : Number(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(
      Number.isFinite(n) ? n : 0,
    );
  } catch {
    return `$${Number.isFinite(n) ? n : 0}`;
  }
}

// Always render timestamps in IST (server runs UTC on Vercel).
function fmtIST(d: string | Date) {
  return (
    new Date(d).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

// Server actions POST back to this route — the send action chromium-prints the
// proposal PDF inline, which can exceed the default duration on a cold lambda.
export const maxDuration = 120;

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const proposal: any = await getProposalById(proposalId);
  if (!proposal || proposal.deletedAt) notFound();

  const sections = Array.isArray(proposal.sections) ? proposal.sections : [];
  const lineItems = proposal.lineItems ?? [];
  const assets = proposal.assets ?? [];
  const activity = proposal.activity ?? [];

  // Backfill geolocation for past view rows that have an IP but no geo yet
  // (one-time, persisted). New views are enriched live via after().
  const toGeo = activity
    .filter((a: any) => a.action === "VIEWED" && a.meta?.ip && !a.meta?.geo)
    .slice(0, 12);
  if (toGeo.length) {
    await Promise.all(
      toGeo.map(async (a: any) => {
        const geo = await lookupGeo(a.meta.ip);
        if (!geo) return; // leave for retry on the next load
        a.meta = { ...a.meta, geo };
        try {
          await orm.crm_Proposal_Activity.update({ where: { id: a.id }, data: { meta: a.meta } });
        } catch {
          /* ignore */
        }
      }),
    );
  }
  const isEditable = !["APPROVED", "REJECTED", "PAID", "EXPIRED"].includes(proposal.status);

  return (
    <Container
      title={proposal.title}
      description={`Proposal #${proposal.number ?? "—"}`}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={proposal.status} />
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            Viewed {proposal.viewCount ?? 0}×
            {proposal.lastViewedAt && (
              <span className="text-xs">· last {fmtIST(proposal.lastViewedAt)}</span>
            )}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isEditable && (
            <Link href={`/proposals/${proposal.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
          <ProposalActions
            proposalId={proposal.id}
            defaultEmail={proposal.contact?.email ?? null}
            defaultSubject={`Proposal: ${proposal.title}`}
            senders={getProposalSenders().map((s) => ({ id: s.id, label: s.label }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>{proposal.clientCompany || proposal.account?.name || "—"}</div>
              <div className="text-muted-foreground">
                {proposal.clientName || "—"}
              </div>
              {proposal.clientEmail && (
                <div className="text-muted-foreground">{proposal.clientEmail}</div>
              )}
              {proposal.clientAddress && (
                <div className="text-muted-foreground whitespace-pre-line">
                  {proposal.clientAddress}
                </div>
              )}
              {proposal.projectName && (
                <div className="text-muted-foreground">
                  Project: {proposal.projectName}
                </div>
              )}
            </CardContent>
          </Card>

          {sections.map((s: any) => {
            // Render the authored rich text as HTML (it's stored as an HTML
            // string), sanitized — NOT as raw text, or the <p> tags show
            // literally. Skip sections whose body is effectively empty
            // (e.g. an untouched "<p></p>") so we don't print blank cards.
            const html: string = typeof s.bodyHtml === "string" ? s.bodyHtml : "";
            const hasContent =
              /<(img|table)\b/i.test(html) || html.replace(/<[^>]*>/g, "").trim().length > 0;
            if (!hasContent) return null;
            return (
              <Card key={s.key}>
                <CardHeader>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="proposal-rich prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: sanitizeProposalHtml(html) }}
                  />
                </CardContent>
              </Card>
            );
          })}

          {lineItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pricing</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {lineItems.map((li: any) => (
                  <div key={li.id} className="flex justify-between">
                    <span>
                      {li.description}{" "}
                      <span className="text-muted-foreground">
                        × {parseFloat(li.quantity)}
                      </span>
                    </span>
                    <span>{money(li.lineTotal, proposal.currency)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Portfolio / Relevant Work</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditable ? (
                <PortfolioManager proposalId={proposal.id} assets={assets} config={proposal.portfolioConfig ?? null} />
              ) : assets.length ? (
                <ul className="text-sm space-y-1">
                  {assets.map((a: any) => (
                    <li key={a.id}>
                      <span className="text-xs uppercase text-muted-foreground mr-2">
                        {a.kind}
                      </span>
                      {a.title || "Untitled"}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-muted-foreground">No portfolio items.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row label="Subtotal" value={money(proposal.subtotal, proposal.currency)} />
              <Row label="Tax" value={money(proposal.taxTotal, proposal.currency)} />
              {parseFloat(proposal.transactionFee) > 0 && (
                <Row
                  label={`Processing fee${proposal.paymentMethod ? ` · ${PAYMENT_METHOD_META[proposal.paymentMethod as "stripe" | "paypal" | "bank"]?.label ?? ""}` : ""}`}
                  value={money(proposal.transactionFee, proposal.currency)}
                />
              )}
              <Separator className="my-2" />
              <Row label="Total" value={money(proposal.grandTotal, proposal.currency)} bold />
            </CardContent>
          </Card>

          {(proposal.approvedByName || proposal.decisionAt) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Signed</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <Row label="By" value={proposal.approvedByName || "—"} />
                {proposal.approvedByEmail && <Row label="Email" value={proposal.approvedByEmail} />}
                {proposal.paymentMethod && (
                  <Row label="Payment method" value={PAYMENT_METHOD_META[proposal.paymentMethod as "stripe" | "paypal" | "bank"]?.label ?? proposal.paymentMethod} />
                )}
                {parseFloat(proposal.processingFee ?? "0") > 0 && (
                  <Row label="Processing fee" value={money(proposal.processingFee, proposal.currency)} />
                )}
                {proposal.signatureIpAddress && <Row label="IP address" value={proposal.signatureIpAddress} />}
                {proposal.decisionAt && (
                  <Row label="Signed at" value={fmtIST(proposal.decisionAt)} />
                )}
                <div className="pt-2">
                  <div className="mb-1 text-xs text-muted-foreground">Signature</div>
                  {proposal.signatureStorageKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proposal.signatureStorageKey} alt="signature" className="h-20 rounded border bg-white object-contain p-1" />
                  ) : proposal.signatureTypedName ? (
                    <div className="text-2xl" style={{ fontFamily: "cursive" }}>{proposal.signatureTypedName}</div>
                  ) : (
                    <div className="text-muted-foreground">—</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoice &amp; Payment</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {proposal.linkedInvoice ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice</span>
                    <Link
                      href={`/invoices/${proposal.linkedInvoice.id}`}
                      className="font-medium underline"
                    >
                      {proposal.linkedInvoice.number
                        ? `#${proposal.linkedInvoice.number}`
                        : "View invoice"}
                    </Link>
                  </div>
                  <Row label="Invoice status" value={proposal.linkedInvoice.status} />
                  <Row
                    label="Amount"
                    value={money(proposal.linkedInvoice.grandTotal, proposal.currency)}
                  />
                  <Row
                    label="Payment"
                    value={proposal.status === "PAID" ? "Paid ✓" : "Awaiting payment"}
                  />
                </>
              ) : (
                <div className="text-muted-foreground">
                  A real invoice is generated automatically the moment the client
                  signs — then they pay in-page via Stripe/PayPal.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {activity.length === 0 && (
                <div className="text-muted-foreground">No activity yet.</div>
              )}
              {activity.map((a: any) => {
                const geo = a.meta?.geo;
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{a.action}</div>
                      {geo?.country && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {geo.countryCode && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://flagcdn.com/20x15/${geo.countryCode.toLowerCase()}.png`}
                              alt={geo.countryCode}
                              width={18}
                              height={13}
                              className="rounded-[2px] ring-1 ring-black/5"
                            />
                          )}
                          <span className="truncate">
                            {geo.city ? `${geo.city}, ` : ""}
                            {geo.country}
                            {geo.proxy ? " · VPN" : geo.mobile ? " · mobile" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="whitespace-nowrap text-xs text-muted-foreground">{fmtIST(a.createdAt)}</div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </Container>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
