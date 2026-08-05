import { useEffect } from "react";
import useBrand from "@/hooks/use-brand";

type PageTitleProps = {
  title: string;
  /** Defaults to the instance brand name. Pass to override for one page. */
  suffix?: string;
  hideAppName?: boolean;
};

export default function PageTitle({
  title,
  suffix,
  hideAppName = false,
}: PageTitleProps) {
  const brand = useBrand();
  // Not a default parameter any more: the fallback is now per-instance, and a
  // default value cannot read a hook.
  const resolvedSuffix = suffix ?? brand.name;

  useEffect(() => {
    const formattedTitle = hideAppName
      ? title
      : resolvedSuffix
        ? `${title} — ${resolvedSuffix}`
        : title;
    document.title = formattedTitle;
  }, [title, resolvedSuffix, hideAppName]);

  return null;
}
