import { existsSync } from "fs";
import { buildPublicProposalUrl } from "@/lib/proposals/share-token";
import { signPdfRender } from "@/lib/proposals/pdf-sig";

// Pixel-exact proposal PDF: headless Chromium prints the REAL public proposal
// page (same route the client opens) in `?pdf=<sig>` mode — identical design,
// fonts, and brand styling. @react-pdf stays only as a last-resort fallback
// (see generate.ts); it can't render the designed HTML page.

const PRINT_TIMEOUT_MS = 60_000;

function localChromePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  // Playwright's downloaded chromium (dev machines run e2e tests already).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require("fs") as typeof import("fs");
    const cache = `${process.env.HOME || "/root"}/.cache/ms-playwright`;
    const dirs = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort();
    for (const d of dirs.reverse()) {
      for (const sub of ["chrome-linux64", "chrome-linux"]) {
        const bin = `${cache}/${d}/${sub}/chrome`;
        if (existsSync(bin)) return bin;
      }
    }
  } catch {
    /* no playwright cache — fall through */
  }
  return undefined;
}

async function launchBrowser() {
  const puppeteer = await import("puppeteer-core");
  // Self-hosted only: the container ships Chromium at /usr/bin/chromium
  // (PUPPETEER_EXECUTABLE_PATH). The @sparticuz/chromium lambda build went with
  // the Vercel migration.
  const executablePath = localChromePath();
  if (!executablePath) {
    throw new Error(
      "No local Chrome/Chromium found — set PUPPETEER_EXECUTABLE_PATH or install one",
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
}

export interface PrintProposalArgs {
  number: number | null;
  clientSlug: string | null;
  shareToken: string;
}

/**
 * Print the live public proposal page to PDF. The `pdf=<sig>` param switches
 * the page into a static print variant (no animations/tracking/interactive
 * controls) — see app/proposal/[number]/[slug]/page.tsx.
 */
export async function printProposalPdf(args: PrintProposalArgs): Promise<Buffer> {
  const url =
    buildPublicProposalUrl(args.number, args.clientSlug, args.shareToken) +
    `&pdf=${signPdfRender(args.shareToken)}`;
  if (!/^https?:\/\//.test(url)) {
    throw new Error("Public proposal base URL is not configured (NEXT_PUBLIC_PROPOSAL_URL)");
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PRINT_TIMEOUT_MS);
    // Scale 1: text/gradients stay vector in the PDF; 2x only bloats the
    // rasterized backgrounds (16MB → ~1MB attachment).
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    const resp = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: PRINT_TIMEOUT_MS,
    });
    if (!resp || resp.status() >= 400) {
      throw new Error(`Proposal page returned ${resp?.status() ?? "no response"} for PDF render`);
    }
    // The pdf-mode page renders a marker so we never print a 404/skeleton.
    await page.waitForSelector("[data-pv-pdf-ready]", { timeout: PRINT_TIMEOUT_MS });

    // Web fonts (Georgia fallback Gelasio, Geist) + straggler images.
    await page.evaluate(async () => {
      await (document as any).fonts?.ready;
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? null
            : new Promise<void>((res) => {
                img.addEventListener("load", () => res(), { once: true });
                img.addEventListener("error", () => res(), { once: true });
                setTimeout(() => res(), 10_000);
              }),
        ),
      );
    });

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: PRINT_TIMEOUT_MS,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}
