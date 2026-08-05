"use server";
import { getSession } from "@/lib/auth-server";

import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export async function updateProfilePhoto(avatar: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  if (!avatar) throw new Error("No avatar provided");

  await orm.users.update({
    where: { id: session.user.id },
    data: { avatar },
  });

  revalidatePath("/profile");
}
