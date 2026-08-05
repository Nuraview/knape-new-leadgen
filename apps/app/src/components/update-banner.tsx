import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrand } from "@/hooks/use-brand";
import { useDeployReload } from "@/hooks/use-deploy-reload";

/**
 * "A new version is available" — the visible half of useDeployReload.
 *
 * Most reloads never reach this: a hidden or idle tab updates itself silently.
 * This is only for someone actively working when a deploy lands, where taking
 * the tab out from under them would destroy what they are typing.
 *
 * Deliberately loud and fixed to the bottom. The whole reason this exists is
 * that people were told a fix had shipped and could not see it; a subtle hint
 * would reproduce the original complaint.
 */
export function UpdateBanner() {
  const { updateReady, reload } = useDeployReload();
  // Every user-visible product name comes from the served brand config. This
  // one was hardcoded and was telling Dan a new version of NuraView had shipped
  // to his own dashboard.
  const brand = useBrand();
  if (!updateReady) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-t border-amber-500/40 bg-amber-500/95 px-4 py-2.5 text-sm text-amber-950 shadow-lg">
      <RefreshCw className="size-4" />
      <span className="font-medium">
        A new version of {brand.name} is ready.
      </span>
      <span className="hidden sm:inline">
        Your work is safe — reload when you&apos;re at a good point.
      </span>
      <Button size="sm" className="h-7 bg-amber-950 text-amber-50 hover:bg-amber-900" onClick={reload}>
        Reload now
      </Button>
    </div>
  );
}

export default UpdateBanner;
