import { useMemo } from "react";
import useBrand from "@/hooks/use-brand";
import { buildSignatureHtml, buildSignatureText } from "@/lib/email-signature";

/**
 * The instance's email signature, rebuilt whenever the brand changes.
 *
 * Memoised because the HTML goes straight into dangerouslySetInnerHTML: an
 * unmemoised rebuild returns a new string every render, React sees changed
 * props and replaces the subtree, and a preview pane that the user is halfway
 * through reading flickers on every keystroke in the composer beside it.
 */
export function useSignatureHtml(): string {
  const brand = useBrand();
  return useMemo(() => buildSignatureHtml(brand), [brand]);
}

export function useSignatureText(): string {
  const brand = useBrand();
  return useMemo(() => buildSignatureText(brand), [brand]);
}
