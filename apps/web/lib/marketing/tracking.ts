/**
 * Email tracking helpers — inject a 1×1 pixel for open tracking
 * and rewrite links for click tracking.
 *
 * Migrated from nv-marketter. Endpoints live under /api/marketing/track/*.
 */

function getBaseUrl(): string {
  // Explicit app URL (highest priority)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
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
