export function isCloud(): boolean {
  return process.env.NURAVIEW_CLOUD === "true";
}
