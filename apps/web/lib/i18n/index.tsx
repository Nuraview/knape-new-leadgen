// Shim for `next-intl`. Only the hooks used across the app are implemented:
// useTranslations, useLocale, NextIntlClientProvider. Everything resolves to
// English.
import type { ReactNode } from "react";

import { translate } from "./messages";

export type TranslationFn = ((
  key: string,
  values?: Record<string, string | number>,
) => string) & {
  rich: (
    key: string,
    values?: Record<string, unknown>,
  ) => ReactNode;
  raw: (key: string) => unknown;
};

export function useTranslations(
  input: string | { namespace?: string } = "",
): TranslationFn {
  const namespace =
    typeof input === "string" ? input : (input?.namespace ?? "");
  const fn = ((key: string, values?: Record<string, string | number>) =>
    translate(namespace, key, values)) as TranslationFn;
  fn.rich = (key: string, values?: Record<string, unknown>) =>
    translate(namespace, key, values as Record<string, string | number>);
  fn.raw = (key: string) => translate(namespace, key);
  return fn;
}

export function useLocale(): string {
  return "en";
}

export function useFormatter() {
  return {
    dateTime: (value: Date | number, _opts?: unknown) =>
      new Date(value).toLocaleString("en-US"),
    number: (value: number, _opts?: unknown) => value.toLocaleString("en-US"),
    relativeTime: (value: Date | number) =>
      new Date(value).toLocaleString("en-US"),
  };
}

export function NextIntlClientProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function hasLocale(_locales: readonly string[], _candidate: unknown) {
  return true;
}
