import labelColors from "@/constants/label-colors";

function isValidHtmlColor(color: string): boolean {
  const s = new Option().style;
  s.color = color;
  return s.color !== "";
}

/**
 * A stored colour name ("teal") to something CSS will accept.
 *
 * Shared by label chips and work-stream chips so the same stored value can
 * never render as two different colours in the same card.
 *
 * Falls through: a known name wins, then any literal the browser accepts
 * (older rows hold raw hex), then neutral — an unrecognised value must not
 * render an invisible chip.
 */
export function resolveLabelColor(value: string): string {
  const mapped = labelColors.find((c) => c.value === value)?.color;
  if (mapped) return mapped;
  if (isValidHtmlColor(value)) return value;
  return "var(--color-neutral-400)";
}

export default resolveLabelColor;
