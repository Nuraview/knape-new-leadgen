// Cookie management — session-authed endpoints for the UI.
//   POST: upload a fresh cookies.json (either as JSON body or multipart file)
//   GET : metadata (uploaded_at, count) — no cookie values exposed

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A fresh Upwork export is ~20 kB. Allow up to 1 MB to be safe.
export const maxDuration = 30;

async function parseCookies(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) throw new Error("Missing 'file' field");
    const text = await file.text();
    return JSON.parse(text);
  }
  return await req.json();
}

function validateCookies(raw: unknown): {
  ok: true;
  cookies: any[];
  count: number;
} | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Cookies must be a JSON array" };
  }
  if (raw.length === 0) {
    return { ok: false, error: "Cookies array is empty" };
  }
  // Minimal shape check — every cookie needs name+value+domain.
  for (const c of raw) {
    if (
      typeof c !== "object" ||
      c == null ||
      typeof (c as any).name !== "string" ||
      typeof (c as any).value !== "string" ||
      typeof (c as any).domain !== "string"
    ) {
      return { ok: false, error: "Each cookie needs name, value, domain strings" };
    }
  }
  return { ok: true, cookies: raw as any[], count: raw.length };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await parseCookies(req);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Invalid input: ${e?.message ?? "unparseable"}` },
      { status: 400 },
    );
  }

  const v = validateCookies(parsed);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  await db.execute(dsql`
    INSERT INTO scraper_cookies (id, uploaded_at, uploaded_by, cookies)
    VALUES (1, now(), ${session.user.id}::uuid, ${JSON.stringify(v.cookies)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      uploaded_at = now(),
      uploaded_by = EXCLUDED.uploaded_by,
      cookies     = EXCLUDED.cookies
  `);

  return NextResponse.json({ ok: true, count: v.count });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const res: any = await db.execute(dsql`
    SELECT uploaded_at, uploaded_by, jsonb_array_length(cookies) AS count
      FROM scraper_cookies WHERE id = 1
  `);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ uploaded_at: null, count: 0, uploaded_by: null });
  }
  return NextResponse.json({
    uploaded_at:
      row.uploaded_at instanceof Date
        ? row.uploaded_at.toISOString()
        : row.uploaded_at,
    count: Number(row.count ?? 0),
    uploaded_by: row.uploaded_by,
  });
}
