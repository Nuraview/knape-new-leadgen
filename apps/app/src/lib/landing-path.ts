/**
 * Where an account belongs after signing in.
 *
 * There is no single right answer any more: a projects-only employee has no
 * business on /leads (the API 403s them), and a kanban-only employee has no
 * business on the full leads list. Sending everyone to /leads walked two of the
 * three groups straight into an error page.
 *
 * Falls back to /dashboard on any failure. That is the surface every account
 * has, so a flaky access check degrades into "lands somewhere useful" rather
 * than "lands on a 403".
 */
import { getApiUrl } from "@/fetchers/get-api-url";

export type CrmLevel = "full" | "leads_kanban" | "none";

export type MyAccess = {
  role: string | null;
  crmLevel: CrmLevel;
  canAccessCrm: boolean;
  canReadLeads: boolean;
  /**
   * May edit the contact fields on a lead. NOT the same as canAccessCrm — a
   * lead-gen employee whose whole job is entering the emails he finds can do
   * this without seeing the rest of the CRM. Mirrors KANBAN_WRITE_PATHS in
   * apps/api/src/lead/index.ts.
   */
  canEditLeads: boolean;
  canAccessProjects: boolean;
  email: string | null;
  /**
   * An operator handed this account a temporary password and the holder has
   * not replaced it yet. The shell blocks on this so the temporary one never
   * becomes the real one — and so whoever issued it never learns the
   * replacement.
   */
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
};

export const DEFAULT_LANDING_PATH = "/dashboard";

export async function fetchMyAccess(): Promise<MyAccess> {
  const response = await fetch(getApiUrl("me/access"), {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load access");
  return response.json();
}

export function landingPathFor(access: Pick<MyAccess, "crmLevel">): string {
  /*
   * Land on Home, not on the lead list.
   *
   * /leads is 2,000+ rows of raw pipeline — the operator's working surface. The
   * client signing in wants to know whether it is working: who opened, who
   * clicked, what bounced, and what the email even says. Home answers that and
   * links onward to the machinery for whoever needs it.
   */
  if (access.crmLevel === "full") return "/home";
  // A lead-gen account has no project boards to fall back to, so the kanban is
  // the whole app for them.
  if (access.crmLevel === "leads_kanban") return "/leads/kanban";
  return DEFAULT_LANDING_PATH;
}

export async function getLandingPath(): Promise<string> {
  try {
    return landingPathFor(await fetchMyAccess());
  } catch {
    return DEFAULT_LANDING_PATH;
  }
}
