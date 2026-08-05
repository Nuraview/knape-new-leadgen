// Single source of English strings. Was `locales/en.json`; now consumed
// directly here so we can drop next-intl entirely.
import en from "../../locales/en.json";

type Messages = Record<string, unknown>;

const messages = en as Messages;

function resolve(namespace: string, key: string): string {
  const path = namespace ? `${namespace}.${key}` : key;
  const segments = path.split(".");
  let cur: unknown = messages;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in (cur as Messages)) {
      cur = (cur as Messages)[seg];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}

function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in values ? String(values[k]) : `{${k}}`,
  );
}

export function translate(
  namespace: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  return interpolate(resolve(namespace, key), values);
}

export function getMessagesRaw(): Messages {
  return messages;
}
