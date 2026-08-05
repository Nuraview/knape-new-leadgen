import { cn } from "@/lib/cn";
import useBrand from "@/hooks/use-brand";

/**
 * The brand lockup, correct on both themes.
 *
 * Two images, not one, and not a CSS mask. The asset is TWO-TONE — white
 * lettering with a gold gradient on "PLANNER" — so:
 *
 *   - as a single <img> it is half-invisible on the light theme, because the
 *     white half disappears. That is exactly how it first shipped, and it is
 *     why the app looked washed out and colourless.
 *   - as a CSS mask (the trick the old NuraView sidebar used) the alpha gets
 *     painted one flat colour, which throws the gold away. Fine for a
 *     single-colour wordmark; wrong for this one.
 *
 * So the white lettering is recoloured to near-black for the light theme and
 * the gold is left alone — gold reads on white, white does not. The browser
 * picks between them with `dark:` and both are static assets, so there is no
 * flash and no JavaScript involved.
 *
 * Falls back to a single image when the instance has not supplied a dark
 * variant, which is the case for NuraView's own logo.
 */
export function BrandWordmark({ className }: { className?: string }) {
  const brand = useBrand();

  /*
   * Convention rather than another env var: `<name>-dark.<ext>` beside the main
   * asset is the light-theme version. One BRAND_LOGO_URL stays the single thing
   * an operator has to set.
   */
  const lightThemeSrc = brand.logoUrl.replace(/(\.[a-z0-9]+)$/i, "-dark$1");
  const hasVariant = lightThemeSrc !== brand.logoUrl;

  if (!hasVariant) {
    return (
      <img
        src={brand.logoUrl}
        alt={brand.name}
        className={cn("object-contain object-left", className)}
      />
    );
  }

  return (
    <>
      <img
        src={lightThemeSrc}
        alt={brand.name}
        className={cn("object-contain object-left dark:hidden", className)}
      />
      <img
        src={brand.logoUrl}
        alt={brand.name}
        aria-hidden
        className={cn("hidden object-contain object-left dark:block", className)}
      />
    </>
  );
}

export default BrandWordmark;
