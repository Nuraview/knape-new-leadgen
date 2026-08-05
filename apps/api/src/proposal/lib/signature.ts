/**
 * Decode a base64 PNG data URL (from react-signature-canvas `toDataURL`) into a
 * Buffer. Rejects oversized payloads — a drawn signature should be well under
 * the cap; anything larger is suspicious for an unauthenticated endpoint.
 */
const MAX_SIGNATURE_BYTES = 500 * 1024; // 500 KB

export function decodeSignaturePng(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Invalid signature image");
  }
  // match[1] is optional under noUncheckedIndexedAccess. The regex guarantees
  // the group when it matched, but assert rather than let a bad cast through —
  // this decodes a client-supplied data URL.
  const payload = match[1];
  if (!payload) throw new Error("Invalid signature image");
  const buf = Buffer.from(payload, "base64");
  if (buf.byteLength > MAX_SIGNATURE_BYTES) {
    throw new Error("Signature image too large");
  }
  return buf;
}
