// Best-effort IP geolocation for proposal VIEWED events.
// Primary: ipwho.is — free, HTTPS, no key, no origin lock → works from Vercel
// serverless (the old ip-api free was HTTP-only and unreachable from Vercel).
// Optional: ip-api PRO if IPAPI_KEY is set AND its Origin restriction is removed.

export interface Geo {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  mobile?: boolean;
  proxy?: boolean;
}

const PRIVATE = /^(10\.|127\.|0\.|::1|fc|fd|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/i;
const IPAPI_FIELDS = "status,country,countryCode,regionName,city,isp,mobile,proxy";

async function fetchJson(url: string, ms: number): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupGeo(ip: string | null | undefined): Promise<Geo | null> {
  if (!ip || PRIVATE.test(ip)) return null;
  const e = encodeURIComponent(ip);

  // 1. ip-api PRO when a (working) key is configured — richer (mobile/proxy).
  const key = process.env.IPAPI_KEY;
  if (key) {
    const j = await fetchJson(`https://pro.ip-api.com/json/${e}?key=${key}&fields=${IPAPI_FIELDS}`, 2500);
    if (j?.status === "success") {
      return { country: j.country, countryCode: j.countryCode, region: j.regionName, city: j.city, isp: j.isp, mobile: j.mobile, proxy: j.proxy };
    }
  }

  // 2. Free HTTPS fallback that works from serverless (no key / origin lock).
  const j = await fetchJson(`https://ipwho.is/${e}?fields=success,country,country_code,region,city,connection`, 3000);
  if (j?.success) {
    return { country: j.country, countryCode: j.country_code, region: j.region, city: j.city, isp: j.connection?.isp };
  }
  return null;
}

/** 2-letter country code → flag emoji (regional indicator letters). */
export function flagEmoji(cc?: string | null): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  const c = cc.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}
