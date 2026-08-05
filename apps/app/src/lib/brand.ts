/**
 * Client-side view of the instance branding served by GET /api/config.
 *
 * There are two sources on purpose, and the order matters:
 *
 *   1. `window.__BRAND__`, stamped into index.html at build time by the
 *      brand-html Vite plugin. Available on the very first paint.
 *   2. The /api/config response, which is authoritative and can change without
 *      a rebuild.
 *
 * Without (1) every page would render "NuraView" for the ~200ms until the
 * config request resolves, and a client would watch somebody else's brand flash
 * on their own CRM. Without (2) the brand would be frozen into the bundle, the
 * exact trap that lost VITE_API_URL when the SPA build moved out of Docker.
 *
 * The hardcoded fallbacks below are NuraView's own values, so an instance that
 * sets nothing behaves exactly as it did before any of this existed.
 */
export type BrandSignature = {
  personName: string;
  personTitle: string;
  photoUrl: string | null;
  phone: string | null;
  schedulingUrl: string | null;
  linkedinUrl: string | null;
  linkedinLabel: string | null;
  websiteUrl: string;
  websiteLabel: string;
  legalLine: string | null;
  addressLine: string | null;
};

export type Brand = {
  name: string;
  shortName: string;
  monogram: string;
  tagline: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
  themeColor: string;
  backgroundColor: string;
  accentColor: string;
  accentForeground: string;
  marketingUrl: string;
  supportEmail: string | null;
  legalName: string;
  legacyBaseUrl: string | null;
  showProjectManagement: boolean;
  signature: BrandSignature;
};

export const FALLBACK_BRAND: Brand = {
  name: "NuraView",
  shortName: "NuraView",
  monogram: "N",
  tagline: "Your One Stop Solution",
  description:
    "Your One Stop Solution. Open source project management.",
  logoUrl: "/nuraview-logo.png",
  faviconUrl: "/favicon.svg",
  themeColor: "#141414",
  backgroundColor: "#141414",
  accentColor: "#262626",
  accentForeground: "#fafafa",
  marketingUrl: "https://www.nuraview.com",
  supportEmail: null,
  legalName: "Varshith KM LLC",
  legacyBaseUrl: "https://crmx1.nuraview.com",
  showProjectManagement: true,
  signature: {
    personName: "VARSHITH KM",
    personTitle: "CEO & Founder, Nuraview",
    photoUrl:
      "https://res.cloudinary.com/dliyoyws3/image/upload/fl_preserve_transparency/v1767880854/photo1-1_1_bho4el_xmnr6g.jpg",
    phone: "+1 478 818 8340",
    schedulingUrl: "https://tidycal.com/vkumar",
    linkedinUrl: "https://www.linkedin.com/in/iamvarshith/",
    linkedinLabel: "linkedin.com/in/iamvarshith",
    websiteUrl: "https://www.nuraview.com/",
    websiteLabel: "nuraview.com",
    legalLine: "Nuraview, registered as Varshith KM LLC in Delaware, USA.",
    addressLine: "1007 N Orange St. 4th Floor, Wilmington, DE, 19801",
  },
};

declare global {
  interface Window {
    __BRAND__?: Partial<Brand>;
  }
}

/**
 * The build-time seed, merged over the fallbacks.
 *
 * Shallow-merged except for `signature`, which is merged one level deeper —
 * a partial signature (say, only a new name and title) must not wipe out the
 * remaining fields and leave a half-empty block at the bottom of every email.
 */
export function getSeedBrand(): Brand {
  const seed = typeof window === "undefined" ? undefined : window.__BRAND__;
  if (!seed) return FALLBACK_BRAND;

  return {
    ...FALLBACK_BRAND,
    ...seed,
    signature: { ...FALLBACK_BRAND.signature, ...(seed.signature ?? {}) },
  };
}
