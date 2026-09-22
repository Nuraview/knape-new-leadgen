import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { visibleProjectIds } from "../../utils/require-crm-access";

/**
 * Projects visible to a user.
 *
 * Client meeting 2026-07-28: an employee logs in and sees only their own board
 * — "at all times he will have one board. That's it." Workspace membership used
 * to imply access to EVERY project, so Javed could open Habib's work.
 *
 *   owner / admin           → every project
 *   member WITH assignments → only those
 *   member WITHOUT any      → NOTHING
 *
 * That last line used to say "every project", so that shipping assignments
 * would not blank the app for anyone not yet assigned. The reasoning was
 * wrong: nobody was ever assigned, so in practice every employee could open
 * every board — Javed could read Habib's client work and Shantanu could read
 * both. A default that fails open is not a default, it is the absence of
 * access control.
 *
 * Fails closed now. An employee with no assignment sees an empty Projects
 * list, which is recoverable in five seconds from the project's Members tab,
 * whereas the other direction leaks client work and cannot be un-leaked.
 * Owners and admins are unaffected and never need an assignment row.
 *
 * Enforced here, not in the sidebar: hiding a nav item from someone who can
 * still fetch the project by id is not access control.
 */
async function getProjects(
  workspaceId: string,
  includeArchived = false,
  userId?: string,
) {
  const baseWhere = includeArchived
    ? eq(projectTable.workspaceId, workspaceId)
    : and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
      );

  let where = baseWhere;

  if (userId) {
    // The rule itself lives in utils/require-crm-access.ts, beside
    // canOpenProject, which answers the same question about one project. It was
    // written out here as well, and a rule kept in two places is a rule that
    // fails open in one of them.
    const visible = await visibleProjectIds(userId);

    if (visible !== "all") {
      // No assignments means no projects. inArray on an empty list is not
      // portable, so an id that cannot exist is used to force an empty result
      // rather than letting `where` fall back to baseWhere.
      where = and(
        baseWhere,
        inArray(
          projectTable.id,
          visible.length > 0 ? visible : ["__no_projects_assigned__"],
        ),
      );
    }
  }

  const projects = await db.query.projectTable.findMany({
    where,
    with: {
      tasks: true,
    },
  });

  const projectsWithStatistics = projects.map((project) => {
    const totalTasks = project.tasks.length;
    const completedTasks = project.tasks.filter(
      (task) => task.status === "done" || task.status === "archived",
    ).length;
    const completionPercentage =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const dueDate = project.tasks.reduce((earliest: Date | null, task) => {
      if (!earliest || (task.dueDate && task.dueDate < earliest))
        return task.dueDate;
      return earliest;
    }, null);

    return {
      ...project,
      statistics: {
        completionPercentage,
        totalTasks,
        dueDate,
      },
      archivedTasks: [],
      plannedTasks: [],
      columns: [],
    };
  });

  return projectsWithStatistics;
}

export default getProjects;
