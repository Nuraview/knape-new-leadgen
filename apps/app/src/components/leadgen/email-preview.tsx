import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgenEmailExtras } from "@/fetchers/leadgen/emails";

/**
 * What the recipient will actually see.
 *
 * Renders copy through the cockpit's PRODUCTION template — the same
 * `_body_to_html` that sends — so the preview includes the greeting, the
 * signature, the tracking-safe link rewriting and the per-angle designed
 * creative (Angle N / Day M gif). A textarea does not show any of that, and the
 * gap between "the copy I wrote" and "the email that lands" is exactly where
 * broken outreach comes from.
 *
 * Sandboxed iframe, not dangerouslySetInnerHTML. The HTML is assembled from
 * model-drafted copy and remote creative URLs, and injecting it into the app's
 * own document would let a stray script or style escape into the CRM. `sandbox`
 * with no allow-* tokens blocks scripts, forms and navigation while still
 * rendering the layout faithfully.
 */
export function EmailPreview({
  body,
  fromEmail,
  angle,
  stepIndex,
  className,
}: {
  body: string;
  fromEmail?: string;
  angle?: string;
  stepIndex?: number;
  className?: string;
}) {
  const preview = useQuery({
    queryKey: ["leadgen", "preview", body, fromEmail, angle, stepIndex],
    queryFn: () =>
      leadgenEmailExtras.preview({
        body,
        from_email: fromEmail,
        angle,
        step_index: stepIndex,
      }),
    // Rendering is a round trip to the cockpit; without this every keystroke in
    // an editor beside it would queue another one.
    enabled: Boolean(body?.trim()),
    staleTime: 30_000,
  });

  if (!body?.trim()) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing to preview yet.
      </p>
    );
  }

  if (preview.isLoading) return <Skeleton className={className ?? "h-80"} />;

  if (preview.error) {
    return (
      <p className="text-xs text-red-500">
        Preview unavailable — {String(preview.error as Error)}
      </p>
    );
  }

  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={preview.data?.html ?? ""}
      className={
        className ?? "h-[32rem] w-full rounded-md border border-border bg-white"
      }
    />
  );
}

export default EmailPreview;
