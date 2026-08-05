"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const createProject = async (data: {
  title: string;
  description: string;
  visibility: string;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { title, description, visibility } = data;
  if (!title) return { error: "Missing project name" };
  if (!description) return { error: "Missing project description" };

  try {
    const boardsCount = await orm.boards.count();

    const newBoard = await orm.boards.create({
      data: {
        v: 0,
        user: session.user.id,
        title,
        description,
        position: boardsCount > 0 ? boardsCount : 0,
        visibility,
        sharedWith: [session.user.id],
        createdBy: session.user.id,
      },
    });

    await orm.sections.create({
      data: {
        v: 0,
        board: newBoard.id,
        title: "Backlog",
        position: 0,
      },
    });

    revalidatePath("/projects", "page");
    return { data: newBoard };
  } catch (error) {
    console.log("[CREATE_PROJECT]", error);
    return { error: "Failed to create project" };
  }
};
