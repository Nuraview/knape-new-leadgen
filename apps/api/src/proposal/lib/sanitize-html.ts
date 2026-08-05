// Dependency-free HTML sanitizer for proposal rich-text.
//
// Why not DOMPurify: isomorphic-dompurify drags in jsdom, which fails to load
// in the Vercel/turbopack serverless runtime (ERR_REQUIRE_ESM on a transitive
// dep) and 500s the public page. The proposal body is authored by trusted,
// authenticated CRM users through a CKEditor instance, so a strict allowlist
// string sanitizer is sufficient defense-in-depth and ships zero extra deps.
//
// The allowlist is deliberately wide enough to carry CKEditor's output —
// tables, inline images, font colours, alignment — but every attribute and
// every CSS declaration is re-validated against a whitelist, so no script,
// event handler, javascript:/data: payload, or CSS url()/expression() survives.

const ALLOWED_TAGS = new Set([
  // text & inline
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "a", "span", "div", "mark", "sub", "sup",
  // headings
  "h1", "h2", "h3", "h4", "h5", "h6",
  // lists
  "ul", "ol", "li", "label",
  // blocks
  "blockquote", "code", "pre",
  // Native disclosure. The full cancellation terms sit inside one of these,
  // collapsed — on a small fixed-price proposal three paragraphs of policy
  // printed in full read as a red flag, but a line the client can click and
  // read is not hiding anything. No script, no attributes worth abusing.
  "details", "summary",
  // tables
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  // media
  "figure", "figcaption", "img",
]);

// Elements whose entire contents must be dropped (not just unwrapped).
const STRIP_WITH_CONTENT =
  "script|style|iframe|object|embed|noscript|svg|math|template|link|meta|title|head|form|button|input|select|option|textarea";

// CSS properties that are safe to keep on a public, statically-styled page.
// (No `position`, no `url()`-bearing props, no `behavior`/`-moz-binding`.)
const SAFE_STYLE_PROPS = new Set([
  "text-align", "color", "background-color", "background", "vertical-align",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-width", "border-style", "border-collapse", "border-spacing",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "line-height", "letter-spacing", "white-space",
  "list-style-type", "aspect-ratio",
]);

function safeHref(value: string): string | null {
  const v = value.trim().replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(+d));
  // Block any scripting / data / vbscript protocols (incl. obfuscated whitespace).
  const proto = v.replace(/[\s-]+/g, "").toLowerCase();
  if (/^(javascript|data|vbscript|file):/.test(proto)) return null;
  // Allow http(s), mailto, tel, anchors, and relative/path URLs.
  if (/^(https?:|mailto:|tel:|#|\/|\.)/i.test(v) || !/:/.test(v)) return v.replace(/"/g, "&quot;");
  return null;
}

// Image sources: http(s)/relative URLs, plus inline base64 raster data (NOT svg,
// which can carry script). Vercel Blob URLs are plain https and pass here.
function safeImgSrc(value: string): string | null {
  const v = value.trim();
  const proto = v.replace(/\s+/g, "").toLowerCase();
  if (/^(javascript|vbscript|file):/.test(proto)) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(v)) {
    return v.replace(/"/g, "&quot;");
  }
  if (/^data:/i.test(v)) return null; // any other data: (e.g. svg) is unsafe
  if (/^(https?:|\/|\.)/i.test(v) || !/:/.test(v)) return v.replace(/"/g, "&quot;");
  return null;
}

// Keep only whitelisted CSS declarations with inert values.
function filterStyle(value: string): string {
  const out: string[] = [];
  for (const decl of value.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    let val = decl.slice(idx + 1).trim();
    const low = val.toLowerCase();
    if (low.includes("url(") || low.includes("expression") || low.includes("javascript:") ||
        low.includes("/*") || low.includes("\\")) continue;
    // Strip characters that could break out of the style="" attribute or inject markup.
    val = val.replace(/["<>]/g, "").trim();
    if (val) out.push(`${prop}:${val}`);
  }
  return out.join(";");
}

function cleanText(v: string): string {
  return v.replace(/["<>]/g, "").trim();
}

// Parse a raw attribute string into a lowercase-keyed map (first wins).
function parseAttrs(s: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /([a-zA-Z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))|([a-zA-Z][\w:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      if (!(key in map)) map[key] = m[3] ?? m[4] ?? m[5] ?? "";
    } else if (m[6]) {
      const key = m[6].toLowerCase();
      if (!(key in map)) map[key] = "";
    }
  }
  return map;
}

// Build the safe `class` / `style` attributes shared by every allowed tag.
function commonAttrs(attrs: Record<string, string>): string[] {
  const out: string[] = [];
  if (attrs.class != null) {
    const c = cleanText(attrs.class);
    if (c) out.push(`class="${c}"`);
  }
  if (attrs.style != null) {
    const st = filterStyle(attrs.style);
    if (st) out.push(`style="${st}"`);
  }
  return out;
}

export function sanitizeProposalHtml(input: string): string {
  if (!input) return "";
  let html = input;

  // 1. Drop comments.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  // 2. Drop dangerous elements together with their content.
  html = html.replace(new RegExp(`<(${STRIP_WITH_CONTENT})[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "");
  // 3. Drop any leftover orphan opens/voids of those elements.
  html = html.replace(new RegExp(`<\\/?(${STRIP_WITH_CONTENT})\\b[^>]*>`, "gi"), "");

  // 4. Rewrite every remaining tag: allowlist the name, keep only safe attrs.
  //    The capture is quote-aware so `>` inside an attribute value is preserved.
  html = html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (_full, slash: string, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return ""; // unwrap unknown tag (keep its text)
      if (slash) return `</${name}>`;

      const attrs = parseAttrs(rawAttrs);
      const common = commonAttrs(attrs);

      if (name === "a") {
        const href = attrs.href ? safeHref(attrs.href) : null;
        const hrefAttr = href ? ` href="${href}"` : "";
        const extra = common.length ? " " + common.join(" ") : "";
        return `<a${hrefAttr} target="_blank" rel="noopener noreferrer nofollow"${extra}>`;
      }

      if (name === "img") {
        const src = attrs.src ? safeImgSrc(attrs.src) : null;
        if (!src) return ""; // drop images with a missing/unsafe source
        const parts = [`src="${src}"`, `alt="${cleanText(attrs.alt ?? "")}"`];
        if (attrs.width && /^\d+$/.test(attrs.width)) parts.push(`width="${attrs.width}"`);
        if (attrs.height && /^\d+$/.test(attrs.height)) parts.push(`height="${attrs.height}"`);
        return `<img ${[...parts, ...common].join(" ")} />`;
      }

      if (name === "td" || name === "th") {
        for (const k of ["colspan", "rowspan"]) {
          if (attrs[k] && /^\d+$/.test(attrs[k])) common.push(`${k}="${attrs[k]}"`);
        }
        if (name === "th" && /^(row|col|rowgroup|colgroup)$/.test(attrs.scope ?? "")) {
          common.push(`scope="${attrs.scope}"`);
        }
        return `<${name}${common.length ? " " + common.join(" ") : ""}>`;
      }

      if (name === "col") {
        if (attrs.span && /^\d+$/.test(attrs.span)) common.push(`span="${attrs.span}"`);
        return `<col${common.length ? " " + common.join(" ") : ""} />`;
      }

      // All other allowed tags: emit with the safe class/style only.
      return `<${name}${common.length ? " " + common.join(" ") : ""}>`;
    },
  );

  return html;
}
