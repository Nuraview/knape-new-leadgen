import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  AlignLeft,
  Calendar,
  CalendarClock,
  CalendarX,
  GitMerge,
  FolderKanban,
  GitPullRequest,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useExternalLinks from "@/hooks/queries/external-link/use-external-links";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { resolveLabelColor } from "@/lib/label-color";
import { isDoneStatus } from "@/lib/task-done";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import { Button } from "../ui/button";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";
import CardSubtasks from "./card-subtasks";
import TaskCardContextMenuContent from "./task-card-context-menu/task-card-context-menu-content";
import TaskCardLabels from "./task-labels";
import DoneToggle from "@/components/task/done-toggle";
import TaskLinkPopover from "@/components/task/task-link-popover";

type TaskCardProps = {
  task: Task;
  disableDragDrop?: boolean;
};

function TaskCard({ task, disableDragDrop = false }: TaskCardProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: disableDragDrop });
  const { project } = useProjectStore();
  const { data: workspace } = useActiveWorkspace();
  const { mutateAsync: deleteTask } = useDeleteTask();
  const navigate = useNavigate();
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
    compactMode: compact,
  } = useUserPreferencesStore();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
  const { data: externalLinks } = useExternalLinks(task.id);
  const { toggleSelection, isSelected, isFocused } = useBulkSelectionStore();
  const isTaskSelected = isSelected(task.id);
  const isTaskFocused = isFocused(task.id);

  const hasDescription = Boolean(task.description?.trim());
  const isTaskDone = isDoneStatus(task.status, project?.columns);

  const pullRequests = useMemo(() => {
    if (!externalLinks) return [];
    return externalLinks.filter((link) => link.resourceType === "pull_request");
  }, [externalLinks]);

  const getPRInfo = (pr: (typeof pullRequests)[number]) => {
    const isMerged = pr.metadata?.merged === true;
    const isDraft = pr.metadata?.draft === true;

    if (isMerged) {
      return {
        icon: <GitMerge className="h-3 w-3 text-info-foreground" />,
        status: t("tasks:pr.merged"),
        statusClass: "text-info-foreground",
      };
    }

    if (isDraft) {
      return {
        icon: <GitPullRequest className="h-3 w-3 text-muted-foreground" />,
        status: t("tasks:pr.draft"),
        statusClass: "text-muted-foreground",
      };
    }

    return {
      icon: <GitPullRequest className="h-3 w-3 text-success-foreground" />,
      status: t("tasks:pr.open"),
      statusClass: "text-success-foreground",
    };
  };

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition:
      transition || "transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    opacity: isDragging ? 0.6 : 1,
    touchAction: isDragging ? "none" : "auto",
    zIndex: isDragging ? 999 : "auto",
  };

  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );

  const assignee = useMemo(() => {
    return workspaceUsers?.members?.find(
      (member) => member.userId === task.userId,
    );
  }, [workspaceUsers, task.userId]);

  function handleTaskCardClick(
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (!project || !task || !workspace) return;

    if ((e as React.MouseEvent).metaKey || (e as React.KeyboardEvent).ctrlKey) {
      toggleSelection(task.id);
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    if (currentTaskId === task.id) {
      navigate({
        to: ".",
        search: {},
      });
    } else {
      navigate({
        to: ".",
        search: { taskId: task.id },
      });
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      toggleSelection(task.id);
    }
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask(task.id);
      queryClient.invalidateQueries({
        queryKey: ["tasks", project?.id],
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    } finally {
      toast.success(t("tasks:delete.success"));
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/** biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
          <div
            onClick={handleTaskCardClick}
            className={`group relative rounded-lg border bg-background ${
              compact ? "p-2" : "p-2.5"
            } shadow-xs/5 transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98] ${
              disableDragDrop ? "cursor-default" : "cursor-move"
            } ${
              isDragging
                ? "border-ring/40 bg-card shadow-lg"
                : "hover:border-border/90 hover:bg-background hover:shadow-sm"
            } ${
              isTaskSelected
                ? "border-ring/40 bg-accent/50 shadow-sm ring-1 ring-inset ring-ring/30"
                : "border-border"
            } ${isTaskFocused ? "ring-2 ring-inset ring-ring/50" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleTaskCardClick(e);
              } else if (e.key === "Escape") {
                handleKeyDown(e);
              }
            }}
          >
            {/*
              SHARE, on the card itself.
              VK: "I want the ability to share links of individual project cards
              with the assigned persons" — and explicitly, not buried. This
              existed already, but only inside a task's Properties sidebar, so
              you had to open the card and then go hunting. A capability nobody
              can find is not a capability.

              Appears on hover so a resting board stays clean, and is always
              present for keyboard and touch (focus-within / always-on below sm).
            */}
            <div
              className={`absolute opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100 ${
                compact ? "top-1 right-7" : "top-1.5 right-8"
              }`}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <TaskLinkPopover taskId={task.id} />
            </div>

            {showAssignees && (
              <div className={compact ? "absolute top-1.5 right-2" : "absolute top-2 right-2"}>
                {task.userId ? (
                  <Avatar className={compact ? "h-4 w-4" : "h-5 w-5"}>
                    <AvatarImage
                      src={assignee?.user?.image ?? ""}
                      alt={assignee?.user?.name || ""}
                    />
                    <AvatarFallback className="text-[10px] font-medium border border-border/30">
                      {getInitials(assignee?.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div
                    className={`flex items-center justify-center rounded-full border border-border bg-muted ${
                      compact ? "h-4 w-4" : "h-5 w-5"
                    }`}
                    title={t("tasks:assignee.unassigned")}
                  >
                    <span className="text-[9px] font-medium text-muted-foreground">
                      ?
                    </span>
                  </div>
                )}
              </div>
            )}

            {/*
              Tick, key and title on ONE line.

              This card used to stack five rows — number, title, labels, work
              stream, badges, then priority and date — so eight cards filled a
              1080px column and a board of forty was mostly scrolling ("the
              entire Kanban board is taking too much space", VK). Nothing is
              gone: the key moved inline ahead of the title, and everything that
              was a row of its own is now a chip on the one meta line below.
            */}
            <div className="flex items-start gap-1.5 pr-6">
              <DoneToggle
                taskId={task.id}
                projectId={task.projectId}
                status={task.status}
                columns={project?.columns}
                size={compact ? "sm" : "md"}
                className="mt-px shrink-0"
              />
              <div
                className={`min-w-0 overflow-hidden break-words font-medium ${
                  compact ? "text-[13px] leading-4" : "text-sm leading-5"
                } ${
                  isTaskDone
                    ? "text-muted-foreground line-through"
                    : "text-foreground/95"
                }`}
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: compact ? 2 : 3,
                  WebkitBoxOrient: "vertical",
                  wordBreak: "break-word",
                  hyphens: "auto",
                }}
              >
                {showTaskNumbers && (
                  <span className="mr-1.5 font-mono text-[10px] text-muted-foreground/80">
                    {project?.slug}-{task.number}
                  </span>
                )}
                {task.title}
              </div>
            </div>

            {/*
              One meta line, wrapped.

              Priority, date, stream, labels and the badges all read as "what
              else is true about this card", so they belong on the same line and
              only take a second one when there is genuinely too much. The
              subtask list opens full width underneath (it sets w-full, which in
              a wrapping flex row is its own line).
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground empty:hidden">
              {showPriority && (
                <span className="inline-flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5">
                  {getPriorityIcon(task.priority ?? "")}
                </span>
              )}

              {showDueDates && task.dueDate && (
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${dueDateStatusColors[getDueDateStatus(task.dueDate)]}`}
                >
                  {getDueDateStatus(task.dueDate) === "overdue" && (
                    <CalendarX className="h-3 w-3" />
                  )}
                  {getDueDateStatus(task.dueDate) === "due-soon" && (
                    <CalendarClock className="h-3 w-3" />
                  )}
                  {(getDueDateStatus(task.dueDate) === "far-future" ||
                    getDueDateStatus(task.dueDate) === "no-due-date") && (
                    <Calendar className="h-3 w-3" />
                  )}
                  {format(new Date(task.dueDate), "MMM d")}
                </span>
              )}

              {/*
                Work stream. A filled tint rather than an outlined chip, because
                it answers a different question from a label: not "what is this
                tagged" but "which piece of work does this belong to". Boards
                here are per-person, so without it a board is a stack of
                unrelated cards.
              */}
              {task.taskProject && (
                <span
                  className="inline-flex max-w-[9rem] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    color: resolveLabelColor(task.taskProject.color),
                    backgroundColor: `color-mix(in srgb, ${resolveLabelColor(task.taskProject.color)} 14%, transparent)`,
                  }}
                  title={task.taskProject.name}
                >
                  <FolderKanban className="h-3 w-3 shrink-0" />
                  <span className="truncate">{task.taskProject.name}</span>
                </span>
              )}


              {showLabels && <TaskCardLabels taskId={task.id} dense={compact} />}

              {/*
                Trello's card-front badges. Without them every imported card
                looks identical — a title and nothing else — so there is no way
                to tell which ones carry a brief, a file, or a discussion. The
                description badge is intentionally an icon with no count: the
                question is "is there a body?", not "how long is it".
              */}
              <CardSubtasks task={task} columns={project?.columns} />

              {hasDescription && (
                <span title={t("tasks:badges.hasDescription")}>
                  <AlignLeft className="h-3.5 w-3.5" />
                </span>
              )}
              {(task.commentCount ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-1"
                  title={t("tasks:badges.comments", {
                    count: task.commentCount ?? 0,
                  })}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {task.commentCount}
                </span>
              )}
              {(task.attachmentCount ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-1"
                  title={t("tasks:badges.attachments", {
                    count: task.attachmentCount ?? 0,
                  })}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {task.attachmentCount}
                </span>
              )}

              {pullRequests.length === 1 && (
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(pullRequests[0].url, "_blank");
                      }}
                      className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {getPRInfo(pullRequests[0]).icon}
                      <span>#{pullRequests[0].externalId}</span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    className="w-72 p-3"
                    side="bottom"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {getPRInfo(pullRequests[0]).icon}
                        <span>{getPRInfo(pullRequests[0]).status}</span>
                        <span className="text-muted-foreground/50">•</span>
                        <span>#{pullRequests[0].externalId}</span>
                      </div>
                      <p className="text-sm font-medium leading-snug">
                        {pullRequests[0].title || t("tasks:pr.label")}
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}

              {pullRequests.length > 1 &&
                (() => {
                  const hasOpen = pullRequests.some(
                    (pr) => !pr.metadata?.merged && !pr.metadata?.draft,
                  );
                  const allMerged = pullRequests.every(
                    (pr) => pr.metadata?.merged,
                  );
                  const iconColor = allMerged
                    ? "text-info-foreground"
                    : hasOpen
                      ? "text-success-foreground"
                      : "text-muted-foreground";

                  return (
                    <HoverCard openDelay={200} closeDelay={100}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                        >
                          <GitPullRequest className={`h-3 w-3 ${iconColor}`} />
                          <span>
                            {t("tasks:pr.count", {
                              count: pullRequests.length,
                            })}
                          </span>
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent
                        className="w-auto min-w-56 max-w-96 p-1"
                        side="bottom"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {pullRequests.map((pr, index) => {
                          const prInfo = getPRInfo(pr);
                          const repoMatch = pr.url.match(
                            /github\.com\/([^/]+\/[^/]+)\/pull/,
                          );
                          const repoName = repoMatch ? repoMatch[1] : null;
                          return (
                            <div key={pr.id}>
                              {index > 0 && (
                                <hr className="border-border my-1" />
                              )}
                              <button
                                type="button"
                                onClick={() => window.open(pr.url, "_blank")}
                                className="w-full px-2 py-1.5 text-left hover:bg-muted/50 rounded transition-colors"
                              >
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  {prInfo.icon}
                                  <span>
                                    {repoName}#{pr.externalId}
                                  </span>
                                </div>
                                <p className="text-xs leading-tight line-clamp-2 mt-0.5">
                                  {pr.title || t("tasks:pr.label")}
                                </p>
                                <span className="text-[10px] text-muted-foreground">
                                  {prInfo.status}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </HoverCardContent>
                    </HoverCard>
                  );
                })()}
            </div>
          </div>
        </ContextMenuTrigger>

        {project && workspace && (
          <TaskCardContextMenuContent
            task={task}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspace.id,
            }}
            onDeleteClick={() => setIsDeleteTaskModalOpen(true)}
          />
        )}
      </ContextMenu>

      <AlertDialog
        open={isDeleteTaskModalOpen}
        onOpenChange={setIsDeleteTaskModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                {t("common:actions.cancel")}
              </Button>
            </AlertDialogClose>
            <AlertDialogClose onClick={handleDeleteTask}>
              <Button variant="destructive" size="sm">
                {t("tasks:delete.action")}
              </Button>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TaskCard;
