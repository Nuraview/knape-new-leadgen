import { createFileRoute, redirect } from "@tanstack/react-router";
import { getLandingPath } from "@/lib/landing-path";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Leads is the product, so a CRM account still lands there. But "/" used to
    // send EVERYONE to /leads, which meant a projects-only employee opened the
    // app and was immediately refused by the API. Route by entitlement instead.
    throw redirect({ to: await getLandingPath() });
  },
});
