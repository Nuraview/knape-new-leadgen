import { orm } from "@/lib/db-compat";

export const getKanbanData = async (boardId: string) => {
  const board = await orm.boards.findUnique({
    where: {
      id: boardId,
    },
  });
  //console.log(board, "getBoard - board");

  //Select sections from board with boardId, tasks are included
  let sections = await orm.sections.findMany({
    where: {
      board: boardId,
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
