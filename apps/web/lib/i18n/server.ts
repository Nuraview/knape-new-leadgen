// Server-side shim for `next-intl/server`.
import { getMessagesRaw, translate } from "./messages";
import type { TranslationFn } from "./index";

export async function getTranslations(
  input: string | { namespace?: string; locale?: string } = "",
): Promise<TranslationFn> {
  const namespace =
    typeof input === "string" ? input : (input?.namespace ?? "");
  const fn = ((key: string, values?: Record<string, string | number>) =>
    translate(namespace, key, values)) as TranslationFn;
  fn.rich = (key: string, values?: Record<string, unknown>) =>
    translate(namespace, key, values as Record<string, string | number>);
  fn.raw = (key: string) => translate(namespace, key);
  return fn;
}

export async function getLocale(): Promise<string> {
  return "en";
}

export async function getMessages() {
  return getMessagesRaw();
}

export async function setRequestLocale(_locale: string): Promise<void> {
  /* no-op */
}
