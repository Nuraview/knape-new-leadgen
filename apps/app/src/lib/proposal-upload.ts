
// Browser-side upload for proposal assets: ask the server for a presigned PUT,
// then send the file straight to MinIO. Returns the permanent public URL that
// gets stored on the proposal/settings row.
//
// Replaces `upload()` from @vercel/blob/client — same two-step shape (server
// authorises, browser transfers), no vendor SDK.
export async function uploadProposalFile(
  file: File,
  pathname: string,
): Promise<string> {
  const signRes = await fetch("/api/proposals/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pathname,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  if (!signRes.ok) {
    const { error } = (await signRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Upload was not authorised");
  }
  const { uploadUrl, url } = (await signRes.json()) as {
    uploadUrl: string;
    url: string;
  };

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }
  return url;
}

/** Filenames land in a URL path — keep them boring. */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
}
