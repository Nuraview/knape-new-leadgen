import FulltextSearch from "./FulltextSearch";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";

type Props = {
  id: string;
  lang: string;
};

/**
 * Header Component
 *
 * Slimmed-down top bar (client ask Jul 2026): just the two things the
 * reviewer uses from here.
 *
 * Layout Structure:
 * - Left side: SidebarTrigger (sidebar collapse), FulltextSearch
 * - Right side: ThemeToggle (light / dark / system)
 *
 * Props `id` / `lang` are retained for the caller's signature but no longer
 * consumed here — the language switcher, command palette, feedback, currency
 * switcher and support widgets were removed from this bar.
 */
const Header = (_props: Props) => {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <FulltextSearch />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
      <Separator />
    </>
  );
};

export default Header;
