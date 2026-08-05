// Shared-secret auth for the Upwork scraper. Set SCRAPER_API_KEY in both
// the Docker container (scraper) and Vercel/local (.env). Scraper sends:
//   Authorization: Bearer ${SCRAPER_API_KEY}

import { NextRequest, NextResponse } from "next/server";

export function requireScraperAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.SCRAPER_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "SCRAPER_API_KEY not configured on server" },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Constant-time-ish compare — ok for this threat model.
  if (token.length !== expected.length || token !== expected) {
    return NextResponse.json(
      { error: "Invalid or missing Bearer token" },
      { status: 401 },
    );
  }
  return null;
}
