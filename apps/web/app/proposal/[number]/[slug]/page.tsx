import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { orm } from "@/lib/db-compat";
import { sanitizeProposalHtml } from "@/lib/proposals/sanitize-html";
import { lookupGeo } from "@/lib/proposals/geo";
import { verifyPdfRender } from "@/lib/proposals/pdf-sig";
import { PublicProposalView } from "./components/public-proposal-view";

// Rich-text sections are authored internally via Tiptap, but we sanitize before
// rendering on the public page anyway (defense-in-depth). Formatting tags only —
// no scripts, iframes, or event handlers. (Dependency-free: isomorphic-dompurify
// pulls in jsdom which 500s in the serverless runtime.)
function sanitizeSections(sections: any): any {
  if (!Array.isArray(sections)) return sections;
  return sections.map((s) =>
    s && typeof s.bodyHtml === "string" && s.bodyHtml
      ? { ...s, bodyHtml: sanitizeProposalHtml(s.bodyHtml) }
      : s,
  );
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PublicProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string; slug: string }>;
  searchParams: Promise<{ t?: string; pdf?: string }>;
}) {
  await params;
  const { t: token, pdf } = await searchParams;
  if (!token) notFound();

  const proposal: any = await orm.crm_Proposals.findFirst({
    where: { shareToken: token, deletedAt: null },
  });
  if (!proposal || proposal.status === "EXPIRED") notFound();

  // Fetch children explicitly — the facade's findFirst doesn't hydrate `include`
  // relations reliably, which left lineItems undefined (crash).
  const [lineItems, assets] = await Promise.all([
    orm.crm_Proposal_LineItems.findMany({
      where: { proposalId: proposal.id },
      orderBy: { position: "asc" },
    }),
    orm.crm_Proposal_Assets.findMany({
      where: { proposalId: proposal.id },
      orderBy: { position: "asc" },
    }),
  ]);
  proposal.lineItems = lineItems ?? [];
  proposal.assets = assets ?? [];
  proposal.sections = sanitizeSections(proposal.sections);

  const settings: any = await orm.proposal_Settings.findFirst();

  // PDF render mode — our own headless Chromium printing the page for the
  // email attachment. HMAC-gated so clients can't use it to dodge view
  // tracking. Static variant, no tracking side effects.
  const pdfMode = verifyPdfRender(token, pdf);
  if (pdfMode) {
    return (
      <PublicProposalView
        proposal={JSON.parse(JSON.stringify(proposal))}
        settings={settings ? JSON.parse(JSON.stringify(settings)) : null}
        token={token}
        alreadyDecided={["APPROVED", "REJECTED", "PAID"].includes(proposal.status)}
        pdfMode
      />
    );
  }

  // ---- View tracking (server-side, runs on every load) ----
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    null;
  const ua = hdrs.get("user-agent") ?? null;
  const now = new Date().toISOString();

  // Record every open until the proposal is decided — including links shared
  // while still DRAFT (Copy Link). SENT flips to VIEWED; DRAFT stays DRAFT so
  // it remains editable. viewCount increments on each load.
  const DECIDED = ["APPROVED", "REJECTED", "PAID", "EXPIRED"];
  if (!DECIDED.includes(proposal.status)) {
    const isFirstView = !proposal.firstViewedAt;
    const prevMs = proposal.lastViewedAt ? new Date(proposal.lastViewedAt).getTime() : 0;
    // A distinct view = first open, or >30s since the last load (dedupes refreshes).
    // Every distinct view gets its own timestamped VIEWED activity row.
    const isNewView = isFirstView || new Date(now).getTime() - prevMs > 30_000;
    await orm.crm_Proposals.update({
      where: { id: proposal.id },
      data: {
        status: proposal.status === "SENT" ? "VIEWED" : proposal.status,
        firstViewedAt: proposal.firstViewedAt ?? now,
        lastViewedAt: now,
        viewCount: (proposal.viewCount ?? 0) + (isNewView ? 1 : 0),
      },
    });
    if (isNewView) {
      const activityId = crypto.randomUUID();
      await orm.crm_Proposal_Activity.create({
        data: {
          id: activityId,
          proposalId: proposal.id,
          actorId: null,
          action: "VIEWED",
          meta: { ip, userAgent: ua },
          createdAt: now,
        },
      });
      // Geolocate the viewer AFTER the response is sent — never blocks the page.
      after(async () => {
        const geo = await lookupGeo(ip);
        if (geo) {
          await orm.crm_Proposal_Activity.update({
            where: { id: activityId },
            data: { meta: { ip, userAgent: ua, geo } },
          });
        }
      });
    }
  }

  const decided = ["APPROVED", "REJECTED", "PAID"].includes(proposal.status);

  return (
    <PublicProposalView
      proposal={JSON.parse(JSON.stringify(proposal))}
      settings={settings ? JSON.parse(JSON.stringify(settings)) : null}
      token={token}
      alreadyDecided={decided}
    />
  );
}
