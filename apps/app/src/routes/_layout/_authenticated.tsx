import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { DialerProvider } from "@/components/dialer/dialer-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { GlobalDialerRuntime } from "@/components/dialer/global-dialer-runtime";
import { authClient } from "@/lib/auth-client";
import { EnableNotifications } from "@/components/enable-notifications";
import { PushAlerts } from "@/components/push-alerts";

// protects all child routes, must be logged in
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: location.pathname,
        },
      });
    }
    // Activate a workspace here rather than only inside /dashboard.
    //
    // The sidebar's project-management section renders nothing when there is
    // no active workspace, and the only code that set one lived in the
    // dashboard route. Once sign-in started landing on /leads (leads are the
    // product), that route stopped running and Projects/Members/Invitations
    // silently disappeared from the sidebar — the workspace existed, it was
    // just never made active on the session.
    //
    // Doing it at the authenticated boundary means every entry point gets a
    // workspace, whichever page the user lands on.
    if (!session.session?.activeOrganizationId) {
      const { data: workspaces } = await authClient.organization.list();
      const first = workspaces?.[0];
      if (first) {
        await authClient.organization.setActive({ organizationId: first.id });
      }
    }

    return { session };
  },
  /*
   * The Twilio Device lives HERE, above every authenticated route.
   *
   * It was inside Layout, which page components render themselves — so
   * dialer.tsx called useDialer() in the same component that rendered the
   * provider, i.e. outside it, and threw "useDialer must be used inside a
   * DialerProvider". The whole dialer page was down and still returned HTTP
   * 200, because a React error boundary is not an HTTP status.
   *
   * At the route boundary the provider wraps the page components themselves,
   * so any screen can use the hook and the device stays registered across
   * navigation — which is the point: a call has to ring wherever you are.
   */
  component: () => (
    <DialerProvider>
      {/*
        Mounted HERE, not on the dialer page, which is where the push hook used
        to live. Notifications are how the work clock and the lead alarm reach
        people; scoping that to one page meant almost nobody was subscribed and
        every send quietly went nowhere.
      */}
      <EnableNotifications />
      {/* Sound + an on-screen card for every push, since a service worker
          cannot make noise on its own. */}
      <PushAlerts />
      {/*
        The call UI sits beside the provider, NOT inside Layout where it used
        to live. Layout is opted into by each page, and the whole /dashboard,
        settings, workspace and project-board tree renders its own shell — so
        the device was registered and ringing on those screens with no card to
        answer from. Here it covers every authenticated route by construction.
      */}
      <GlobalDialerRuntime />
      {/*
        Same reasoning as the dialer runtime above: mounted on the shell so
        it covers every authenticated route by construction. It reads the
        current path itself, so the answer to "who should I call" can differ
        on Leads and on Outreach. Hides itself when the server reports no
        DEEPSEEK_API_KEY rather than offering a button that 503s.
      */}
      <AssistantPanel />
      <Outlet />
    </DialerProvider>
  ),
});
