import { orm } from "@/lib/db-compat";
import { junctionTableHelpers, extractWatcherUsers } from "@/lib/junction-helpers";

export const getBoard = async (id: string) => {
  const board = await orm.boards.findFirst({
    where: {
      id: id,
      deletedAt: null,
    },
    include: {
      assigned_user: {
        select: {
          name: true,
        },
      },
      // Include watchers through BoardWatchers junction table
      ...junctionTableHelpers.includeWatchersWithUsers(),
    },
  });

  const sections = await orm.sections.findMany({
    where: {
      board: id,
    },
    orderBy: {
      position: "asc",
    },
    include: {
      tasks: {
        orderBy: {
          position: "desc",
        },
      },
    },
  });

  const data = {
    board,
    sections,
  };
  return data;
};
