/**
 * Project board — the SAME board as NuraView's, not a copy of it.
 *
 * VK, 2026-08-03: "if any updates made it should sync both ways."
 *
 * This route used to BE a board: a hand-rolled four-column page that rendered a
 * title and a due date. Next to crmx1's real board — backlog and gantt tabs,
 * filter and sort, list view, card keys, labels, assignee avatars, priority,
 * comment counts, the task detail sheet — it was not the same product, and
 * rebuilding all of that here would have been a second implementation of a
 * board this repo already contains.
 *
 * So it is a redirect now. Dan's API serves NuraView's shared project through
 * its ordinary /task, /column, /label and /comment endpoints (see
 * apps/api/src/nvprojects/passthrough.ts), which means the real board route
 * works against it unmodified. Same components, same rows, same features.
 *
 * There is still no mirror and no sync: one source of truth, so a card moved on
 * either dashboard is the same database row.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";

type SharedBoardConfig = {
  connected: boolean;
  projectId: string | null;
  workspaceId: string | null;
  hashtag: string | null;
};

function RouteComponent() {
  // The ids come from the server rather than the bundle, so pointing this at a
  // different project is an environment change and not a rebuild.
  const config = useQuery({
    queryKey: ["nvprojects", "config"],
    queryFn: async (): Promise<SharedBoardConfig> => {
      const res = await fetch(getApiUrl("nvprojects/config"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (config.isLoading) {
    return (
      <Layout>
        <PageTitle title="Project board" />
        <div className="flex-1 p-5">
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  const { connected, projectId, workspaceId } = config.data ?? {
    connected: false,
    projectId: null,
    workspaceId: null,
  };

  if (connected && projectId && workspaceId) {
    return (
      <Navigate
        to="/dashboard/workspace/$workspaceId/project/$projectId/board"
        params={{ workspaceId, projectId }}
        replace
      />
    );
  }

  return (
    <Layout>
      <PageTitle title="Project board" />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Project board</h1>
      </header>

      <div className="flex-1 overflow-auto p-5">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm font-medium">
            The shared board is not connected yet.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            It reads and writes a single project on NuraView's CRM directly, so
            both dashboards show the same cards. To switch it on, set on this
            project:
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            <li>NV_PROJECTS_BASE_URL = https://crmx1.nuraview.com</li>
            <li>NV_PROJECTS_PROJECT_ID = &lt;the project id&gt;</li>
            <li>NV_PROJECTS_WORKSPACE_ID = &lt;its workspace id&gt;</li>
            <li className="pt-1">— and a credential —</li>
            <li>NV_PROJECTS_API_KEY = &lt;crmx1 → Settings → Developer&gt;</li>
            <li className="pt-1">— or —</li>
            <li>NV_PROJECTS_EMAIL / NV_PROJECTS_PASSWORD</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            The key is preferable: scoped, revocable, and no password stored.
            Whichever is used stays server-side and never reaches the browser.
          </p>
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/board")({
  component: RouteComponent,
});
