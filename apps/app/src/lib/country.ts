// Normalize the scraper's raw client-location strings into a canonical
// country name + flag emoji. Upwork / RSS / our scraper emit a soup of
// formats:
//   - Full names: "United States", "United Kingdom", "Australia"
//   - ISO-3 codes: "USA", "GBR", "AUS", "CAN", "DEU"
//   - Occasional ISO-2 codes: "US", "GB"
//   - Edge cases: "ESP" (Spain), "ARE" (UAE), "HKG" (Hong Kong)
//
// The UI used to show whatever the scraper sent — leading to a column of
// "United States" / "USA" / "ESP" / "Spain" mixed together. This module
// collapses everything to {flag, name} so the cards render uniformly:
//   🇺🇸 United States, 🇪🇸 Spain, 🇬🇧 United Kingdom.
//
// Flag emoji are generated from ISO-2 codes via the Regional Indicator
// trick (each ASCII letter maps to U+1F1E6+offset). Two indicators side
// by side render as a flag on every modern OS — no asset bundle needed.

// ISO-2 codes and their canonical English short name. Kept compact —
// only countries we've actually seen in the scraper output, plus the
// long tail of ones we're likely to see (Upwork covers most of the world).
const ISO2_TO_NAME: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  IN: "India",
  DE: "Germany",
  AE: "United Arab Emirates",
  ES: "Spain",
  NL: "Netherlands",
  PK: "Pakistan",
  AT: "Austria",
  RO: "Romania",
  FR: "France",
  IL: "Israel",
  BE: "Belgium",
  EG: "Egypt",
  NZ: "New Zealand",
  SG: "Singapore",
  SE: "Sweden",
  EE: "Estonia",
  CH: "Switzerland",
  BG: "Bulgaria",
  NO: "Norway",
  DK: "Denmark",
  HR: "Croatia",
  RS: "Serbia",
  IT: "Italy",
  TR: "Turkey",
  PH: "Philippines",
  PL: "Poland",
  MA: "Morocco",
  HK: "Hong Kong",
  NG: "Nigeria",
  LT: "Lithuania",
  PT: "Portugal",
  MT: "Malta",
  SA: "Saudi Arabia",
  IE: "Ireland",
  CL: "Chile",
  QA: "Qatar",
  ZA: "South Africa",
  IM: "Isle of Man",
  CZ: "Czechia",
  UZ: "Uzbekistan",
  KW: "Kuwait",
  UA: "Ukraine",
  MY: "Malaysia",
  BM: "Bermuda",
  CY: "Cyprus",
  TH: "Thailand",
  VN: "Vietnam",
  ID: "Indonesia",
  TZ: "Tanzania",
  TW: "Taiwan",
  OM: "Oman",
  PR: "Puerto Rico",
  MX: "Mexico",
  JE: "Jersey",
  // Long tail — cheap to include, future-proofs against new scraper output.
  AR: "Argentina",
  BR: "Brazil",
  CO: "Colombia",
  PE: "Peru",
  VE: "Venezuela",
  EC: "Ecuador",
  UY: "Uruguay",
  PA: "Panama",
  CR: "Costa Rica",
  DO: "Dominican Republic",
  JM: "Jamaica",
  HU: "Hungary",
  SK: "Slovakia",
  SI: "Slovenia",
  GR: "Greece",
  IS: "Iceland",
  FI: "Finland",
  LU: "Luxembourg",
  AL: "Albania",
  BA: "Bosnia and Herzegovina",
  MK: "North Macedonia",
  ME: "Montenegro",
  MD: "Moldova",
  BY: "Belarus",
  KZ: "Kazakhstan",
  KG: "Kyrgyzstan",
  UG: "Uganda",
  KE: "Kenya",
  GH: "Ghana",
  ET: "Ethiopia",
  ZM: "Zambia",
  RW: "Rwanda",
  CM: "Cameroon",
  SN: "Senegal",
  TN: "Tunisia",
  DZ: "Algeria",
  LB: "Lebanon",
  JO: "Jordan",
  SY: "Syria",
  IQ: "Iraq",
  BH: "Bahrain",
  YE: "Yemen",
  IR: "Iran",
  AF: "Afghanistan",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  NP: "Nepal",
  MM: "Myanmar",
  KH: "Cambodia",
  LA: "Laos",
  KR: "South Korea",
  JP: "Japan",
  CN: "China",
  MN: "Mongolia",
  RU: "Russia",
};

// ISO-3 → ISO-2 for the codes we've observed plus common ones. The
// scraper sometimes emits ISO-3 (USA/GBR/CAN), so we go through this
// to recover the ISO-2 needed for the flag.
const ISO3_TO_ISO2: Record<string, string> = {
  USA: "US",
  GBR: "GB",
  CAN: "CA",
  AUS: "AU",
  IND: "IN",
  DEU: "DE",
  ARE: "AE",
  ESP: "ES",
  NLD: "NL",
  PAK: "PK",
  AUT: "AT",
  ROU: "RO",
  FRA: "FR",
  ISR: "IL",
  BEL: "BE",
  EGY: "EG",
  NZL: "NZ",
  SGP: "SG",
  SWE: "SE",
  EST: "EE",
  CHE: "CH",
  BGR: "BG",
  NOR: "NO",
  DNK: "DK",
  HRV: "HR",
  SRB: "RS",
  ITA: "IT",
  TUR: "TR",
  PHL: "PH",
  POL: "PL",
  MAR: "MA",
  HKG: "HK",
  NGA: "NG",
  LTU: "LT",
  PRT: "PT",
  MLT: "MT",
  SAU: "SA",
  IRL: "IE",
  CHL: "CL",
  QAT: "QA",
  ZAF: "ZA",
  IMN: "IM",
  CZE: "CZ",
  UZB: "UZ",
  KWT: "KW",
  UKR: "UA",
  MYS: "MY",
  BMU: "BM",
  CYP: "CY",
  THA: "TH",
  VNM: "VN",
  IDN: "ID",
  TZA: "TZ",
  TWN: "TW",
  OMN: "OM",
  PRI: "PR",
  MEX: "MX",
  JEY: "JE",
  ARG: "AR",
  BRA: "BR",
  COL: "CO",
  PER: "PE",
  VEN: "VE",
  ECU: "EC",
  URY: "UY",
  PAN: "PA",
  CRI: "CR",
  DOM: "DO",
  JAM: "JM",
  HUN: "HU",
  SVK: "SK",
  SVN: "SI",
  GRC: "GR",
  ISL: "IS",
  FIN: "FI",
  LUX: "LU",
  ALB: "AL",
  BIH: "BA",
  MKD: "MK",
  MNE: "ME",
  MDA: "MD",
  BLR: "BY",
  KAZ: "KZ",
  KGZ: "KG",
  UGA: "UG",
  KEN: "KE",
  GHA: "GH",
  ETH: "ET",
  ZMB: "ZM",
  RWA: "RW",
  CMR: "CM",
  SEN: "SN",
  TUN: "TN",
  DZA: "DZ",
  LBN: "LB",
  JOR: "JO",
  SYR: "SY",
  IRQ: "IQ",
  BHR: "BH",
  YEM: "YE",
  IRN: "IR",
  AFG: "AF",
  BGD: "BD",
  LKA: "LK",
  NPL: "NP",
  MMR: "MM",
  KHM: "KH",
  LAO: "LA",
  KOR: "KR",
  JPN: "JP",
  CHN: "CN",
  MNG: "MN",
  RUS: "RU",
};

// Build the reverse map (full name → ISO-2). Drives normalization when the
// scraper sends "United Kingdom" but we want to derive 🇬🇧.
const NAME_TO_ISO2: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [iso2, name] of Object.entries(ISO2_TO_NAME)) {
    out[name.toLowerCase()] = iso2;
  }
  // Common aliases the scraper has been seen to use.
  out["usa"] = "US";
  out["uae"] = "AE";
  out["uk"] = "GB";
  out["united state"] = "US";
  out["the netherlands"] = "NL";
  out["holland"] = "NL";
  out["czech republic"] = "CZ";
  return out;
})();

export type ResolvedCountry = {
  // ISO-2 code ("US", "GB"). Null when we couldn't resolve to a known
  // country — callers should render a 📍 fallback in that case. We expose
  // the code (not a flag emoji) because Windows browsers don't render
  // regional-indicator emoji pairs as flags — they render the letters
  // verbatim. SVG flag images via flagUrl() work everywhere.
  iso2: string | null;
  // Canonical English short name ("United States"). Falls back to the raw
  // input verbatim when nothing matches — better to render *something*
  // than to silently drop a value the user might recognize.
  name: string;
};

// Single entry point used by the lead views. Returns null only when the
// input is null/empty — every other input gets an object back, even if
// iso2 is null (unknown country, raw text passed through).
export function resolveCountry(
  raw: string | null | undefined,
): ResolvedCountry | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  // ISO-3 hit — most common for our scraper.
  const iso2FromIso3 = ISO3_TO_ISO2[upper];
  if (iso2FromIso3) {
    return {
      iso2: iso2FromIso3,
      name: ISO2_TO_NAME[iso2FromIso3] ?? trimmed,
    };
  }

  // Direct ISO-2 (rare but possible).
  if (upper.length === 2 && ISO2_TO_NAME[upper]) {
    return { iso2: upper, name: ISO2_TO_NAME[upper] };
  }

  // Full-name match (case-insensitive).
  const iso2FromName = NAME_TO_ISO2[trimmed.toLowerCase()];
  if (iso2FromName) {
    return {
      iso2: iso2FromName,
      name: ISO2_TO_NAME[iso2FromName] ?? trimmed,
    };
  }

  // Unknown — return the raw value so the user still sees *something*.
  return { iso2: null, name: trimmed };
}

// flagcdn.com — free, no API key, widely-used SVG flag service.
// Returns the URL for a small inline flag (width × height matched to text
// height — 16×12 is the right size next to a 12-13px line).
export function flagUrl(iso2: string, width: 16 | 20 | 24 | 32 = 16): string {
  return `https://flagcdn.com/${width}x${Math.round(width * 0.75)}/${iso2.toLowerCase()}.png`;
}

// 2× version for retina displays — same URL pattern, served when the
// browser requests a higher-DPI asset via srcset.
export function flagUrl2x(iso2: string, width: 16 | 20 | 24 | 32 = 16): string {
  const w = width * 2;
  return `https://flagcdn.com/${w}x${Math.round(w * 0.75)}/${iso2.toLowerCase()}.png`;
}
