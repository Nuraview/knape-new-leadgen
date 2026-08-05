/**
 * Instance branding, resolved from env at request time.
 *
 * One codebase now serves several products: NuraView's own CRM on crmx1, and a
 * white-labelled instance per client. There are ~1,900 hardcoded "NuraView"
 * references in this repo, and search-and-replacing them in a fork would mean
 * hand-porting every future fix across N diverging trees. So the user-visible
 * ones read from here instead.
 *
 * EVERY field defaults to NuraView's current value. That is deliberate: an
 * instance with no BRAND_* env set must render byte-identically to how it did
 * before this file existed, so shipping it cannot change crmx1.
 *
 * Served over /api/config rather than baked into the bundle at build time, for
 * the reason already learned the hard way with VITE_API_URL (see the VAPID note
 * in get-settings.ts): a build-time variable silently vanishes when the build
 * moves, and nothing fails loudly. The one exception is the HTML <head>, which
 * has to be correct before any JavaScript runs — that is handled separately by
 * a Vite plugin reading the same variables.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function envOrNull(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/**
 * The sender's identity block appended to outbound mail.
 *
 * Structured rather than a single BRAND_EMAIL_SIGNATURE_HTML blob. A blob would
 * be quicker to add and worse to own: HTML in an env var cannot be reviewed in
 * a diff, breaks the moment someone's address contains a quote, and gives every
 * future instance a fresh opportunity to ship broken markup to a client's
 * inbox. These fields render through one reviewed template instead.
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
  /** Full product name. Page titles, email badges, PDF footers. */
  name: string;
  /** Compact form for the PWA icon label and the collapsed sidebar. */
  shortName: string;
  /** Single letter shown when the sidebar is collapsed to the icon rail. */
  monogram: string;
  tagline: string;
  description: string;
  /** Served from the SPA's public/ directory. */
  logoUrl: string;
  faviconUrl: string;
  themeColor: string;
  backgroundColor: string;
  /**
   * The UI accent — buttons, active nav, focus rings.
   *
   * Separate from themeColor, which only ever reaches the PWA manifest and the
   * browser chrome. Without this the whole app kept NuraView's neutral-800
   * primary: a client could set every BRAND_* variable and still look exactly
   * like the vendor's product, which is what "white label" is supposed to
   * prevent.
   */
  accentColor: string;
  /** Text on top of accentColor. Gold needs dark text; a navy accent needs light. */
  accentForeground: string;
  /** Public marketing site, linked from emails and the public proposal page. */
  marketingUrl: string;
  supportEmail: string | null;
  /** Registered entity, used on invoices and proposals. */
  legalName: string;
  /**
   * Where the SPA should send users for modules this instance has not ported.
   * NuraView points at its legacy Next app; a client instance has no legacy app
   * at all, and must never be linked into somebody else's CRM.
   */
  legacyBaseUrl: string | null;
  /**
   * Whether to show the project-management group ("Business": Projects,
   * Members, Employees). A client instance's work surfaces under CRM instead —
   * there is no team in it to manage.
   */
  showProjectManagement: boolean;
  signature: BrandSignature;
};

export function getBrand(): Brand {
  const name = env("BRAND_NAME", "NuraView");

  return {
    name,
    shortName: env("BRAND_SHORT_NAME", name),
    // First letter of the short name, so a new instance gets a sensible rail
    // badge without anyone having to think about it.
    monogram: env("BRAND_MONOGRAM", env("BRAND_SHORT_NAME", name).charAt(0)),
    tagline: env("BRAND_TAGLINE", "Your One Stop Solution"),
    description: env(
      "BRAND_DESCRIPTION",
      "Your One Stop Solution. Open source project management.",
    ),
    logoUrl: env("BRAND_LOGO_URL", "/nuraview-logo.png"),
    faviconUrl: env("BRAND_FAVICON_URL", "/favicon.svg"),
    themeColor: env("BRAND_THEME_COLOR", "#141414"),
    backgroundColor: env("BRAND_BACKGROUND_COLOR", "#141414"),
    // Defaults reproduce NuraView's existing neutral-800 primary exactly, so an
    // instance that sets nothing is visually unchanged.
    accentColor: env("BRAND_ACCENT_COLOR", "#262626"),
    accentForeground: env("BRAND_ACCENT_FOREGROUND", "#fafafa"),
    marketingUrl: env("BRAND_MARKETING_URL", "https://www.nuraview.com"),
    supportEmail: envOrNull("BRAND_SUPPORT_EMAIL"),
    legalName: env("BRAND_LEGAL_NAME", "Varshith KM LLC"),
    /*
     * Three states, not two, which is why this cannot use env():
     *
     *   unset          -> NuraView's legacy Next app (crmx1), the status quo
     *   set to ""      -> this instance HAS no legacy app
     *   set to a URL   -> that URL
     *
     * env() collapses the middle case into the first, because it treats empty
     * as "absent" and returns the fallback. That is exactly wrong here: it
     * would put a link to NuraView's internal CRM in a client's sidebar.
     */
    legacyBaseUrl: (() => {
      const raw = process.env.BRAND_LEGACY_BASE_URL;
      if (raw === undefined) return "https://crmx1.nuraview.com";
      const trimmed = raw.trim();
      /*
       * "none" as well as empty, because Vercel refuses to store an empty
       * environment variable — so on that platform there is no way to express
       * "this instance has no legacy app" by blanking the value. Without a
       * sentinel the variable has to be left unset, which falls back to
       * NuraView's own CRM and puts a link to it in a client's sidebar.
       */
      if (!trimmed || trimmed.toLowerCase() === "none") return null;
      return trimmed;
    })(),
    // Opt-OUT rather than opt-in, so crmx1 keeps its Projects nav without
    // needing a new variable set on an already-running deployment.
    showProjectManagement: process.env.BRAND_HIDE_PROJECTS !== "true",
    signature: {
      personName: env("BRAND_SIGNATURE_NAME", "VARSHITH KM"),
      personTitle: env("BRAND_SIGNATURE_TITLE", `CEO & Founder, ${name}`),
      photoUrl: env(
        "BRAND_SIGNATURE_PHOTO_URL",
        "https://res.cloudinary.com/dliyoyws3/image/upload/fl_preserve_transparency/v1767880854/photo1-1_1_bho4el_xmnr6g.jpg",
      ),
      phone: env("BRAND_SIGNATURE_PHONE", "+1 478 818 8340"),
      schedulingUrl: env(
        "BRAND_SIGNATURE_SCHEDULING_URL",
        "https://tidycal.com/vkumar",
      ),
      linkedinUrl: env(
        "BRAND_SIGNATURE_LINKEDIN_URL",
        "https://www.linkedin.com/in/iamvarshith/",
      ),
      linkedinLabel: env(
        "BRAND_SIGNATURE_LINKEDIN_LABEL",
        "linkedin.com/in/iamvarshith",
      ),
      websiteUrl: env("BRAND_SIGNATURE_WEBSITE_URL", "https://www.nuraview.com/"),
      websiteLabel: env("BRAND_SIGNATURE_WEBSITE_LABEL", "nuraview.com"),
      legalLine: env(
        "BRAND_SIGNATURE_LEGAL_LINE",
        "Nuraview, registered as Varshith KM LLC in Delaware, USA.",
      ),
      addressLine: env(
        "BRAND_SIGNATURE_ADDRESS_LINE",
        "1007 N Orange St. 4th Floor, Wilmington, DE, 19801",
      ),
    },
  };
}

export default getBrand;
