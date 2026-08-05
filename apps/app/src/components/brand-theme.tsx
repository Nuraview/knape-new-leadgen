import { useEffect } from "react";
import useBrand from "@/hooks/use-brand";

/**
 * Paints the instance accent onto the live theme.
 *
 * Everything else the brand config drives is text or an image. This is the part
 * that makes the app stop *looking* like the vendor's product: without it a
 * client could set every BRAND_* variable and still get NuraView's neutral-800
 * primary on every button, active nav row and focus ring.
 *
 * Written as CSS custom properties on :root rather than compiled into the
 * Tailwind build, because the brand is served at runtime from /api/config — a
 * build-time colour would freeze into the bundle and be wrong the moment the
 * same image served a second instance.
 *
 * Only the accent triplet is overridden. Surfaces, borders and text keep the
 * app's existing light/dark scales, so a client supplying one colour gets a
 * coherent theme instead of a half-restyled one that needs a designer to
 * rescue.
 */
export function BrandTheme() {
  const brand = useBrand();

  useEffect(() => {
    const root = document.documentElement;
    const vars: Record<string, string> = {
      "--primary": brand.accentColor,
      "--primary-foreground": brand.accentForeground,
      "--ring": brand.accentColor,
      "--sidebar-primary": brand.accentColor,
      "--sidebar-primary-foreground": brand.accentForeground,
    };

    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }

    return () => {
      // Cleared on unmount so a stale accent cannot survive into a different
      // brand during development hot-reloads.
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [brand.accentColor, brand.accentForeground]);

  return null;
}

export default BrandTheme;
