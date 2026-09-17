import type React from "react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { DemoAlert } from "@/components/demo-alert";
import { ForcePasswordChange } from "@/components/force-password-change";
import { TwoFactorGate, shouldPromptTwoFactor } from "@/components/two-factor-gate";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isDemoMode } from "@/constants/urls";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import { useUserPreferencesEffects } from "@/hooks/use-user-preferences-effects";
import { cn } from "@/lib/cn";
import { useUserPreferencesStore } from "@/store/user-preferences";

type LayoutProps = {
  children: ReactNode;
  className?: string;
};

type HeaderProps = {
  children: ReactNode;
  className?: string;
};

type ContentProps = {
  children: ReactNode;
  className?: string;
};

function LayoutHeader({ children, className }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex h-10 shrink-0 gap-2 transition-[width,height] ease-in-out group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-8 border-b border-border bg-card p-2",
        className,
      )}
    >
      {children}
    </header>
  );
}

function LayoutContent({ children, className }: ContentProps) {
  return (
    <div className={cn("flex-1 min-h-0", className)}>
      <div className="h-full">{children}</div>
    </div>
  );
}

function Layout({ children, className }: LayoutProps) {
  const { sidebarDefaultOpen } = useUserPreferencesStore();
  const { data: access, error: accessError } = useMyAccess();

  useUserPreferencesEffects();

  /*
   * SECURITY GATES, in order, straight after sign-in. Nothing here is a menu
   * you have to find: an admin lands on the password screen, then on 2FA
   * enrolment, and only then on the app.
   *
   * At the layout because every authenticated page renders through it, so
   * there is no route that skips them. The server owns the flags; this only
   * decides what is drawn.
   */
  if (accessError) {
    // Do NOT fall through to the app. This used to be a silent "safe default"
    // that reported mustChangePassword: false, so a failed access call rendered
    // a working-looking CRM with an empty sidebar and no password prompt —
    // which is exactly how the owner ended up staring at one menu item.
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">Could not load your permissions.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is usually a stale browser cache after a deploy. Reload with
            Ctrl+Shift+R (Cmd+Shift+R on a Mac).
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (access?.mustChangePassword) {
    return <ForcePasswordChange email={access.email} />;
  }

  if (access && shouldPromptTwoFactor(access)) {
    return <TwoFactorGate email={access.email} />;
  }

  return (
    // DialerProvider AND GlobalDialerRuntime both live at the _authenticated
    // route boundary now, above the page components — see that file for why.
    //
    // The runtime used to be mounted right here, which quietly scoped the call
    // UI to the pages that happen to render Layout. Every /dashboard, settings,
    // workspace and project-board screen builds its own shell instead, so a
    // call ringing while someone was on a board had nowhere to appear at all.
    /*
     * inset-safe on the SHELL, which has no padding of its own — so it sets
     * rather than fights anything (see the note in index.css).
     *
     * It matters only once the app is installed. viewport-fit=cover plus
     * apple-mobile-web-app-status-bar-style=black-translucent make the page
     * paint edge to edge and UNDER the status bar, which is what makes an
     * installed PWA look native — and also what would put every page's h-14
     * header behind the iOS clock, the sidebar rail under the notch in
     * landscape, and the content panel's last few pixels under the home
     * indicator. All four insets are 0 in an ordinary browser tab, so the
     * desktop and in-tab layouts are untouched.
     */
    <div className="flex w-full min-w-0 bg-background inset-safe">
      <SidebarProvider
        defaultOpen={sidebarDefaultOpen}
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 60)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset
          className={cn(
            // bg-card, not bg-background: this inset is the raised content
            // panel. Now that the app shell is tinted, leaving it on
            // --background would make panel and shell the same colour again
            // and undo the layering — shell, then rail, then this panel, then
            // tinted columns, then white cards.
            "flex min-w-0 flex-1 flex-col overflow-auto bg-card",
            /*
             * The raised-panel treatment is a DESKTOP idea.
             *
             * m-2 at an 18px root is 18px of dead space on each side plus a
             * 1px border and a 12px corner radius — around 40px of a 390px
             * screen spent on making the content look like a card floating on
             * a shell you cannot see any of. On a phone the panel IS the
             * screen, so it goes full-bleed and the layering starts one level
             * in, at the tinted columns and the white cards.
             */
            "sm:m-2 sm:rounded-xl sm:border sm:border-border/80 sm:shadow-sm/5",
            className,
          )}
        >
          {isDemoMode && <DemoAlert />}
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

Layout.Header = LayoutHeader;
Layout.Content = LayoutContent;

export default Layout;
