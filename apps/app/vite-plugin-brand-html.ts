import { copyFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * Stamps the instance branding into index.html and the web manifest at build
 * time.
 *
 * Everything else in this app reads its brand at runtime from /api/config, and
 * that is the right default. The HTML <head> cannot: the tab title, the
 * favicon, the Open Graph card and the PWA install name are all consumed before
 * a single line of application JavaScript runs — by the browser chrome, by the
 * OS install prompt, and by link-unfurlers that never execute scripts at all.
 * A client whose CRM installs to their home screen as "NuraView" has not been
 * white-labelled.
 *
 * The VPS deployment solves the same problem with apps/app/env.sh, which
 * sed-replaces NURAVIEW_* placeholders inside the built bundle when the nginx
 * container starts. That mechanism does not exist on Vercel — there is no
 * container and no entrypoint script — so the substitution moves into the build
 * itself. Both paths read the same BRAND_* variables.
 *
 * A second job: emitting `window.__BRAND__` so the first React paint already
 * knows the brand, instead of rendering NuraView's name for the 200ms until
 * /api/config answers. See src/lib/brand.ts.
 *
 * Every value falls back to NuraView's current one, so a build with no BRAND_*
 * set produces byte-identical output to before this plugin existed.
 */

type BrandHtmlValues = {
  name: string;
  shortName: string;
  monogram: string;
  tagline: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
  /**
   * The two icons every browser asks for by convention rather than by <link>:
   * /favicon.ico and /apple-touch-icon.png. They were hardcoded to those paths
   * here, which are NuraView's files in public/ — so a white-labelled build
   * declared the client's favicon and then served the vendor's to anything that
   * went looking at the root, which Safari's bookmark and home-screen paths do.
   * Set these and the build both declares them and overwrites the root copies.
   */
  faviconIcoUrl: string;
  appleTouchIconUrl: string;
  themeColor: string;
  backgroundColor: string;
  siteUrl: string;
  ogImageUrl: string;
  /** PWA install icons. Separate from faviconUrl — different sizes, different
   *  purpose, and getting them wrong means the home-screen tile shows somebody
   *  else's logo. */
  icon192Url: string;
  icon512Url: string;
  iconMaskableUrl: string;
  /**
   * Hostnames that load Plausible. NuraView ships two (demo + cloud); a client
   * instance gets none, so BRAND_ANALYTICS_DOMAINS="" turns it off entirely
   * rather than pointing a client's traffic at NuraView's analytics.
   */
  analyticsDomains: string[];
};

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

/**
 * Whether this instance has replaced the icon set at all.
 *
 * The root-path icons cannot fall back to NuraView's the way every other value
 * in this file safely does. A client build that set BRAND_FAVICON_URL but not
 * BRAND_FAVICON_ICO_URL emitted BOTH its own icon and
 * `<link rel="icon" href="/favicon.ico" sizes="any">` — and Chrome takes the
 * .ico, because `sizes="any"` reads as "fits every size". The client's own
 * favicon was declared, deployed, and never once painted; the vendor's was.
 * That is exactly how the first white-labelled instance shipped.
 *
 * So once the favicon is overridden, the vendor's root icons stop being a
 * fallback: the .ico link is dropped (a PNG cannot be turned into one at build
 * time, and one branded icon beats two mismatched ones), the vendor's copy is
 * deleted from the output, and apple-touch falls through to the branded 192.
 */
function brandOverridesIcons(): boolean {
  return Boolean(process.env.BRAND_FAVICON_URL?.trim());
}

function readBrand(): BrandHtmlValues {
  const name = env("BRAND_NAME", "NuraView");
  const tagline = env("BRAND_TAGLINE", "Your One Stop Solution");
  const iconsOverridden = brandOverridesIcons();
  const icon192Url = env("BRAND_ICON_192_URL", "/web-app-manifest-192x192.png");

  return {
    name,
    shortName: env("BRAND_SHORT_NAME", name),
    monogram: env("BRAND_MONOGRAM", env("BRAND_SHORT_NAME", name).charAt(0)),
    tagline,
    description: env(
      "BRAND_DESCRIPTION",
      "Your One Stop Solution. Open source project management that works for you, not against you.",
    ),
    logoUrl: env("BRAND_LOGO_URL", "/nuraview-logo.png"),
    faviconUrl: env("BRAND_FAVICON_URL", "/favicon.svg"),
    // Empty means "declare no .ico at all" — see iconsOverridden above.
    faviconIcoUrl: env("BRAND_FAVICON_ICO_URL", iconsOverridden ? "" : "/favicon.ico"),
    appleTouchIconUrl: env(
      "BRAND_APPLE_TOUCH_ICON_URL",
      iconsOverridden ? icon192Url : "/apple-touch-icon.png",
    ),
    themeColor: env("BRAND_THEME_COLOR", "#141414"),
    backgroundColor: env("BRAND_BACKGROUND_COLOR", "#141414"),
    siteUrl: env("BRAND_SITE_URL", "https://nuraview.app"),
    ogImageUrl: env("BRAND_OG_IMAGE_URL", "https://assets.nuraview.app/readme.png"),
    icon192Url,
    icon512Url: env("BRAND_ICON_512_URL", "/web-app-manifest-512x512.png"),
    // Falls back to the 512, matching the previous manifest, which listed the
    // same file for both purposes.
    iconMaskableUrl: env(
      "BRAND_ICON_MASKABLE_URL",
      env("BRAND_ICON_512_URL", "/web-app-manifest-512x512.png"),
    ),
    // "none" as well as empty: Vercel refuses to store an empty environment
    // variable, so a client instance needs a sentinel to switch analytics off
    // rather than inheriting NuraView's Plausible domains.
    analyticsDomains: (process.env.BRAND_ANALYTICS_DOMAINS === undefined
      ? "demo.nuraview.app,cloud.nuraview.app"
      : process.env.BRAND_ANALYTICS_DOMAINS.trim().toLowerCase() === "none"
        ? ""
        : process.env.BRAND_ANALYTICS_DOMAINS
    )
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

/**
 * MIME type from the file extension.
 *
 * The favicon link and the manifest's first icon entry used to hardcode
 * `image/svg+xml`, which was true only while the icon was NuraView's
 * favicon.svg. Point BRAND_FAVICON_URL at a .png — as a raster-logo brand must —
 * and the declared type contradicts the actual bytes, which browsers are
 * entitled to reject.
 */
function mimeForImage(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

/** Minimal HTML-attribute escaping. Brand values are operator-supplied, but a
 *  stray quote in a tagline would silently break the surrounding tag. */
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHead(brand: BrandHtmlValues): string {
  const title = `${brand.name} - ${brand.tagline}`;
  const analytics = brand.analyticsDomains.length
    ? `
  <script>
    if (${JSON.stringify(brand.analyticsDomains)}.includes(window.location.hostname)) {
      const script = document.createElement('script');
      script.defer = true;
      script.setAttribute('data-domain', window.location.hostname);
      script.src = 'https://plausible.nuraview.app/js/script.js';
      document.head.appendChild(script);
    }
  </script>`
    : "";

  /*
   * The .ico serves browsers that ignore SVG favicons and the ones that request
   * /favicon.ico whatever the markup says. `sizes="any"` is what makes Chrome
   * prefer it over the PNG above — which is the whole point when it is branded,
   * and a silent brand leak when it is not, so an empty value omits the line
   * rather than falling back to the vendor's.
   */
  const icoLink = brand.faviconIcoUrl
    ? `\n  <link rel="icon" type="image/x-icon" href="${attr(brand.faviconIcoUrl)}" sizes="any" />`
    : "";

  return `  <title>${attr(title)}</title>
  <meta name="title" content="${attr(title)}">
  <meta name="description" content="${attr(brand.description)}">

  <meta property="og:type" content="website">
  <meta property="og:url" content="${attr(brand.siteUrl)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(brand.description)}">
  <meta property="og:image" content="${attr(brand.ogImageUrl)}">

  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${attr(brand.siteUrl)}">
  <meta property="twitter:title" content="${attr(title)}">
  <meta property="twitter:description" content="${attr(brand.description)}">
  <meta property="twitter:image" content="${attr(brand.ogImageUrl)}">

  <link rel="icon" type="${mimeForImage(brand.faviconUrl)}" href="${attr(brand.faviconUrl)}" />${icoLink}
  <link rel="apple-touch-icon" href="${attr(brand.appleTouchIconUrl)}" />
  <meta name="apple-mobile-web-app-title" content="${attr(brand.shortName)}" />
  <meta name="theme-color" content="${attr(brand.themeColor)}" />
  <link rel="manifest" href="/site.webmanifest" />

  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="application-name" content="${attr(brand.shortName)}">
  <link rel="canonical" href="${attr(brand.siteUrl)}">

  <script>window.__BRAND__ = ${JSON.stringify({
    name: brand.name,
    shortName: brand.shortName,
    monogram: brand.monogram,
    tagline: brand.tagline,
    description: brand.description,
    logoUrl: brand.logoUrl,
    faviconUrl: brand.faviconUrl,
    themeColor: brand.themeColor,
    backgroundColor: brand.backgroundColor,
  })};</script>${analytics}`;
}

/**
 * The head block is delimited in index.html so this plugin replaces a marked
 * region rather than pattern-matching individual tags. Regex-editing a <head>
 * is how you end up with two <title> elements after someone reorders it.
 */
const START = "<!-- BRAND:START -->";
const END = "<!-- BRAND:END -->";

export function brandHtml(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "brand-html",
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml(html) {
      const brand = readBrand();
      const start = html.indexOf(START);
      const end = html.indexOf(END);

      if (start === -1 || end === -1 || end < start) {
        // Loud, not silent. A missing marker means the branding quietly stops
        // being applied and the next client's build ships NuraView's title.
        throw new Error(
          `[brand-html] index.html must contain ${START} … ${END} markers around the branded <head> block`,
        );
      }

      return (
        html.slice(0, start + START.length) +
        "\n" +
        buildHead(brand) +
        "\n  " +
        html.slice(end)
      );
    },
    generateBundle() {
      const brand = readBrand();

      const icons = [
        {
          // "any", not "maskable". This entry claimed maskable while pointing
          // at an ordinary icon, so Android cropped a square artwork to its
          // safe circle and shaved the edges off the mark. Only
          // iconMaskableUrl is drawn with the safe zone in mind.
          src: brand.icon192Url,
          sizes: "192x192",
          type: mimeForImage(brand.icon192Url),
          purpose: "any",
        },
        {
          // The 512 was reachable only as a maskable, so an installing browser
          // asking for a large square icon had nothing above 192 to take.
          src: brand.icon512Url,
          sizes: "512x512",
          type: mimeForImage(brand.icon512Url),
          purpose: "any",
        },
        {
          src: brand.faviconUrl,
          sizes: "any",
          type: mimeForImage(brand.faviconUrl),
          purpose: "any",
        },
        {
          src: brand.iconMaskableUrl,
          sizes: "512x512",
          type: mimeForImage(brand.iconMaskableUrl),
          purpose: "maskable",
        },
        // A brand that points BRAND_FAVICON_URL at its own 192 — the sane
        // thing to do when the identity is one raster mark — would otherwise
        // list it twice. The measured entry is listed first so it is the one
        // that survives; `sizes: "any"` is a claim only an SVG can honour.
      ].filter(
        (icon, i, all) =>
          all.findIndex((o) => o.src === icon.src && o.purpose === icon.purpose) === i,
      );

      /*
       * Emitted rather than kept in public/, because every field in it is
       * branded — a static file would be copied verbatim and would still say
       * NuraView on a client's home screen.
       *
       * public/site.webmanifest was DELETED for this to work, not merely
       * ignored. Vite copies publicDir into outDir after generateBundle runs,
       * so a file of the same name there does not collide loudly — it silently
       * overwrites this one, and the manifest reverts to NuraView with nothing
       * in the build log to say so. Do not reintroduce it.
       */
      this.emitFile({
        type: "asset",
        fileName: "site.webmanifest",
        source: `${JSON.stringify(
          {
            name: brand.name,
            short_name: brand.shortName,
            description: brand.description,
            icons,
            theme_color: brand.themeColor,
            background_color: brand.backgroundColor,
            display: "standalone",
            // The CRM is the point of installing this, not the marketing page.
            start_url: env("BRAND_PWA_START_URL", "/leads"),
          },
          null,
          2,
        )}\n`,
      });
    },

    /*
     * Root-path icons, stamped after publicDir has been copied.
     *
     * /favicon.ico and /apple-touch-icon.png are requested by convention, not
     * from the <link> tags — Safari's Add to Home Screen, bookmark bars, RSS
     * readers and a long tail of tooling go straight to the root. Those two
     * files live in public/ and are NuraView's, so a client build that declares
     * its own icons still hands the vendor's out at the root.
     *
     * Not emitFile: Vite copies publicDir into outDir *after* generateBundle,
     * so an emitted favicon.ico is silently overwritten by NuraView's — the
     * same trap documented on site.webmanifest above. closeBundle runs last,
     * which is the only point where the copy sticks.
     */
    closeBundle() {
      const brand = readBrand();
      const brandsItsOwnIcons = brandOverridesIcons();
      const outDir = resolve(config.root, config.build.outDir);

      for (const [source, rootName] of [
        [brand.faviconIcoUrl, "favicon.ico"],
        [brand.appleTouchIconUrl, "apple-touch-icon.png"],
      ] as const) {
        // A branded instance with no .ico of its own: delete the vendor's
        // rather than leave it at the root of a client's domain, where anything
        // that guesses the path instead of reading the markup would find it.
        if (!source && brandsItsOwnIcons) {
          rmSync(join(outDir, rootName), { force: true });
          continue;
        }

        // Unset (still NuraView's own path), or hosted off-origin: nothing to
        // copy in either case.
        if (source === `/${rootName}` || !source.startsWith("/")) continue;

        const from = join(config.publicDir, source.replace(/^\//, ""));
        if (!existsSync(from)) {
          // Loud. Silently skipping leaves the vendor's icon at the root, which
          // is the exact failure this hook exists to prevent.
          throw new Error(
            `[brand-html] ${source} does not exist in ${config.publicDir} — it cannot replace /${rootName}`,
          );
        }
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }
        copyFileSync(from, join(outDir, rootName));
      }
    },
  };
}

export default brandHtml;
