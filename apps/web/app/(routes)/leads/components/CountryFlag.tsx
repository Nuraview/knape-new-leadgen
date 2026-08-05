"use client";

import { flagUrl, flagUrl2x } from "@/lib/leads/country";

// Tiny inline-flag component. We render an <img> from flagcdn.com because
// the regional-indicator emoji approach (🇺🇸) renders as literal letter
// pairs ("US") on Windows desktop browsers — Segoe UI Emoji ships without
// the country-flag glyphs. SVG/PNG over HTTPS works everywhere.
//
// Dimensions: 16×12 default. The 2x srcset keeps it crisp on retina /
// high-DPI displays without forcing the larger asset on standard ones.
// Lazy-loaded — the Kanban can have 100+ cards in view, no point fetching
// flags for the ones below the fold.
export function CountryFlag({
  iso2,
  name,
  width = 16,
  className = "",
}: {
  iso2: string | null;
  name: string;
  width?: 16 | 20 | 24 | 32;
  className?: string;
}) {
  if (!iso2) {
    return (
      <span className={`shrink-0 ${className}`} aria-hidden>
        📍
      </span>
    );
  }
  const height = Math.round(width * 0.75);
  return (
    <img
      src={flagUrl(iso2, width)}
      srcSet={`${flagUrl(iso2, width)} 1x, ${flagUrl2x(iso2, width)} 2x`}
      width={width}
      height={height}
      alt={name}
      loading="lazy"
      decoding="async"
      className={`inline-block shrink-0 rounded-[2px] ${className}`}
      style={{ width, height }}
    />
  );
}
