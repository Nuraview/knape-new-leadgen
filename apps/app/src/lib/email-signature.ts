import { type Brand, FALLBACK_BRAND } from "@/lib/brand";

/**
 * The sender identity appended to outbound mail.
 *
 * Was a pair of hardcoded constants naming Varshith and nuraview.com. That is
 * the single most personal thing this app puts in a stranger's inbox, so on a
 * white-labelled instance it is also the most wrong: Dan's outreach must not go
 * out signed by NuraView's founder.
 *
 * Now built from the instance brand. Rendered through one reviewed template
 * rather than pasted as HTML into an env var — see the BrandSignature note in
 * apps/api/src/utils/get-brand.ts.
 *
 * Optional fields (photo, phone, scheduling link, LinkedIn, legal, address) are
 * omitted entirely when unset rather than rendered empty, so an instance that
 * supplies only a name and a website gets a tidy two-line block instead of a
 * skeleton with holes in it.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSignatureHtml(brand: Brand): string {
  const s = brand.signature;

  const photoCell = s.photoUrl
    ? `
    <td valign="top" style="padding-right:16px;">
      <img
        src="${escapeHtml(s.photoUrl)}"
        width="90"
        height="90"
        alt="${escapeHtml(s.personName)}"
        style="display:block;border-radius:50%;border:0;max-width:90px;height:auto;"
      />
    </td>`
    : "";

  const phoneRow = s.phone
    ? `
      <div style="margin-top:8px;font-size:13px;">
        <a href="tel:${escapeHtml(s.phone.replace(/[^\d+]/g, ""))}" style="color:#000;text-decoration:none;">
          ${escapeHtml(s.phone)}
        </a>
      </div>`
    : "";

  const schedulingRow = s.schedulingUrl
    ? `
      <div style="margin-top:6px;font-size:13px;">
        <a href="${escapeHtml(s.schedulingUrl)}" style="color:#000;text-decoration:underline;">
          Schedule a call
        </a>
      </div>`
    : "";

  const linkedinIconCell = s.linkedinUrl
    ? `
          <td style="padding-right:8px;">
            <a href="${escapeHtml(s.linkedinUrl)}">
              <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" width="18" alt="LinkedIn" style="display:block;border:0;" />
            </a>
          </td>`
    : "";

  const linkLine = [
    s.linkedinUrl && s.linkedinLabel
      ? `<a href="${escapeHtml(s.linkedinUrl)}" style="color:#000;text-decoration:none;">${escapeHtml(s.linkedinLabel)}</a>`
      : null,
    `<a href="${escapeHtml(s.websiteUrl)}" style="color:#000;text-decoration:none;">${escapeHtml(s.websiteLabel)}</a>`,
  ]
    .filter(Boolean)
    .join("\n        &nbsp;&bull;&nbsp;\n        ");

  const legalBlock =
    s.legalLine || s.addressLine
      ? `
      <div style="margin-top:10px;font-size:12px;color:#666;max-width:420px;line-height:1.4;">
        ${[s.legalLine, s.addressLine]
          .filter((line): line is string => Boolean(line))
          .map(escapeHtml)
          .join("<br/>\n        ")}
      </div>`
      : "";

  return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#000;">
  <tr>${photoCell}
    <td valign="top">
      <div style="font-size:16px;font-weight:700;letter-spacing:0.3px;">
        ${escapeHtml(s.personName)}
      </div>
      <div style="font-size:13px;color:#444;margin-top:2px;">
        ${escapeHtml(s.personTitle)}
      </div>${phoneRow}${schedulingRow}
      <div style="margin:12px 0;border-top:1px solid #e5e5e5;width:260px;"></div>
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>${linkedinIconCell}
          <td>
            <a href="${escapeHtml(s.websiteUrl)}">
              <img src="https://cdn-icons-png.flaticon.com/512/841/841364.png" width="18" alt="Website" style="display:block;border:0;" />
            </a>
          </td>
        </tr>
      </table>
      <div style="margin-top:6px;font-size:12.5px;color:#555;">
        ${linkLine}
      </div>${legalBlock}
    </td>
  </tr>
</table>
`.trim();
}

export function buildSignatureText(brand: Brand): string {
  const s = brand.signature;

  return [
    "--",
    s.personName,
    s.personTitle,
    s.phone,
    s.schedulingUrl ? `Schedule a call: ${s.schedulingUrl}` : null,
    "",
    [s.linkedinLabel, s.websiteLabel].filter(Boolean).join(" • "),
    "",
    s.legalLine,
    s.addressLine,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .trim();
}

export function wrapWithSignature(bodyHtml: string, brand: Brand): string {
  return `${bodyHtml}<br/><br/>${buildSignatureHtml(brand)}`;
}

export function wrapTextWithSignature(bodyText: string, brand: Brand): string {
  return `${bodyText}\n\n${buildSignatureText(brand)}`;
}

/**
 * Kept so non-React callers (and anything rendering before /api/config has
 * answered) still have something to show. Uses the fallback brand, i.e.
 * NuraView's own signature — inside a component, prefer useSignatureHtml().
 */
export const EMAIL_SIGNATURE_HTML = buildSignatureHtml(FALLBACK_BRAND);
export const EMAIL_SIGNATURE_TEXT = buildSignatureText(FALLBACK_BRAND);
