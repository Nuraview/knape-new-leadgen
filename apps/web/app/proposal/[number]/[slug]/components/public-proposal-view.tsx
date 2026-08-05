"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as LucideIcons from "lucide-react";
import {
  Building2,
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  PenLine,
} from "lucide-react";
import { ApprovalPanel, type PaymentInfo } from "./approval-panel";
import { PaymentPanel } from "./payment-panel";
import { PAYMENT_METHOD_META, PAYMENT_METHODS, type PaymentMethod } from "@/types/proposal";
import { tierUnitPrice } from "@/lib/proposals/tiers";

const PdfViewer = dynamic(() => import("./pdf-viewer"), { ssr: false });

interface LineItem {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRateSnapshot: string | null;
  clientAdjustable: boolean;
  minQty: string | null;
  maxQty: string | null;
  tiers?: { minQty: number; unitPrice: number }[] | null;
}
interface ScopeItem {
  title: string;
  description?: string;
  /** lucide icon name (e.g. "LayoutDashboard") or an uploaded image URL. */
  icon?: string | null;
  bullets?: string[];
}
interface PricingRow {
  item: string;
  type?: string;
  amount?: string | number;
  included?: boolean;
}
interface Testimonial {
  name: string;
  role?: string;
  quote: string;
  avatarUrl?: string | null;
  rating?: number;
  highlight?: string;
}
interface Section {
  key: string;
  title: string;
  type?: string;
  bodyHtml: string;
  bannerUrl?: string | null;
  items?: ScopeItem[];
  phases?: { label: string; duration: string }[];
  clientField?: { label: string; unit: "days" | "hours" } | null;
  // pricing-table section
  rows?: PricingRow[];
  totalLabel?: string;
  totalAmount?: string | number;
  totalType?: string;
  // testimonials section
  testimonials?: Testimonial[];
}
interface Asset {
  id: string;
  title: string | null;
  kind: string;
  category?: string | null;
  featured?: boolean | null;
  externalUrl?: string | null;
}
interface DesignTokens {
  accentColor?: string; fontDisplay?: string; fontBody?: string; bg?: string; layout?: string;
}
interface PortfolioConfig {
  recentTitle?: string; generalTitle?: string; note?: string;
  links?: { label?: string; url?: string }[];
  linkUrl?: string; linkLabel?: string;
  // hero / presentation
  subtitle?: string;
  titleAccentWord?: string | null;
  logoTagline?: string | null;
  preparedForRole?: string | null;
  showInvestment?: boolean;
  showValidity?: boolean;
  validDays?: number | null;
}
interface Proposal {
  id: string; title: string; status: string; currency: string; number: number | null;
  clientName: string | null; clientCompany: string | null; projectName: string | null;
  clientEmail: string | null; clientAddress: string | null;
  proposalDate: string | null; expiresAt?: string | null; sentAt?: string | null;
  transactionFee: string; brandColor: string | null;
  /** Staged billing — the agreed upfront amount and the draft total it was set against. */
  depositAmount?: string | number | null; grandTotal?: string | number | null;
  videoUrl: string | null; scheduleCallUrl: string | null; theme: string | null;
  designTokens: DesignTokens | null;
  portfolioConfig?: PortfolioConfig | null;
  sections: Section[] | null; lineItems: LineItem[]; assets: Asset[];
}

function toEmbedUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const loom = u.match(/loom\.com\/(?:share|embed)\/([\w-]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  return u;
}
interface Settings {
  brandColor: string | null; companyName: string | null; companyWebsite: string | null;
  footerText: string | null; clientAvatars: string[] | null; logoStorageKey: string | null;
  scheduleCallUrl: string | null; postSignRedirectUrl: string | null;
}
type PaymentState = PaymentInfo;

// Timeline math: take the MINIMUM of each phase's range ("1–2 days" -> 1) and sum.
function minDuration(d: string): { days: number; hours: number } {
  const s = (d || "").toLowerCase();
  const m = s.match(/\d+(?:\.\d+)?/);
  const v = m ? parseFloat(m[0]) : 0;
  if (/hour|hr/.test(s)) return { days: 0, hours: v };
  if (/week/.test(s)) return { days: v * 7, hours: 0 };
  return { days: v, hours: 0 };
}
function sumMinDuration(phases: { duration: string }[]): { days: number; hours: number } {
  return phases.reduce(
    (acc, p) => {
      const m = minDuration(p.duration);
      return { days: acc.days + m.days, hours: acc.hours + m.hours };
    },
    { days: 0, hours: 0 },
  );
}
function fmtDuration(t: { days: number; hours: number }): string {
  const out: string[] = [];
  if (t.days) out.push(`${Number.isInteger(t.days) ? t.days : t.days.toFixed(1)} ${t.days === 1 ? "day" : "days"}`);
  if (t.hours) out.push(`${Number.isInteger(t.hours) ? t.hours : t.hours.toFixed(1)} ${t.hours === 1 ? "hr" : "hrs"}`);
  return out.join(" ") || "0 days";
}

function calcLine(qty: number, unitPrice: number, discountPct: number, taxRate: number) {
  const gross = qty * unitPrice;
  const discount = (gross * discountPct) / 100;
  const sub = Math.round((gross - discount) * 100) / 100;
  const vat = Math.round(((sub * taxRate) / 100) * 100) / 100;
  return { sub, vat, total: Math.round((sub + vat) * 100) / 100 };
}

// Headings use the editorial serif (Georgia, per client). PDF Chromium has no
// system Georgia — Gelasio (metric-compatible) is loaded in pdfMode.
const DISPLAY_FAMILY = "Georgia, 'Times New Roman', serif";
const PDF_DISPLAY_FAMILY = "Georgia, Gelasio, 'Times New Roman', serif";

// Render a scope-card icon: a lucide icon by name, or an uploaded image URL.
function ScopeIcon({ icon, brand }: { icon?: string | null; brand: string }) {
  const style = {
    background: `linear-gradient(135deg, ${brand}, ${brand}cc)`,
  } as const;
  let inner: React.ReactNode;
  if (icon && /^https?:\/\//.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    inner = <img src={icon} alt="" className="h-5 w-5 object-contain" />;
  } else {
    const Cmp = (icon && (LucideIcons as any)[icon]) || LucideIcons.Sparkles;
    inner = <Cmp className="h-5 w-5 text-white" strokeWidth={2} />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm" style={style}>
      {inner}
    </span>
  );
}

function Stars({ n = 5, brand }: { n?: number; brand: string }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <LucideIcons.Star
          key={i}
          className="h-4 w-4"
          style={{ color: brand, fill: i < n ? brand : "transparent" }}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

export function PublicProposalView({
  proposal, settings, token, alreadyDecided, pdfMode = false,
}: {
  proposal: Proposal; settings: Settings | null; token: string; alreadyDecided: boolean;
  /** Static print variant for the headless-Chromium PDF render. */
  pdfMode?: boolean;
}) {
  const tokens = proposal.designTokens ?? {};
  const cfg = proposal.portfolioConfig ?? {};
  const brand = tokens.accentColor || proposal.brandColor || settings?.brandColor || "#e2611e";
  const displayFamily = pdfMode ? PDF_DISPLAY_FAMILY : DISPLAY_FAMILY;
  const DISPLAY = { fontFamily: displayFamily } as const;

  const allSections = (proposal.sections ?? []).filter(
    (s) =>
      (s.bodyHtml && s.bodyHtml.trim()) ||
      (s.items && s.items.some((it) => it.title || it.description || (it.bullets && it.bullets.length))) ||
      (s.phases && s.phases.length > 0) ||
      (s.rows && s.rows.length > 0) ||
      (s.testimonials && s.testimonials.length > 0) ||
      s.bannerUrl,
  );

  const [clientTimeline, setClientTimeline] = useState<{ value: number; unit: "days" | "hours" } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const li of (proposal.lineItems ?? [])) init[li.position] = parseFloat(li.quantity) || 1;
    return init;
  });
  const [decided, setDecided] = useState(alreadyDecided);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bank");

  const fmt = useMemo(() => (n: number) => {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: proposal.currency, currencyDisplay: "narrowSymbol" }).format(n); }
    catch { return `$${n.toFixed(2)}`; }
  }, [proposal.currency]);

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const li of (proposal.lineItems ?? [])) {
      const qty = quantities[li.position] ?? (parseFloat(li.quantity) || 0);
      const unit = tierUnitPrice(parseFloat(li.unitPrice) || 0, qty, li.tiers);
      const r = calcLine(qty, unit, parseFloat(li.discountPercent) || 0, parseFloat(li.taxRateSnapshot ?? "0") || 0);
      subtotal += r.sub; tax += r.vat;
    }
    const base = Math.round((subtotal + tax) * 100) / 100;
    const pct = PAYMENT_METHOD_META[method].pct;
    const fee = Math.round(base * pct) / 100;
    const grand = Math.round((base + fee) * 100) / 100;
    /*
     * Staged billing ("25% upfront"). The ratio comes from the draft — the
     * agreed percentage — and is applied to the LIVE total so this matches what
     * the approve endpoint charges, fee and adjusted quantities included.
     */
    const stored = Number(proposal.depositAmount ?? 0) || 0;
    const basis = Number(proposal.grandTotal ?? 0) || 0;
    const ratio = stored > 0 && basis > 0 ? stored / basis : 0;
    const staged = ratio > 0 && ratio < 0.995 && grand > 0;
    const dueNow = staged ? Math.round(grand * ratio * 100) / 100 : null;
    return {
      subtotal, tax, fee, pct, base, grand,
      depositPct: staged ? Math.round(ratio * 100) : null,
      dueNow,
      remaining: dueNow == null ? null : Math.round((grand - dueNow) * 100) / 100,
    };
  }, [quantities, proposal.lineItems, proposal.depositAmount, proposal.grandTotal, method]);

  const setQty = (pos: number, v: number, min: number, max: number | null) => {
    let n = v; if (n < min) n = min; if (max != null && n > max) n = max;
    setQuantities((p) => ({ ...p, [pos]: n }));
  };

  // ---- Hero meta ----
  const sentDate = proposal.sentAt || proposal.proposalDate;
  const sentStr = sentDate
    ? new Date(sentDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;
  const validDays = useMemo(() => {
    if (typeof cfg.validDays === "number") return cfg.validDays;
    if (proposal.expiresAt && sentDate) {
      const d = Math.round((new Date(proposal.expiresAt).getTime() - new Date(sentDate).getTime()) / 86400000);
      return d > 0 ? d : null;
    }
    return null;
  }, [cfg.validDays, proposal.expiresAt, sentDate]);
  const showValidity = cfg.showValidity !== false && validDays != null;

  const numStr = String(proposal.number ?? "").padStart(4, "0");
  // Repeated band for the drifting hero watermark (duplicated below for a
  // seamless -50% loop). A few repeats so one copy always overflows the viewport.
  const marqueeBand = Array.from({ length: 4 }).map(() => proposal.title).join(" · ") + " · ";
  const firstName = (proposal.clientName || "").trim().split(/\s+/)[0] || proposal.clientCompany || "there";
  const preparedForCompany = proposal.clientCompany || proposal.clientName || "you";
  const accentWord = cfg.titleAccentWord === null ? "" : (cfg.titleAccentWord || "Proposal");
  const subtitle = cfg.subtitle;

  // ---- Section routing ----
  const intro = allSections.find((s) => s.key === "intro" && s.bodyHtml?.trim());
  const terms = allSections.find((s) => s.key === "terms");
  const contentSections = allSections.filter((s) => s !== intro && s !== terms);
  const testimonialSections = contentSections.filter(
    (s) => s.type === "testimonials" || (s.testimonials && s.testimonials.length > 0),
  );
  const flowSections = contentSections.filter((s) => !testimonialSections.includes(s));
  const embed = proposal.videoUrl ? toEmbedUrl(proposal.videoUrl) : null;

  const companyName = settings?.companyName ?? "NuraView";
  const logoTagline = cfg.logoTagline ?? null;
  const showInvestmentHighlight = cfg.showInvestment !== false && (proposal.lineItems?.length ?? 0) > 0;
  const preparedForRole = cfg.preparedForRole ?? (proposal.clientName && proposal.clientCompany ? "Principal" : null);

  // Investment highlight number = the grand total (base + no-fee direct transfer).
  const highlightAmount = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const li of (proposal.lineItems ?? [])) {
      const qty = parseFloat(li.quantity) || 0;
      const unit = tierUnitPrice(parseFloat(li.unitPrice) || 0, qty, li.tiers);
      const r = calcLine(qty, unit, parseFloat(li.discountPercent) || 0, parseFloat(li.taxRateSnapshot ?? "0") || 0);
      subtotal += r.sub; tax += r.vat;
    }
    return Math.round((subtotal + tax) * 100) / 100;
  }, [proposal.lineItems]);

  const pageBg = "#f7f4ef";

  return (
    <div
      className="pv-root min-h-screen text-stone-900"
      style={{ backgroundColor: pageBg, ["--pv-accent" as string]: brand }}
      {...(pdfMode ? { "data-pv-pdf-ready": "" } : {})}
    >
      {pdfMode && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gelasio:ital,wght@0,400..700;1,400..700&display=block"
        />
      )}
      <style>{`
        .pv-root { --pv-ink:#1c1917; }
        html, body { background:${pageBg}; }
        @keyframes pv-rise { from { opacity:0; transform: translateY(16px) } to { opacity:1; transform:none } }
        .pv-rise { animation: pv-rise .7s cubic-bezier(.2,.7,.2,1) both }
        /* Hero watermark: two identical bands; shifting the track by exactly half
           its width (one band) loops seamlessly with no visible jump. Deliberately
           NOT gated on prefers-reduced-motion — this drift is a requested design
           element, and OS "reduce animations" was silently freezing it. */
        @keyframes pv-marq { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .pv-marquee { animation: pv-marq 28s linear infinite; will-change: transform; }
        .pv-prose :where(p){ margin:.5rem 0 } .pv-prose :where(ul){ margin:.5rem 0; padding-left:1.1rem; list-style:disc }
        .pv-prose :where(ol){ margin:.5rem 0; padding-left:1.1rem; list-style:decimal } .pv-prose :where(li){ margin:.25rem 0 }
        .pv-prose :where(strong){ color:var(--pv-ink); font-weight:600 } .pv-prose :where(a){ color:var(--pv-accent); text-decoration:underline; text-underline-offset:2px }
        .pv-prose :where(h1,h2,h3,h4){ font-family:${displayFamily}; color:var(--pv-ink); font-weight:600; line-height:1.15; margin:1.1rem 0 .5rem }
        .pv-prose :where(h1){ font-size:2rem } .pv-prose :where(h2){ font-size:1.6rem } .pv-prose :where(h3){ font-size:1.3rem } .pv-prose :where(h4){ font-size:1.1rem }
        .pv-prose :where(blockquote){ border-left:3px solid var(--pv-accent); padding-left:1rem; margin:.75rem 0; color:#57534e; font-style:italic }
        .pv-prose :where(hr){ border:none; border-top:1px solid rgba(0,0,0,.12); margin:1.25rem 0 }
        .pv-prose :where(table){ border-collapse:collapse; width:100%; font-size:.95em }
        .pv-prose :where(td,th){ border:1px solid rgba(0,0,0,.15); padding:.5rem .65rem; vertical-align:top; text-align:left }
        .pv-prose :where(th){ background:rgba(0,0,0,.04); font-weight:600 }
        .pv-prose :where(img){ max-width:100%; height:auto; border-radius:.5rem }
        .pv-noscroll { -ms-overflow-style:none; scrollbar-width:none; }
        .pv-noscroll::-webkit-scrollbar { display:none; }
        ${pdfMode ? `
        .pv-rise, .pv-root * { animation: none !important; }
        .pv-avoid { break-inside: avoid; }
        section { break-inside: avoid-page; }
        ` : ""}
      `}</style>

      {/* ═══════════════ HERO (dark) ═══════════════ */}
      <header className="relative overflow-hidden bg-[#0e0d0c] text-white">
        {/* watermark title — smooth, seamless side-to-side marquee */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden">
          <div
            className="pv-marquee flex shrink-0 select-none leading-none"
            style={{ ...DISPLAY, fontSize: "clamp(4rem,13vw,12rem)", fontWeight: 800, color: "#ffffff", opacity: 0.05 }}
          >
            <span className="whitespace-nowrap pr-[0.3em]">{marqueeBand}</span>
            <span className="whitespace-nowrap pr-[0.3em]">{marqueeBand}</span>
          </div>
        </div>
        {/* accent wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(90% 60% at 50% -10%, ${brand}33, transparent 60%), radial-gradient(60% 50% at 90% 120%, ${brand}22, transparent 60%)` }}
        />

        <div className="relative mx-auto max-w-6xl px-6 sm:px-10">
          {/* top bar */}
          <div className="flex items-center justify-between gap-4 py-6">
            <div className="flex items-center gap-3">
              {settings?.logoStorageKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logoStorageKey} alt={companyName} className="h-7 object-contain" />
              ) : (
                <span className="flex items-center gap-2">
                  <LucideIcons.Hexagon className="h-5 w-5" style={{ color: brand }} fill={brand} strokeWidth={0} />
                  <span className="text-sm font-bold uppercase tracking-[0.22em]">{companyName}</span>
                </span>
              )}
              {logoTagline && (
                <span className="hidden text-[10px] uppercase tracking-[0.3em] text-white/40 sm:inline">
                  {logoTagline}
                </span>
              )}
              <span className="ml-2 hidden text-[11px] uppercase tracking-[0.28em] text-white/40 sm:inline">
                Proposal #{numStr}
              </span>
            </div>
            {!pdfMode && (
              <div className="flex items-center gap-3">
                <span className="hidden text-sm text-white/60 md:inline">Ready to move forward?</span>
                {(proposal.scheduleCallUrl || settings?.scheduleCallUrl) && (
                  <a
                    href={(proposal.scheduleCallUrl || settings?.scheduleCallUrl)!}
                    target="_blank" rel="noreferrer"
                    className="hidden items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm text-white/90 transition hover:bg-white/10 sm:inline-flex"
                  >
                    <Calendar className="h-4 w-4" /> Schedule a call
                  </a>
                )}
                <a
                  href="#approve"
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
                  style={{ backgroundColor: brand }}
                >
                  <PenLine className="h-4 w-4" /> Review &amp; Sign
                </a>
              </div>
            )}
          </div>

          {/* hero body */}
          <div className="pb-20 pt-10 text-center sm:pt-16">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: brand }} />
              Prepared exclusively for {preparedForCompany}
            </div>
            <h1 style={DISPLAY} className="mx-auto max-w-3xl text-balance text-5xl font-semibold leading-[1.05] sm:text-6xl">
              {proposal.title}
              {accentWord && (
                <>
                  <br />
                  <span style={{ color: brand }}>{accentWord}</span>
                </>
              )}
            </h1>
            {subtitle && (
              <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-white/55">{subtitle}</p>
            )}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/45">
              {sentStr && (
                <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Sent {sentStr}</span>
              )}
              {showValidity && (
                <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Valid for {validDays} days</span>
              )}
            </div>
            {embed && !pdfMode && (
              <div className="mx-auto mt-10 aspect-video w-full max-w-2xl overflow-hidden rounded-2xl ring-1 ring-white/10">
                <iframe src={embed} title="Intro video" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════ BODY ═══════════════ */}
      <main className="relative mx-auto max-w-6xl px-6 sm:px-10">
        {/* Intro + prepared-for card */}
        <section className="grid gap-8 py-14 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="pv-rise">
            {proposal.clientName && (
              <h2 style={DISPLAY} className="mb-5 text-4xl font-semibold text-stone-900">Hi {firstName},</h2>
            )}
            {intro?.bodyHtml ? (
              <div className="pv-prose max-w-2xl text-[16px] leading-[1.8] text-stone-600" dangerouslySetInnerHTML={{ __html: intro.bodyHtml }} />
            ) : (
              <p className="max-w-2xl text-[16px] leading-[1.8] text-stone-600">
                Thank you for the opportunity. Below is everything we&apos;ve prepared for {preparedForCompany} —
                the scope, timeline, and investment, in one place.
              </p>
            )}
          </div>

          <aside className="pv-avoid rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_20px_50px_-30px_rgba(0,0,0,.4)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400">Prepared for</div>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ backgroundColor: brand }}>
                {(proposal.clientName || preparedForCompany).trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold text-stone-900">{proposal.clientName || preparedForCompany}</div>
                {preparedForRole && <div className="text-xs text-stone-500">{preparedForRole}</div>}
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-stone-600">
              {proposal.clientCompany && (
                <div className="flex items-center gap-2"><Building2 className="h-4 w-4 shrink-0" style={{ color: brand }} /><span className="truncate">{proposal.clientCompany}</span></div>
              )}
              {proposal.clientEmail && (
                <div className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0" style={{ color: brand }} /><span className="truncate">{proposal.clientEmail}</span></div>
              )}
            </div>
            {showInvestmentHighlight && (
              <div className="mt-5 flex items-baseline justify-between border-t border-stone-200 pt-4">
                <span className="text-sm text-stone-500">Investment</span>
                <span style={DISPLAY} className="text-2xl font-semibold tabular-nums" >{fmt(highlightAmount)}</span>
              </div>
            )}
          </aside>
        </section>

        {/* Numbered content sections */}
        {flowSections.map((s, i) => {
          const n = i + 1;
          const isScopeCards = s.items && s.items.some((it) => it.bullets && it.bullets.length);
          return (
            <section key={s.key} className="border-t border-stone-200/70 py-14">
              <SectionHead n={n} title={s.title} brand={brand} display={DISPLAY} />
              {s.bannerUrl && <Banner url={s.bannerUrl} />}

              {isScopeCards ? (
                <div className="grid gap-5 md:grid-cols-3">
                  {s.items!.filter((it) => it.title || (it.bullets && it.bullets.length)).map((it, k) => (
                    <div key={k} className="pv-avoid rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_16px_40px_-30px_rgba(0,0,0,.35)]">
                      <ScopeIcon icon={it.icon} brand={brand} />
                      <div className="mt-4 font-semibold text-stone-900" style={DISPLAY}>{it.title}</div>
                      {it.description && <div className="mt-1 text-sm text-stone-500">{it.description}</div>}
                      {it.bullets && it.bullets.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {it.bullets.filter(Boolean).map((b, bi) => (
                            <li key={bi} className="flex gap-2 text-[13.5px] leading-snug text-stone-600">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: brand }} />
                              <span dangerouslySetInnerHTML={{ __html: b }} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : s.type === "scope" && s.items ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {s.items.filter((it) => it.title || it.description).map((it, k) => (
                    <div key={k} className="pv-avoid rounded-2xl border border-stone-200 bg-white p-5">
                      <div className="flex items-center gap-3">
                        <ScopeIcon icon={it.icon} brand={brand} />
                        <div className="font-semibold text-stone-900" style={DISPLAY}>{it.title}</div>
                      </div>
                      {it.description && <div className="mt-2 text-[15px] leading-relaxed text-stone-600">{it.description}</div>}
                    </div>
                  ))}
                </div>
              ) : s.type === "timeline" && s.phases ? (
                <TimelineBlock s={s} brand={brand} display={DISPLAY} decided={decided || pdfMode}
                  clientTimeline={clientTimeline} setClientTimeline={setClientTimeline} />
              ) : (s.type === "pricing" || s.rows) && s.rows ? (
                <PricingTable s={s} brand={brand} />
              ) : (
                s.bodyHtml && (
                  <div className="pv-prose max-w-3xl text-[16px] leading-[1.8] text-stone-600" dangerouslySetInnerHTML={{ __html: s.bodyHtml }} />
                )
              )}
            </section>
          );
        })}

        {/* Portfolio */}
        {(["RECENT", "GENERAL"] as const).map((catKey) => {
          const items = proposal.assets
            .filter((a) => (a.category ?? "GENERAL") === catKey)
            .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
          if (items.length === 0) return null;
          const heading =
            catKey === "RECENT"
              ? cfg.recentTitle || "Recent work — for your industry"
              : cfg.generalTitle || "Selected work";
          return (
            <section key={catKey} className="border-t border-stone-200/70 py-14">
              <h2 style={DISPLAY} className="mb-6 text-3xl font-semibold text-stone-900">{heading}</h2>
              <Carousel staticGrid={pdfMode}>
                {items.map((a) => {
                  const src = `/api/proposals/public/${token}/asset/${a.id}`;
                  const isPdf = a.kind !== "IMAGE";
                  return (
                    <button type="button" key={a.id}
                      onClick={() => (isPdf ? setViewer({ url: src, title: a.title || "Document" }) : window.open(src, "_blank"))}
                      className="pv-avoid group w-[280px] shrink-0 snap-start overflow-hidden rounded-2xl bg-white text-left ring-1 ring-stone-200 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,.35)] sm:w-[300px]">
                      <div className="relative h-52 overflow-hidden bg-stone-100">
                        {a.kind === "IMAGE" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt={a.title ?? ""} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                        ) : pdfMode ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-stone-50">
                            <span className="flex h-14 w-11 items-start justify-end rounded-sm border border-stone-300 bg-white p-1 shadow-sm">
                              <span className="text-[9px] font-semibold tracking-wider text-stone-400">PDF</span>
                            </span>
                            <span className="text-xs text-stone-400">Document attached online</span>
                          </div>
                        ) : (
                          <iframe src={`${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={a.title ?? "preview"} className="pointer-events-none h-full w-[calc(100%+18px)]" loading="lazy" />
                        )}
                      </div>
                      <div className="flex items-center justify-between px-4 py-3.5">
                        <span className="truncate text-sm font-medium text-stone-800">{a.title || "Untitled"}</span>
                        <span className="text-[10px] uppercase tracking-widest text-stone-400">{a.kind}</span>
                      </div>
                    </button>
                  );
                })}
              </Carousel>
            </section>
          );
        })}

        {/* Investment — payment method + total (drives signing) */}
        {proposal.lineItems.length > 0 && (
          <section className="border-t border-stone-200/70 py-14">
            <SectionHead n={flowSections.length + 1} title="Investment" brand={brand} display={DISPLAY} />
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_24px_60px_-40px_rgba(0,0,0,.4)]">
              <div className="divide-y divide-stone-100">
                {proposal.lineItems.map((li) => {
                  const qty = quantities[li.position] ?? (parseFloat(li.quantity) || 0);
                  const base = parseFloat(li.unitPrice) || 0;
                  const unit = tierUnitPrice(base, qty, li.tiers);
                  const r = calcLine(qty, unit, parseFloat(li.discountPercent) || 0, parseFloat(li.taxRateSnapshot ?? "0") || 0);
                  return (
                    <div key={li.id} className="pv-avoid flex items-center gap-4 px-6 py-5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] text-stone-800">{li.description}</div>
                        <div className="mt-0.5 text-xs text-stone-400">{fmt(unit)} each{unit < base ? <span style={{ color: brand }}> · volume price</span> : null}</div>
                      </div>
                      {li.clientAdjustable && !decided && !pdfMode ? (
                        <div className="flex items-center overflow-hidden rounded-full ring-1 ring-stone-200">
                          <button type="button" aria-label="decrease" className="h-9 w-9 text-lg leading-none text-stone-500 hover:bg-stone-50"
                            onClick={() => setQty(li.position, qty - 1, li.minQty ? parseFloat(li.minQty) : 1, li.maxQty ? parseFloat(li.maxQty) : null)}>−</button>
                          <span className="w-9 text-center text-sm font-medium tabular-nums">{qty}</span>
                          <button type="button" aria-label="increase" className="h-9 w-9 text-lg leading-none text-white" style={{ backgroundColor: brand }}
                            onClick={() => setQty(li.position, qty + 1, li.minQty ? parseFloat(li.minQty) : 1, li.maxQty ? parseFloat(li.maxQty) : null)}>+</button>
                        </div>
                      ) : (
                        <span className="text-sm tabular-nums text-stone-400">×{qty}</span>
                      )}
                      <div className="w-28 text-right text-[15px] font-medium tabular-nums">{fmt(r.total)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="pv-avoid border-t border-stone-100 bg-stone-50/60 px-6 py-6">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400">Payment method</div>
                <div className="mb-3 text-xs text-stone-400">Select how you&apos;d like to process payment</div>
                <div className="space-y-2.5">
                  {PAYMENT_METHODS.map((m) => {
                    const meta = PAYMENT_METHOD_META[m];
                    const active = method === m;
                    return (
                      <button
                        key={m} type="button" disabled={decided}
                        onClick={() => !decided && setMethod(m)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-70 ${active ? "" : "border-stone-200 bg-white hover:border-stone-300"}`}
                        style={active ? { borderColor: brand, backgroundColor: `${brand}0d`, boxShadow: `0 0 0 1px ${brand}` } : undefined}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? "" : "border-stone-300"}`} style={active ? { borderColor: brand } : undefined}>
                          {active && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: brand }} />}
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-medium text-stone-800">{meta.label}</span>
                          <span className="block text-xs text-stone-400">{meta.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 space-y-1 border-t border-stone-200 pt-4">
                  <Row label="Base amount" value={fmt(totals.base)} />
                  {totals.fee > 0 && <Row label={`Processing fee · ${PAYMENT_METHOD_META[method].label} ${totals.pct}%`} value={fmt(totals.fee)} />}
                </div>
                {totals.dueNow != null ? (
                  <>
                    <div className="mt-3 space-y-1 border-t border-stone-200 pt-4">
                      <Row label="Contract total" value={fmt(totals.grand)} />
                      <Row label={`Balance on completion (${100 - (totals.depositPct ?? 0)}%)`} value={fmt(totals.remaining ?? 0)} />
                    </div>
                    <div className="mt-3 flex items-baseline justify-between border-t border-stone-200 pt-4">
                      <span className="text-xs uppercase tracking-[0.25em] text-stone-400">Due on signing ({totals.depositPct}%)</span>
                      <span style={{ ...DISPLAY, color: brand }} className="text-4xl font-semibold tabular-nums">{fmt(totals.dueNow)}</span>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex items-baseline justify-between border-t border-stone-200 pt-4">
                    <span className="text-xs uppercase tracking-[0.25em] text-stone-400">Total due</span>
                    <span style={{ ...DISPLAY, color: brand }} className="text-4xl font-semibold tabular-nums">{fmt(totals.grand)}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Terms */}
        {terms && (terms.bodyHtml?.trim() || terms.bannerUrl) && (
          <section className="border-t border-stone-200/70 py-14">
            <h2 style={DISPLAY} className="mb-4 text-2xl font-semibold text-stone-900">{terms.title || "Terms & Conditions"}</h2>
            {terms.bannerUrl && <Banner url={terms.bannerUrl} />}
            {terms.bodyHtml && (
              <div className="pv-prose max-w-3xl text-[15px] leading-[1.7] text-stone-600" dangerouslySetInnerHTML={{ __html: terms.bodyHtml }} />
            )}
          </section>
        )}

        {/* Testimonials — one-at-a-time slider */}
        {testimonialSections.map((s) => {
          const list = s.testimonials ?? [];
          if (!list.length) return null;
          return (
            <section key={s.key} className="border-t border-stone-200/70 py-14">
              <h2 style={DISPLAY} className="mb-6 text-3xl font-semibold text-stone-900">{s.title || "Testimonials"}</h2>
              <TestimonialSlider list={list} brand={brand} display={DISPLAY} pdfMode={pdfMode} />
            </section>
          );
        })}

        {/* Approve / pay */}
        <section id="approve" className="scroll-mt-6 border-t border-stone-200/70 py-14">
          <h2 style={DISPLAY} className="mb-6 text-3xl font-semibold text-stone-900">Proposal Authorization</h2>
          {pdfMode ? (
            <div className="pv-avoid rounded-2xl border border-stone-200 bg-white p-10 text-center">
              <div style={DISPLAY} className="text-2xl font-semibold text-stone-900">Ready to move forward?</div>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                This PDF is a copy for your records. To approve, sign and pay online, open the proposal link in the email this document arrived with.
              </p>
            </div>
          ) : payment ? (
            <PaymentPanel token={token} amount={payment.amount} currency={proposal.currency} method={payment.method}
              clientSecret={payment.clientSecret} invoiceId={payment.invoiceId} bank={payment.bank ?? null}
              paypalConfigured={payment.paypalConfigured ?? false} fmt={fmt} />
          ) : decided ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center">
              <div style={DISPLAY} className="text-3xl font-semibold">Thank you</div>
              <p className="mt-2 text-stone-500">This proposal has been responded to.</p>
            </div>
          ) : (
            <ApprovalPanel token={token} brand={brand} quantities={quantities} clientTimeline={clientTimeline}
              method={method}
              redirectUrl={settings?.postSignRedirectUrl ?? null}
              onApproved={(p: PaymentState | null) => { setDecided(true); if (p) setPayment(p); }}
              onRejected={() => setDecided(true)} />
          )}
        </section>
      </main>

      {/* footer */}
      <footer className="mt-6 bg-[#0e0d0c] py-8 text-white/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 sm:px-10 text-xs">
          <span>
            {settings?.footerText || `This proposal is confidential and prepared exclusively for ${preparedForCompany}`}
            {` · Proposal #${numStr}`}
            {sentStr ? ` · ${sentStr}` : ""}
          </span>
          <span className="inline-flex items-center gap-1.5">
            Powered by
            <LucideIcons.Hexagon className="h-3.5 w-3.5" style={{ color: brand }} fill={brand} strokeWidth={0} />
            <span className="font-semibold uppercase tracking-widest text-white/70">{companyName}</span>
          </span>
        </div>
      </footer>

      {viewer && <PdfViewer url={viewer.url} title={viewer.title} onClose={() => setViewer(null)} />}

      {/* Sticky CTA */}
      {!decided && !payment && !pdfMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/85 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-sm text-stone-600">Ready to move forward?</span>
            <div className="flex items-center gap-2">
              {(proposal.scheduleCallUrl || settings?.scheduleCallUrl) && (
                <a href={(proposal.scheduleCallUrl || settings?.scheduleCallUrl)!} target="_blank" rel="noreferrer"
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-700 transition hover:bg-stone-50">
                  Schedule a call
                </a>
              )}
              <a href="#approve" className="rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110" style={{ backgroundColor: brand }}>
                Review &amp; Sign
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────── sub-components ─────────────── */

function SectionHead({ n, title, brand, display }: { n: number; title: string; brand: string; display: { fontFamily: string } }) {
  return (
    <div className="mb-8 flex items-center gap-4">
      <span style={{ ...display, color: `${brand}` }} className="text-5xl font-semibold tabular-nums opacity-20">
        {String(n).padStart(2, "0")}
      </span>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em]" style={{ color: brand }}>Section {String(n).padStart(2, "0")}</div>
        <h2 style={display} className="text-3xl font-semibold leading-tight text-stone-900">{title}</h2>
      </div>
    </div>
  );
}

function PricingTable({ s, brand }: { s: Section; brand: string }) {
  const rows = s.rows ?? [];
  return (
    <div className="pv-avoid overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-stone-100 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
        <span>Item</span><span className="text-right">Type</span><span className="w-24 text-right">Amount</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-stone-100 px-6 py-4 text-sm">
          <span className="flex items-center gap-2 text-stone-800">
            {r.item}
            {r.included && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${brand}1a`, color: brand }}>Included</span>
            )}
          </span>
          <span className="text-right text-stone-500">{r.type}</span>
          <span className="w-24 text-right font-medium tabular-nums text-stone-800">{typeof r.amount === "number" ? `$${r.amount}` : r.amount}</span>
        </div>
      ))}
      {(s.totalAmount != null || s.totalLabel) && (
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-stone-900 px-6 py-4 text-sm text-white">
          <span className="font-medium">{s.totalLabel || "Total Investment"}</span>
          <span className="text-right text-white/60">{s.totalType || "One-time"}</span>
          <span className="w-24 text-right text-lg font-semibold tabular-nums">{typeof s.totalAmount === "number" ? `$${s.totalAmount}` : s.totalAmount}</span>
        </div>
      )}
      {s.bodyHtml?.trim() && (
        <div className="px-6 py-5" style={{ backgroundColor: `${brand}0a` }}>
          <div className="pv-prose text-[13.5px] leading-relaxed text-stone-600" dangerouslySetInnerHTML={{ __html: s.bodyHtml }} />
        </div>
      )}
    </div>
  );
}

function TimelineBlock({
  s, brand, display, decided, clientTimeline, setClientTimeline,
}: {
  s: Section; brand: string; display: { fontFamily: string }; decided: boolean;
  clientTimeline: { value: number; unit: "days" | "hours" } | null;
  setClientTimeline: (v: { value: number; unit: "days" | "hours" } | null) => void;
}) {
  const phases = (s.phases ?? []).filter((p) => p.label || p.duration);
  const total = sumMinDuration(phases);
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, k) => {
          const last = k === phases.length - 1;
          return (
            <div key={k} className="pv-avoid rounded-2xl border border-stone-200 bg-white p-5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${last ? "text-white" : ""}`}
                style={last ? { backgroundColor: brand } : { backgroundColor: `${brand}1a`, color: brand }}>
                {String(k + 1).padStart(2, "0")}
              </span>
              <div className="mt-3 font-semibold text-stone-900" style={display}>{p.label}</div>
              {p.duration && (
                <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${brand}12`, color: brand }}>{p.duration}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {(total.days > 0 || total.hours > 0) && (
          <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600">
            <Clock className="h-4 w-4" style={{ color: brand }} />
            Estimated total: ~{fmtDuration(total)} from contract signing, subject to client feedback turnaround.
          </span>
        )}
        {s.clientField && (
          <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600">
            <CalendarClock className="h-4 w-4" style={{ color: brand }} />
            {s.clientField.label}
            {decided ? (
              <span className="text-stone-400">{clientTimeline ? `${clientTimeline.value} ${clientTimeline.unit}` : "—"}</span>
            ) : (
              <input type="number" min={0} placeholder="Enter your taken time"
                className="w-40 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
                value={clientTimeline?.value ?? ""}
                onChange={(e) => setClientTimeline({ value: parseFloat(e.target.value) || 0, unit: s.clientField!.unit })} />
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function TestimonialSlider({
  list, brand, display, pdfMode,
}: {
  list: Testimonial[]; brand: string; display: { fontFamily: string }; pdfMode: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const go = (d: number) => setIdx((i) => (i + d + list.length) % list.length);

  useEffect(() => {
    if (pdfMode || list.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [pdfMode, list.length]);

  // PDF: show all stacked so nothing is lost in the printed copy.
  if (pdfMode) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        {list.map((t, i) => <TestimonialCard key={i} t={t} brand={brand} display={display} />)}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mx-auto max-w-2xl">
        <TestimonialCard t={list[idx]} brand={brand} display={display} />
      </div>
      {list.length > 1 && (
        <>
          <div className="mt-5 flex items-center justify-center gap-2">
            {list.map((_, i) => (
              <button key={i} type="button" aria-label={`Testimonial ${i + 1}`} onClick={() => setIdx(i)}
                className="h-2 rounded-full transition-all"
                style={{ width: i === idx ? 22 : 8, backgroundColor: i === idx ? brand : "#d6d3d1" }} />
            ))}
          </div>
          <button type="button" aria-label="Previous" onClick={() => go(-1)}
            className="absolute -left-2 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-md transition hover:text-stone-900 sm:flex">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next" onClick={() => go(1)}
            className="absolute -right-2 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-md transition hover:text-stone-900 sm:flex">
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}

function TestimonialCard({ t, brand, display }: { t: Testimonial; brand: string; display: { fontFamily: string } }) {
  return (
    <div className="pv-avoid rounded-2xl border border-stone-200 bg-white p-7 shadow-[0_20px_50px_-36px_rgba(0,0,0,.4)]">
      <div className="flex items-center gap-4">
        {t.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatarUrl} alt={t.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ backgroundColor: brand }}>
            {t.name?.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-stone-900">{t.name}</div>
          {t.role && <div className="text-xs text-stone-500">{t.role}</div>}
        </div>
        <Stars n={t.rating ?? 5} brand={brand} />
      </div>
      {t.highlight && (
        <div className="mt-4 font-semibold text-stone-900" style={display}>{t.highlight}</div>
      )}
      <p className="mt-3 text-[14.5px] leading-relaxed text-stone-600">{t.quote}</p>
    </div>
  );
}

function Carousel({ children, staticGrid = false }: { children: React.ReactNode; staticGrid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => ref.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  if (staticGrid) {
    return <div className="flex flex-wrap gap-5">{children}</div>;
  }
  return (
    <div className="relative">
      <div ref={ref} className="pv-noscroll -mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-1 py-1">
        {children}
      </div>
      <button type="button" aria-label="Previous" onClick={() => scrollBy(-1)}
        className="absolute -left-3 top-[40%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:text-stone-900 sm:flex">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button type="button" aria-label="Next" onClick={() => scrollBy(1)}
        className="absolute -right-3 top-[40%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:text-stone-900 sm:flex">
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

function Banner({ url }: { url: string }) {
  return (
    <div className="my-7">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-[26rem] w-full rounded-2xl object-cover ring-1 ring-stone-200" />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-stone-400">{label}</span>
      <span className="tabular-nums text-stone-600">{value}</span>
    </div>
  );
}
