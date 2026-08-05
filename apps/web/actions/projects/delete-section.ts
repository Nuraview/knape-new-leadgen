"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const deleteSection = async (sectionId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!sectionId) return { error: "Missing section ID" };

  try {
    await orm.tasks.deleteMany({
      where: { section: sectionId },
    });

    await orm.sections.delete({
      where: { id: sectionId },
    });

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_SECTION]", error);
    return { error: "Failed to delete section" };
  }
};
