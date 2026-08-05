// Normalize a phone number or already-formatted JID into the JID shape
// Baileys expects on outbound messages to individual recipients.
//
//   "+1 (548) 251-8967" -> "15482518967@s.whatsapp.net"
//   "15482518967@s.whatsapp.net" -> unchanged (idempotent)
//   "12345@g.us" -> unchanged (group JIDs supported)
//
// We DON'T validate the country code or length — WhatsApp will reject
// malformed JIDs at send time, surfaced via the bridge service's error
// reporting back through whatsapp_outbox.error.

export function normalizeJid(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("empty recipient");
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new Error(`invalid recipient: ${input}`);
  return `${digits}@s.whatsapp.net`;
}
