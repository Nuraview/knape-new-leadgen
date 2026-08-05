import { useQuery } from "@tanstack/react-query";
import {
  type CrmLevel,
  type MyAccess,
  fetchMyAccess,
} from "@/lib/landing-path";

export type { CrmLevel, MyAccess };

/**
 * What this account may see. The server enforces the same rule independently
 * (apps/api/src/utils/require-crm-access.ts) — this only decides what to
 * render, so a projects-only employee is not shown a Leads link that would
 * 403, and a kanban-only employee is not shown the full leads list.
 *
 * Fails closed: if the access check itself errors, nothing CRM renders.
 * Showing the nav anyway would only produce links the API refuses.
 */
export function useMyAccess() {
  return useQuery({
    queryKey: ["me", "access"],
    /*
     * NO try/catch fallback here, on purpose.
     *
     * This used to catch and return a "safe" default of
     * { role: null, crmLevel: "none", mustChangePassword: false, ... }. That
     * object is indistinguishable from a real answer, so a failed request
     * rendered a crippled-but-working app: empty nav, and — worse — the forced
     * password screen never fired because the default said it was not needed.
     * The owner saw a CRM with one menu item and no prompt, and nothing
     * anywhere said the call had failed.
     *
     * Letting it throw means callers can tell "denied" from "did not answer".
     */
    queryFn: fetchMyAccess,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
