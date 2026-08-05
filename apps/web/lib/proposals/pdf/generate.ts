import { printProposalPdf } from "./print";
import { renderProposalPdf } from "./render";

// One entry point for "give me THE proposal PDF". Chromium-prints the real
// public page (pixel-exact design); if that fails (no chromium locally, page
// unreachable) it degrades to the plain @react-pdf document so a PDF is always
// produced.

// @react-pdf can't render HTML — degrade Tiptap rich text to clean plain text
// (lists → bullets, block tags → newlines, entities decoded).
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function renderFallbackPdf(proposal: any, settings: any): Promise<Buffer> {
  const sections = Array.isArray(proposal.sections) ? proposal.sections : [];
  return renderProposalPdf({
    title: proposal.title,
    number: String(proposal.number ?? ""),
    currency: proposal.currency,
    brandColor:
      proposal.designTokens?.accentColor ||
      proposal.brandColor ||
      settings?.brandColor ||
      "#c2410c",
    companyName: settings?.companyName ?? undefined,
    companyEmail: settings?.companyEmail ?? undefined,
    companyWebsite: settings?.companyWebsite ?? undefined,
    logoUrl: settings?.logoStorageKey ?? undefined,
    clientName: proposal.clientName ?? undefined,
    clientCompany: proposal.clientCompany ?? undefined,
    clientAddress: proposal.clientAddress ?? undefined,
    projectName: proposal.projectName ?? undefined,
    proposalDate: proposal.proposalDate
      ? new Date(proposal.proposalDate).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : undefined,
    sections: sections.map((s: any) => {
      let body = s.bodyHtml ?? "";
      if (s.type === "scope" && Array.isArray(s.items)) {
        body = s.items
          .filter((it: any) => it.title || it.description)
          .map((it: any) => `• ${it.title}${it.description ? ` — ${it.description}` : ""}`)
          .join("\n");
      } else if (s.type === "timeline" && Array.isArray(s.phases)) {
        body = s.phases
          .filter((p: any) => p.label || p.duration)
          .map((p: any) => `${p.label}: ${p.duration}`)
          .join("\n");
      } else if (typeof body === "string" && /<[^>]+>/.test(body)) {
        body = htmlToText(body);
      }
      return { title: s.title, body };
    }),
    lineItems: (proposal.lineItems ?? []).map((li: any) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
    })),
    subtotal: proposal.subtotal,
    taxTotal: proposal.taxTotal,
    transactionFee: proposal.transactionFee,
    grandTotal: proposal.grandTotal,
    footerText: settings?.footerText ?? settings?.companyName ?? undefined,
  });
}

export interface GeneratedProposalPdf {
  pdf: Buffer;
  /** "chromium" = exact designed page; "react-pdf" = plain fallback document. */
  engine: "chromium" | "react-pdf";
}

/**
 * Generate the proposal PDF. `proposal` must carry `number`, `clientSlug`,
 * `shareToken` (for the chromium print) plus the full fields + `lineItems`
 * for the fallback renderer.
 */
export async function generateProposalPdf(
  proposal: any,
  settings: any,
): Promise<GeneratedProposalPdf> {
  if (proposal.shareToken) {
    try {
      const pdf = await printProposalPdf({
        number: proposal.number ?? null,
        clientSlug: proposal.clientSlug ?? null,
        shareToken: proposal.shareToken,
      });
      return { pdf, engine: "chromium" };
    } catch (e) {
      console.error("[proposal pdf] chromium print failed, using fallback:", e);
    }
  }
  return { pdf: await renderFallbackPdf(proposal, settings), engine: "react-pdf" };
}
