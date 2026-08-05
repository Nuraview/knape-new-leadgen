import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectAccessButton } from "@/components/project/project-access-button";
import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import icons from "@/constants/project-icons";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import { toast } from "@/lib/toast";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { shortcuts } from "@/constants/shortcuts";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateMedium } from "@/lib/format";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const { data: access } = useMyAccess();
  const { mutateAsync: deleteProject } = useDeleteProject();
  // Only owners/admins get the control; the API enforces the same rule.
  const canDelete = access?.role === "owner" || access?.role === "admin";
  const [projectToDelete, setProjectToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const { data: projects, isLoading } = useGetProjects({
    workspaceId,
  });
  const { canCreateProjects } = useWorkspacePermission();
  const canCreate = canCreateProjects();

  const handleCreateProject = () => {
    if (!canCreate) return;
    setIsCreateProjectOpen(true);
  };

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.project.prefix]: {
        [shortcuts.project.create]: handleCreateProject,
      },
    },
  });

  const handleProjectClick = (projectId: string) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
    });
  };

  if (isLoading) {
    return (
      <>
        <PageTitle title={t("workspace:projects.pageTitle")} />
        <WorkspaceLayout
          title={t("workspace:projects.pageTitle")}
          headerActions={
            canCreate ? (
              <Button
                variant="outline"
                size="xs"
                onClick={handleCreateProject}
                className="gap-1"
              >
                <Plus className="w-3 h-3" />
                {t("workspace:projects.createProject")}
              </Button>
            ) : null
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.title")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.progress")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.targetDate")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.status")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3].map((i) => (
                <TableRow key={i}>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-5 w-5" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-2 w-20" />
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="py-3">
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkspaceLayout>
      </>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <>
        <PageTitle title={t("workspace:projects.pageTitle")} />
        <WorkspaceLayout
          title={t("workspace:projects.pageTitle")}
          headerActions={
            canCreate ? (
              <Button
                variant="outline"
                size="xs"
                onClick={handleCreateProject}
                className="gap-1"
              >
                <Plus className="w-3 h-3" />
                {t("workspace:projects.createProject")}
              </Button>
            ) : null
          }
        >
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGrid />
              </EmptyMedia>
              <EmptyTitle>{t("workspace:projects.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {canCreate
                  ? t("workspace:projects.emptyDescription")
                  : t("workspace:projects.emptyDescriptionReadOnly")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {canCreate && (
                <Button onClick={handleCreateProject}>
                  <Plus />
                  {t("workspace:projects.createProject")}
                </Button>
              )}
            </EmptyContent>
          </Empty>
        </WorkspaceLayout>

      <CreateProjectModal
          open={isCreateProjectOpen}
          onClose={() => setIsCreateProjectOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("workspace:projects.pageTitle")} />
      <WorkspaceLayout
        title={t("workspace:projects.pageTitle")}
        headerActions={
          canCreate ? (
            <Button
              variant="outline"
              size="xs"
              onClick={handleCreateProject}
              className="gap-1"
            >
              <Plus className="w-3 h-3" />
              {t("workspace:projects.createProject")}
            </Button>
          ) : null
        }
      >
        <Table>
          <TableHeader className="p-4">
            <TableRow>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.title")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.progress")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.dueDate")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.status")}
              </TableHead>
              {/* Deleting a project was only reachable from the sidebar's
                  hover menu, which is easy to miss on the page that lists
                  every project. */}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects?.map((project) => {
              if (!project || !project.id || !project.statistics) return null;

              const IconComponent =
                icons[project.icon as keyof typeof icons] || icons.Layout;

              const getStatusText = () => {
                if (project.statistics.totalTasks === 0)
                  return t("workspace:projects.projectStatus.notStarted");
                if (project.statistics.completionPercentage === 100)
                  return t("workspace:projects.projectStatus.complete");
                return t("workspace:projects.projectStatus.inProgress");
              };

              const getStatusVariant = () => {
                if (project.statistics.totalTasks === 0) return "secondary";
                if (project.statistics.completionPercentage === 100)
                  return "default";
                return "outline";
              };

              return (
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => handleProjectClick(project.id)}
                >
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <IconComponent className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium">{project.name}</span>
                      {/*
                        Who can see this board, in the list. Stops "who has
                        access to what" being a per-project hunt — the whole
                        mapping is readable in one glance down this column.
                        The click is swallowed so it does not also open the
                        project underneath.
                      */}
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops row navigation */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <ProjectAccessButton projectId={project.id} />
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-2">
                      <Progress
                        value={project.statistics.completionPercentage}
                        className="w-16 h-2"
                      />
                      <span className="text-sm text-muted-foreground">
                        {project.statistics.completionPercentage}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="text-sm text-muted-foreground">
                      {project.statistics.dueDate
                        ? formatDateMedium(project.statistics.dueDate)
                        : t("workspace:projects.noDueDate")}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge variant={getStatusVariant()}>
                      {getStatusText()}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="py-3 text-right"
                    // The row itself opens the project; stop the click here so
                    // hitting Delete doesn't also navigate away underneath the
                    // confirmation dialog.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${project.name}`}
                        title="Delete project"
                        onClick={() =>
                          setProjectToDelete({
                            id: project.id,
                            name: project.name,
                          })
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground hover:text-destructive-foreground" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </WorkspaceLayout>

      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setProjectToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{projectToDelete?.name}</strong> and all of its columns,
              tasks and comments will be permanently removed. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!projectToDelete) return;
                try {
                  await deleteProject({ id: projectToDelete.id });
                  toast.success(`Deleted "${projectToDelete.name}"`);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not delete project",
                  );
                } finally {
                  setProjectToDelete(null);
                }
              }}
            >
              Delete project
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateProjectModal
        open={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
      />
    </>
  );
}
