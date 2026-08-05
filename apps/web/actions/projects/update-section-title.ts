"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const updateSectionTitle = async (data: {
  sectionId: string;
  newTitle: string;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { sectionId, newTitle } = data;
  if (!sectionId) return { error: "Missing section ID" };

  try {
    await orm.sections.update({
      where: { id: sectionId },
      data: { title: newTitle },
    });

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[UPDATE_SECTION_TITLE]", error);
    return { error: "Failed to update section title" };
  }
};
