/**
 * Projects — the cockpit's kanban board, in this dashboard.
 *
 * Not a second board. It reads the same pm_* tables in the same `leadgen`
 * database as the client's other dashboard, so a card created or dragged in
 * either one shows up in both. That is the whole reason it was ported rather
 * than rebuilt on this app's own project tables: those are a different product
 * with a different schema, and a board that disagreed with the one the client
 * already uses would be worse than no board.
 *
 * The component below is knape-leadgen's ProjectBoard, copied unchanged —
 * including its native HTML5 drag-and-drop and its stylesheet. It takes exactly
 * one prop, an `api` function, which is the seam that let it move without
 * edits: over there it is that app's fetch wrapper, here it is the proxied
 * leadgen client. Nothing else about it knows which app it is in.
 */
import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ProjectBoard } from "@/components/pm/project-board";
import { leadgen } from "@/fetchers/leadgen/client";

/**
 * Adapts the board's `(path, init) => Promise<T>` to the leadgen client.
 *
 * The board speaks fetch's vocabulary — a method and a JSON string body on
 * `init`. The client speaks verbs with a plain object. Translating here rather
 * than editing the board keeps the copy diffable against its original, which is
 * what makes a future fix over there portable to here.
 */
const api = <T,>(path: string, init?: RequestInit): Promise<T> => {
  const method = (init?.method ?? "GET").toUpperCase();
  // Only ever a JSON string: every call site in the board uses JSON.stringify.
  const body =
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

  if (method === "POST") return leadgen.post<T>(path, body);
  if (method === "PATCH") return leadgen.patch<T>(path, body);
  if (method === "DELETE") return leadgen.del<T>(path);
  return leadgen.get<T>(path);
};

function RouteComponent() {
  return (
    <Layout>
      <PageTitle title="Projects" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Projects</h1>
      </header>

      {/*
        `pm-scope` is what makes the copied stylesheet resolve — see
        styles/pm-board.css. Without it every colour in the board falls back to
        an inherited value and the columns render as flat grey.
      */}
      <div className="pm-scope flex-1 overflow-auto p-5">
        <ProjectBoard api={api} />
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/projects")({
  component: RouteComponent,
});
