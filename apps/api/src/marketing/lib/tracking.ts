/**
 * Email tracking helpers — inject a 1×1 pixel for open tracking
 * and rewrite links for click tracking.
 *
 * Migrated from nv-marketter. Endpoints live under /api/marketing/track/*.
 */

function getBaseUrl(): string {
  /*
   * These URLs are baked into email that has already been delivered — a
   * tracking pixel or a rewritten link cannot be corrected after the fact, so
   * getting the base wrong here silently loses opens and clicks forever.
   * NEXT_PUBLIC_APP_URL is kept as a fallback so a half-migrated .env still
   * produces the same URLs the legacy app did.
   */
  const base =
    process.env.NURAVIEW_CLIENT_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL;
  if (base) return base.replace(/\/$/, "");
  return "http://localhost:3000";
}

/** Adds an open-tracking pixel to HTML content (before </body> or at the end). */
export function addOpenTracking(html: string, emailId: number): string {
  const baseUrl = getBaseUrl();
  const trackingPixel = `<img src="${baseUrl}/api/marketing/track/open?id=${emailId}" alt="" width="1" height="1" style="display:none" />`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${trackingPixel}</body>`);
  }
  return `${html}${trackingPixel}`;
}

/**
 * Rewrites every href so clicks go through our tracker first, then redirect.
 * Skips mailto:, tel:, #, and javascript: links.
 */
export function addClickTracking(html: string, emailId: number): string {
  const baseUrl = getBaseUrl();

  return html.replace(
    /href="((?!mailto:|tel:|#|javascript:)[^"]+)"/gi,
    (_match, url) => {
      if (url.includes("/api/marketing/track/click")) return _match;
      const encodedUrl = encodeURIComponent(url);
      const trackingUrl = `${baseUrl}/api/marketing/track/click?id=${emailId}&url=${encodedUrl}`;
      return `href="${trackingUrl}"`;
    },
  );
}

// Legacy exports for backward compatibility
export const getTrackingPixelHtml = (emailId: number) => {
  const baseUrl = getBaseUrl();
  return `<img src="${baseUrl}/api/marketing/track/open?id=${emailId}" alt="" width="1" height="1" style="display:none" />`;
};

export const rewriteLinksForTracking = addClickTracking;

/** Injects click + open tracking into the final email HTML. */
export function injectTracking(html: string, emailId: number): string {
  let processedHtml = html;
  processedHtml = addClickTracking(processedHtml, emailId);
  processedHtml = addOpenTracking(processedHtml, emailId);
  return processedHtml;
}
