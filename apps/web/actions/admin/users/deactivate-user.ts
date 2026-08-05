"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const deactivateUser = async (userId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!userId) return { error: "userId is required" };

  try {
    const user = await orm.users.update({
      where: { id: userId },
      data: { userStatus: "INACTIVE" },
    });
    revalidatePath("/admin", "page");
    return { data: user };
  } catch (error) {
    console.log("[DEACTIVATE_USER]", error);
    return { error: "Failed to deactivate user" };
  }
};
