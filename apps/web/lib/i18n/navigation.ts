// Shim for `@/i18n/navigation`. Re-exports Next.js defaults — no locale
// prefixing anymore.
export { default as Link } from "next/link";
export { useRouter, usePathname, redirect } from "next/navigation";

export function getPathname({ href }: { href: string; locale?: string }) {
  return href;
}
