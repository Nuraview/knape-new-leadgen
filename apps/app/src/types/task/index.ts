type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

type TaskExternalLink = {
  id: string;
  taskId: string;
  integrationId: string;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

type Task = {
  id: string;
  title: string;
  number: number | null;
  description: string | null;
  status: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  position: number | null;
  createdAt: string;
  updatedAt?: string;
  userId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage?: string | null;
  projectId: string;
  columnId?: string | null;
  labels?: TaskLabel[];
  externalLinks?: TaskExternalLink[];
  /**
   * Card-front badge counts, from the board query. Trello shows these on the
   * card face so you can tell a rich card from a bare one without opening it —
   * an imported board without them is just a stack of titles.
   */
  commentCount?: number;
  attachmentCount?: number;
  /**
   * Subtask progress for the "2/5" badge. `done` uses the same rule as the
   * detail panel — a subtask is complete when its status is a final column —
   * so the two can never disagree.
   */
  subtaskTotal?: number;
  subtaskDone?: number;
  /**
   * The checklist itself, so the card front can expand into it without a
   * request per card.
   */
  subtasks?: Array<{
    id: string;
    title: string;
    status: string;
    done: boolean;
  }>;
  /**
   * Set when this card is a subtask of another card ON THE SAME BOARD.
   *
   * Subtasks are real tasks, so without this the board draws every checklist
   * item as a card of its own beside its parent. Null on a subtask whose
   * parent lives on somebody else's board — there it IS an ordinary card, and
   * hiding it would hide it from the only person who can do it.
   */
  parentTaskId?: string | null;
  /**
   * The work stream this card belongs to — "Win the Day Planner",
   * "Nuraview CRM". NOT the board: boards here are per-person, and one board
   * carries cards from several streams. Null when unassigned.
   */
  taskProjectId?: string | null;
  taskProject?: { id: string; name: string; color: string } | null;
};

export default Task;
