import type { SmtpSettings } from "@nuraview/email";
import { inArray } from "drizzle-orm";
import db from "../database";
import { instanceSettingTable } from "../database/schema";
import { decryptSecret } from "./secrets";

/**
 * Where notification emails go out from, and where their "Open task" button
 * points.
 *
 * Both normally come from the environment (SMTP_*, NURAVIEW_CLIENT_URL). The
 * instance_setting table is the fallback for an instance whose environment the
 * operator cannot edit: Knape's runs on a Vercel project in another account,
 * and for weeks every @mention lit the bell and sent no email, because SMTP_*
 * was never set there and the sender skips silently when it is missing.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * A link that points at the sender's own machine is never right in an email
 * that someone else opens, so a loopback value is skipped rather than trusted.
 * The server's .env carries http://127.0.0.1:5173 for local work.
 */
function usableUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (LOOPBACK_HOSTS.has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function toSmtpSettings(value: unknown): SmtpSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const password =
    typeof v.password === "string" ? decryptSecret(v.password) : null;
  if (
    typeof v.host !== "string" ||
    typeof v.user !== "string" ||
    typeof v.from !== "string" ||
    !password
  ) {
    return null;
  }
  const port = typeof v.port === "number" ? v.port : 465;
  return {
    host: v.host,
    port,
    secure: typeof v.secure === "boolean" ? v.secure : port === 465,
    user: v.user,
    password,
    from: v.from,
  };
}

export async function getInstanceMailSettings(): Promise<{
  smtp: SmtpSettings | null;
  clientUrl: string;
}> {
  const rows = await db
    .select()
    .from(instanceSettingTable)
    .where(inArray(instanceSettingTable.key, ["smtp", "app_url"]));
  const setting = (key: string) => rows.find((row) => row.key === key)?.value;

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null;

  return {
    smtp: toSmtpSettings(setting("smtp")),
    clientUrl:
      usableUrl(process.env.NURAVIEW_CLIENT_URL) ??
      usableUrl(setting("app_url")) ??
      usableUrl(vercelUrl) ??
      "http://localhost:5173",
  };
}
