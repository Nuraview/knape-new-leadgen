/**
 * Standalone card page — /s/t/:taskId
 *
 * One card, on its own, with no board around it: the link you send to whoever
 * is doing the work.
 *
 * This replaced a public page that took a share token and rendered the card to
 * anyone at all, signed in or not. A card is internal — client name, scope,
 * team comments — and NuraView's rule is that an employee sees only the
 * projects they are assigned to, so a link that skipped the login was wider
 * than the board it came from.
 *
 * Now: sign-in first (beforeLoad, same redirect as the rest of the app), then
 * the API decides. GET /task/:id/card 404s unless the viewer is an owner,
 * admin, or a member assigned to that project — the page cannot widen access,
 * it only renders what the server already agreed to send.
 *
 * Still outside the _layout tree: the point is a standalone page without the
 * sidebar, not a second copy of the board.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { CircleDashed } from "lucide-react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";
import { renderSharedMarkdown } from "@/lib/render-shared-markdown";

type TaskCard = {
  task: {
    id: string;
    number: number | null;
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    startDate: string | null;
    dueDate: string | null;
    createdAt: string | null;
    assignee: string | null;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    workspaceId: string;
  };
  comments: { id: string; content: string; createdAt: string; author: string }[];
};

function RouteComponent() {
  const { taskId } = Route.useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["task-card", taskId],
    queryFn: async (): Promise<TaskCard> => {
      const response = await fetch(getApiUrl(`task/${taskId}/card`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("NOT_FOUND");
      return response.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  // "Not on this project" and "no such card" are the same screen on purpose:
  // the server returns the same 404 for both, so that a card you may not open
  // cannot be confirmed to exist.
  if (isError || !data) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md text-center">
          <CircleDashed className="mx-auto mb-4 size-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">This card isn't available</h1>
          <p className="mt-2 text-muted-foreground">
            Either it no longer exists, or your account isn't assigned to its
            project. Ask an admin to add you to the project.
          </p>
        </div>
      </div>
    );
  }

  const { task, project, comments } = data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <img src="/nuraview-logo.png" alt="NuraView" className="h-6 w-auto" />
          <span className="text-sm text-muted-foreground">{project.name}</span>
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
            params={{
              workspaceId: project.workspaceId,
              projectId: project.id,
              taskId: task.id,
            }}
            className="ms-auto rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open in board
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-border px-2 py-0.5 capitalize text-muted-foreground">
            {task.status.replace(/-/g, " ")}
          </span>
          {task.priority ? (
            <span className="rounded border border-border px-2 py-0.5 capitalize text-muted-foreground">
              {task.priority.replace(/-/g, " ")}
            </span>
          ) : null}
          {task.assignee ? (
            <span className="rounded border border-border px-2 py-0.5 text-muted-foreground">
              {task.assignee}
            </span>
          ) : null}
          {task.dueDate ? (
            <span className="rounded border border-border px-2 py-0.5 text-muted-foreground">
              Due {new Date(task.dueDate).toLocaleDateString()}
            </span>
          ) : null}
        </div>

        <h1 className="text-3xl font-semibold leading-tight">{task.title}</h1>

        {task.description ? (
          <div
            className="prose prose-neutral mt-6 max-w-none dark:prose-invert"
            /*
             * The description is stored as MARKDOWN, not HTML — injecting it
             * raw printed literal [label](url) syntax and left @tiptap/markdown
             * backslash escapes visible, so a URL containing an underscore was
             * shown (and copied) broken. renderSharedMarkdown escapes HTML
             * first, then converts, which also keeps stored text from becoming
             * script on this page.
             */
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: renderSharedMarkdown(task.description),
            }}
          />
        ) : (
          <p className="mt-6 text-muted-foreground">No description yet.</p>
        )}

        {comments.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Comments
            </h2>
            <div className="flex flex-col gap-3">
              {comments.map((comment) => (
                <article
                  key={comment.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {comment.author}
                    </span>
                    <span>
                      {new Date(comment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {/* Comments are markdown too, same as the description —
                      printed raw they show literal [label](url) and
                      @tiptap/markdown's backslash escapes. */}
                  <div
                    className="prose prose-sm prose-neutral max-w-none dark:prose-invert"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: renderSharedMarkdown(comment.content),
                    }}
                  />
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="mx-auto max-w-3xl px-6 pb-10 text-xs text-muted-foreground">
        Internal card · visible to people assigned to {project.name}
      </footer>
    </div>
  );
}

export const Route = createFileRoute("/s/t/$taskId")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.pathname },
      });
    }
  },
  component: RouteComponent,
});
