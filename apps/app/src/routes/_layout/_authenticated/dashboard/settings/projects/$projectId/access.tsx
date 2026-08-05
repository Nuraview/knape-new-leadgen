/**
 * Project access — who can see this board.
 *
 * VK: "I would like to manually add people to its project and they can only see
 * and access those projects. For ex: one member can see a single client project
 * dashboard."
 *
 * Assignment existed as a table and a CLI script long before it existed as a
 * screen, which meant nobody was ever assigned — and the list defaulted to
 * "unassigned sees everything", so every employee could read every client's
 * board. This is the screen that makes the rule usable.
 *
 * Owners and admins are shown but not toggleable: they see every board by
 * definition, and a checkbox that cannot change anything is worse than no
 * checkbox.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import PageTitle from "@/components/page-title";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getApiUrl } from "@/fetchers/get-api-url";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/access",
)({
  component: RouteComponent,
});

type Person = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string | null;
  assigned: boolean;
  alwaysHasAccess: boolean;
};

function RouteComponent() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const key = ["project", projectId, "members"];

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<{ items: Person[] }> => {
      const r = await fetch(getApiUrl(`project/${projectId}/members`), {
        credentials: "include",
      });
      if (r.status === 403) {
        throw new Error("Only owners and admins can manage project access.");
      }
      if (!r.ok) throw new Error("Could not load project access");
      return r.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async ({
      userId,
      assigned,
    }: {
      userId: string;
      assigned: boolean;
    }) => {
      const url = assigned
        ? getApiUrl(`project/${projectId}/members/${userId}`)
        : getApiUrl(`project/${projectId}/members`);
      const r = await fetch(url, {
        method: assigned ? "DELETE" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: assigned ? undefined : JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      // The sidebar project list is scoped by this, so it has to refetch too.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const employees = items.filter((p) => !p.alwaysHasAccess);
  const admins = items.filter((p) => p.alwaysHasAccess);
  const assignedCount = employees.filter((p) => p.assigned).length;

  return (
    <>
      <PageTitle title="Project access" />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Who can see this project</h1>
          <p className="text-muted-foreground">
            Employees see only the projects they are added to. Everyone else's
            boards stay invisible to them.
          </p>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {(error as Error).message}
          </p>
        ) : null}

        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <section className="space-y-1">
              <h2 className="text-md font-medium">Employees</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                {assignedCount === 0
                  ? "Nobody is added yet — no employee can open this project."
                  : `${assignedCount} of ${employees.length} can open this project.`}
              </p>

              <div className="divide-y divide-border rounded-md border border-border">
                {employees.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/30"
                  >
                    <input
                      type="checkbox"
                      checked={p.assigned}
                      disabled={toggle.isPending}
                      onChange={() =>
                        toggle.mutate({ userId: p.id, assigned: p.assigned })
                      }
                    />
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={p.image ?? ""} alt={p.name ?? ""} />
                      <AvatarFallback className="text-xs">
                        {getInitials(p.name ?? p.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name || p.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.email}
                      </span>
                    </span>
                  </label>
                ))}
                {employees.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No employees in this workspace yet.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-1">
              <h2 className="text-md font-medium">Owners and admins</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                They can open every project. Nothing to configure here.
              </p>
              <div className="divide-y divide-border rounded-md border border-border bg-muted/30">
                {admins.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <ShieldCheck className="size-4 text-emerald-500" />
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={p.image ?? ""} alt={p.name ?? ""} />
                      <AvatarFallback className="text-xs">
                        {getInitials(p.name ?? p.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name || p.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.email} · {p.role}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
