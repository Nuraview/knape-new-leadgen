/**
 * The page behind a share link.
 *
 * Deliberately outside the CRM shell and outside the session: whoever holds the
 * link — Dan on his phone, a stakeholder with no account — sees the post as it
 * will look in the feed, and nothing else. Read-only; approvals happen in the
 * CRM, where we know who is clicking.
 *
 * A flat route file, like invoice.$invoiceId and portal.claim.$token, so it
 * never meets the _authenticated guard.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { whenInZone } from "@/components/linkedin/dates";
import { LinkedInPreview } from "@/components/linkedin/linkedin-preview";
import { api } from "@/components/linkedin/types";
import { Skeleton } from "@/components/ui/skeleton";
import useBrand from "@/hooks/use-brand";

type SharedPost = {
  post: {
    status: string;
    body: string;
    scheduledAt: string | null;
    timezone: string;
    publishedAt: string | null;
    linkedinPostUrl: string | null;
  };
  media: { id: string; kind: string; fileName: string; url: string }[];
  author: string;
};

function RouteComponent() {
  const { token } = Route.useParams();

  const shared = useQuery({
    queryKey: ["linkedin-share", token],
    queryFn: () => api<SharedPost>(`linkedin-public/${token}`),
    retry: false,
  });

  // This page is a PUBLIC share link, so the brand comes from the build-time
  // seed when /api/config has not answered yet — never from a logged-in state,
  // because there is not one.
  const brand = useBrand();

  const post = shared.data?.post;
  const when = post?.scheduledAt
    ? whenInZone(post.scheduledAt, post.timezone)
    : null;

  return (
    <div className="flex min-h-svh justify-center bg-background px-4 py-10">
      <div className="h-fit w-full max-w-[600px] rounded-xl border border-border bg-card p-6">
        <p className="m-0 mb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
          LinkedIn post preview
        </p>

        {shared.isLoading ? (
          <div className="space-y-3 pt-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-56" />
          </div>
        ) : shared.error ? (
          <p className="text-rose-500 text-sm">
            This link has expired or was revoked. Ask for a fresh one.
          </p>
        ) : post ? (
          <>
            <p className="m-0 mb-4 text-[14px] text-muted-foreground">
              {post.status === "published" ? (
                <>Published</>
              ) : when ? (
                <>
                  Scheduled for{" "}
                  <strong className="text-foreground">{when}</strong>
                </>
              ) : (
                <>Not scheduled yet</>
              )}
            </p>

            <LinkedInPreview
              body={post.body}
              author={shared.data?.author ?? brand.name}
              when={when ?? undefined}
              media={(shared.data?.media ?? []).map((m) => ({
                key: m.id,
                kind: m.kind,
                url: m.url,
                name: m.fileName,
              }))}
            />

            {post.linkedinPostUrl ? (
              <p className="m-0 mt-3 text-[13.5px]">
                <a
                  href={post.linkedinPostUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline"
                >
                  View the live post on LinkedIn →
                </a>
              </p>
            ) : null}

            <p className="m-0 mt-4 text-[12.5px] text-muted-foreground">
              Preview only — this is how the post will appear in the feed.
              Approvals happen in the CRM.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/post/$token")({
  component: RouteComponent,
});
