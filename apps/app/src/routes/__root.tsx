import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ToastProvider } from "@/components/ui/toast";
import { UpdateBanner } from "@/components/update-banner";
import { LeadFlowBanner } from "@/components/lead-flow-banner";
import { BrandTheme } from "@/components/brand-theme";
import type { User } from "@/types/user";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: User | null | undefined;
}>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ToastProvider position="bottom-right">
      <div className="flex h-svh w-full flex-row overflow-x-hidden overflow-y-hidden bg-background scrollbar-thin scrollbar-thumb-border scrollbar-track-muted">
        <Outlet />
      </div>
      {/*
        ONE FIXED STACK, above the sidebar.

        These were plain children after an h-svh shell, so they rendered below
        the fold with the fixed sidebar (z-10) sitting over them — the warning
        was there and clipped, which is worse than absent because it looks
        handled. The stack owns the positioning; the banners inside are plain
        blocks and simply pile up when more than one is showing.
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col">
        <div className="pointer-events-auto">
          <UpdateBanner />
          <BrandTheme />
          <LeadFlowBanner />
        </div>
      </div>
    </ToastProvider>
  );
}

export default RootComponent;
