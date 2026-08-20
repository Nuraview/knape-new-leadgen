/**
 * Instance branding, resolved from env at request time.
 *
 * One codebase now serves several products: NuraView's own CRM on crmx1, and a
 * white-labelled instance per client. There are ~1,900 hardcoded "NuraView"
 * references in this repo, and search-and-replacing them in a fork would mean
 * hand-porting every future fix across N diverging trees. So the user-visible
 * ones read from here instead.
 *
 * Almost every field defaults to NuraView's current value. That is deliberate:
 * an instance with no BRAND_* env set must render byte-identically to how it did
 * before this file existed, so shipping it cannot change crmx1.
 *
 * The exception is the signature's personal details — a photograph, a mobile
 * number, a calendar link. Those default to NuraView's only ON NuraView's own
 * deployment, because a fallback there is not a bland placeholder but a specific
 * human being's contact details in a stranger's inbox. See vendorDetail.
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

/** The vendor's own product name — how this file tells its deployment from a client's. */
const VENDOR_NAME = "NuraView";

/**
 * A fallback that belongs to the vendor personally rather than to the product.
 *
 * Everything else in this file can safely default to NuraView's value: a client
 * who never sets BRAND_TAGLINE gets a bland tagline, and that is cosmetic. The
 * signature is not cosmetic. It carries a real person's photograph, mobile
 * number, calendar link and LinkedIn profile, and it is appended to mail that
 * leaves the building — so the same "default to NuraView" rule that is harmless
 * for a tagline was signing a client's cold outreach with the vendor's face.
 *
 * That is not hypothetical. Knape's instance sets every BRAND_SIGNATURE_* key to
 * "" and still served the vendor's headshot, mobile number, TidyCal link and
 * "registered as Varshith KM LLC" on every /api/config response, for two
 * compounding reasons — env() reads "" as absent, and Vercel refuses to store an
 * empty environment variable at all, so on that platform a client CANNOT express
 * "I have no phone number to publish" by blanking one.
 *
 * Hence the rule: a personal detail falls back ONLY on the vendor's own
 * deployment. Once the instance has been renamed, an unset variable means "this
 * client has not given us that detail", the field is null, and the signature
 * template omits the row — which it already knows how to do.
 *
 * "none" remains an explicit opt-out for the vendor's instance too, matching
 * BRAND_LEGACY_BASE_URL and BRAND_ANALYTICS_DOMAINS.
 */
function vendorDetail(
  name: string,
  vendorValue: string,
  isVendor: boolean,
): string | null {
  const raw = (process.env[name] ?? "").trim();
  if (raw.toLowerCase() === "none") return null;
  if (raw) return raw;
  return isVendor ? vendorValue : null;
}

/** "https://knapesolutions.com/" -> "knapesolutions.com". Mirrors brand.py's site_label(). */
function hostLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
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
  const name = env("BRAND_NAME", VENDOR_NAME);
  /*
   * Renaming the product is what makes an instance somebody else's. There is no
   * separate "this is a client" flag to forget to set, which matters because the
   * failure mode of forgetting one is the vendor's phone number in a stranger's
   * inbox. See vendorDetail.
   */
  const isVendor = name === VENDOR_NAME;
  const marketingUrl = env("BRAND_MARKETING_URL", "https://www.nuraview.com");

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
    marketingUrl,
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
      // The person signing, so the fallback is the business — never whoever the
      // vendor's founder happens to be.
      personName: env("BRAND_SIGNATURE_NAME", isVendor ? "VARSHITH KM" : name),
      personTitle: env("BRAND_SIGNATURE_TITLE", `CEO & Founder, ${name}`),
      photoUrl: vendorDetail(
        "BRAND_SIGNATURE_PHOTO_URL",
        "https://res.cloudinary.com/dliyoyws3/image/upload/fl_preserve_transparency/v1767880854/photo1-1_1_bho4el_xmnr6g.jpg",
        isVendor,
      ),
      phone: vendorDetail("BRAND_SIGNATURE_PHONE", "+1 478 818 8340", isVendor),
      schedulingUrl: vendorDetail(
        "BRAND_SIGNATURE_SCHEDULING_URL",
        "https://tidycal.com/vkumar",
        isVendor,
      ),
      linkedinUrl: vendorDetail(
        "BRAND_SIGNATURE_LINKEDIN_URL",
        "https://www.linkedin.com/in/iamvarshith/",
        isVendor,
      ),
      linkedinLabel: vendorDetail(
        "BRAND_SIGNATURE_LINKEDIN_LABEL",
        "linkedin.com/in/iamvarshith",
        isVendor,
      ),
      /*
       * The website is the one signature field with a sane non-vendor default:
       * the instance's own marketing site, which BRAND_MARKETING_URL already
       * knows. It used to be hardcoded to nuraview.com, so a client who set
       * every other variable still linked the vendor's site from their footer.
       */
      websiteUrl: env(
        "BRAND_SIGNATURE_WEBSITE_URL",
        isVendor ? "https://www.nuraview.com/" : marketingUrl,
      ),
      websiteLabel: env(
        "BRAND_SIGNATURE_WEBSITE_LABEL",
        isVendor ? "nuraview.com" : hostLabel(marketingUrl),
      ),
      legalLine: vendorDetail(
        "BRAND_SIGNATURE_LEGAL_LINE",
        "Nuraview, registered as Varshith KM LLC in Delaware, USA.",
        isVendor,
      ),
      addressLine: vendorDetail(
        "BRAND_SIGNATURE_ADDRESS_LINE",
        "1007 N Orange St. 4th Floor, Wilmington, DE, 19801",
        isVendor,
      ),
    },
  };
}

export default getBrand;
