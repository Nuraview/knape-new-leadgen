/**
 * Render a task description for the PUBLIC share page.
 *
 * Task descriptions are stored as MARKDOWN (task-description.tsx sends
 * `description: markdown`), but the share page was rendering them straight into
 * dangerouslySetInnerHTML. Two consequences, both reported:
 *
 *  1. Readers saw raw syntax — `[https://…](https://…)` printed literally.
 *  2. `@tiptap/markdown` backslash-escapes markdown-significant characters when
 *     it serialises, so an underscore inside a URL is stored as `\_`. Dumped as
 *     HTML that backslash is visible, and copying the link gives a broken URL:
 *     `…fny_7q06…` became `…fn\_7q06…`. That is the bug VK demonstrated.
 *
 * And a third nobody had reported yet: this is an UNAUTHENTICATED page, so
 * injecting stored text as HTML is a cross-site scripting vector. Anyone who
 * can edit a task could run script in a client's browser.
 *
 * So: escape HTML FIRST, then unescape markdown's backslashes, then convert the
 * small subset of markdown that actually appears. Order matters — escaping
 * after conversion would destroy the anchors we just built.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Only http(s) — never javascript: or data:, which is the whole point. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function renderSharedMarkdown(markdown: string): string {
  let out = escapeHtml(markdown);

  // Undo markdown's defensive backslashes: \_ \* \[ \] \( \) \` \# \- \. \!
  // This is what repairs the mangled URLs.
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");

  // [label](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, label, url) => {
    const href = safeHref(url);
    if (!href) return label;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow" class="underline">${label}</a>`;
  });

  // Bare URLs that are not already inside an anchor we just created.
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (whole, lead, url) => {
    const href = safeHref(url);
    if (!href) return whole;
    return `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer nofollow" class="underline">${url}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Paragraphs, then single line breaks.
  out = out
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return out;
}

export default renderSharedMarkdown;
