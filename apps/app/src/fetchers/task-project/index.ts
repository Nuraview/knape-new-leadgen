import { client } from "@nuraview/libs";

export type TaskProject = {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  taskCount?: number;
};

export async function listTaskProjects(
  workspaceId: string,
): Promise<TaskProject[]> {
  const response = await client["task-project"].workspace[":workspaceId"].$get({
    param: { workspaceId },
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as TaskProject[];
}

/** Create, or return the existing stream with that name. */
export async function createTaskProject(
  workspaceId: string,
  name: string,
  color?: string,
): Promise<TaskProject> {
  const response = await client["task-project"].workspace[":workspaceId"].$post(
    { param: { workspaceId }, json: { name, color } },
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as TaskProject;
}

/** null clears the stream on the card. */
export async function setTaskProjectOnTask(
  taskId: string,
  taskProjectId: string | null,
) {
  const response = await client.task["task-project"][":id"].$put({
    param: { id: taskId },
    json: { taskProjectId },
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
