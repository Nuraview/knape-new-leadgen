/**
 * Who can see this board — shown ON the board, not buried in settings.
 *
 * First version of this lived at Settings → Projects → <project> → Access.
 * Nobody found it, which is the same mistake as putting 2FA in an account menu:
 * a control you have to go looking for is a control that does not get used, and
 * "who can see this client's work" is not something to have to go looking for.
 *
 * So it sits in the project header as a stack of faces. The faces ARE the
 * answer — you can see at a glance who has access without clicking anything.
 * Clicking opens the checkbox list to change it.
 *
 * Admins only. A member seeing this would learn that other people and other
 * boards exist, which is exactly what the access rule is hiding.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, UserPlus } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getApiUrl } from "@/fetchers/get-api-url";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";

type Person = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string | null;
  assigned: boolean;
  alwaysHasAccess: boolean;
};

export function ProjectAccessButton({ projectId }: { projectId: string }) {
  const { data: access } = useMyAccess();
  const { data: config } = useGetConfig();
  /*
   * Access to a SHARED project is managed on the deployment that owns it.
   *
   * Being an owner here says nothing about the other side: the service account
   * this instance connects with is a plain member there, so listing or changing
   * that project's members is refused — correctly. Offering the panel anyway
   * meant a 403 on every board render for a control that could never work.
   */
  const isShared =
    Boolean(config?.sharedProjectId) && config?.sharedProjectId === projectId;
  const isAdmin =
    !isShared && (access?.role === "owner" || access?.role === "admin");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ["project", projectId, "members"];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<{ items: Person[] }> => {
      const r = await fetch(getApiUrl(`project/${projectId}/members`), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Could not load project access");
      return r.json();
    },
    enabled: isAdmin,
  });

  const toggle = useMutation({
    mutationFn: async ({
      userId,
      assigned,
    }: {
      userId: string;
      assigned: boolean;
    }) => {
      const r = await fetch(
        assigned
          ? getApiUrl(`project/${projectId}/members/${userId}`)
          : getApiUrl(`project/${projectId}/members`),
        {
          method: assigned ? "DELETE" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: assigned ? undefined : JSON.stringify({ userId }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: key });
      // The sidebar's project list is scoped by exactly this, so it must
      // refetch or the change looks like it did not take.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(vars.assigned ? "Access removed" : "Access granted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  const employees = (data?.items ?? []).filter((p) => !p.alwaysHasAccess);
  const withAccess = employees.filter((p) => p.assigned);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            title="Who can see this project"
          />
        }
      >
        {withAccess.length > 0 ? (
          <span className="flex -space-x-1.5">
            {withAccess.slice(0, 3).map((p) => (
              <Avatar
                key={p.id}
                className="size-5 ring-2 ring-background"
                title={p.name || p.email}
              >
                <AvatarImage src={p.image ?? ""} alt={p.name ?? ""} />
                <AvatarFallback className="text-[9px]">
                  {getInitials(p.name ?? p.email)}
                </AvatarFallback>
              </Avatar>
            ))}
            {withAccess.length > 3 ? (
              <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-background">
                +{withAccess.length - 3}
              </span>
            ) : null}
          </span>
        ) : (
          // No faces is itself the message: nobody but admins can open this.
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            Admins only
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-medium">Who can see this project</p>
          <p className="text-xs text-muted-foreground">
            {withAccess.length === 0
              ? "Only owners and admins."
              : `${withAccess.length} employee${withAccess.length === 1 ? "" : "s"} plus all admins.`}
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {isLoading ? (
            <div className="px-3 py-4">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : (
            employees.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  checked={p.assigned}
                  disabled={toggle.isPending}
                  onChange={() =>
                    toggle.mutate({ userId: p.id, assigned: p.assigned })
                  }
                />
                <Avatar className="size-6">
                  <AvatarImage src={p.image ?? ""} alt={p.name ?? ""} />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(p.name ?? p.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {p.name || p.email}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {p.email}
                  </span>
                </span>
              </label>
            ))
          )}
          {!isLoading && employees.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No employees in this workspace yet.
            </p>
          ) : null}
        </div>

        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <UserPlus className="me-1 inline size-3" />
          Owners and admins always see every project.
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ProjectAccessButton;
