/**
 * Import a Trello board export (JSON) into a NuraView project.
 *
 *   bun run scripts/import-trello.ts --file <export.json> [--owner <email>] [--dry]
 *
 * Client meeting 2026-07-28: bring Javed's and Habib's boards across rather
 * than retyping them. The Trello JSON export carries everything we need, so
 * this reads a file instead of calling the Trello API — no API key to manage,
 * and the import is reproducible from a file you can inspect first.
 *
 * What comes across, and what deliberately does not:
 *
 *   lists      → columns, in Trello's own order. `isFinal` is set on the
 *                terminal lists so a task landing there counts as done.
 *   cards      → tasks, keeping description, due date and relative order.
 *                ARCHIVED cards (closed: true) are skipped — they are archived
 *                in Trello and importing them would resurrect work the team
 *                deliberately put away.
 *   checklists → appended to the task description as a markdown checklist.
 *                Kaneo has no checklist primitive; sub-tasks would imply a
 *                relationship Trello does not actually have here.
 *   comments   → real comments, oldest first, with the original author name and
 *                date preserved in the body. They are attributed to the
 *                importing user because Trello members are not NuraView users,
 *                and inventing accounts for them would be worse.
 *
 * Idempotent by project name: re-running replaces the project's columns and
 * tasks rather than stacking duplicates. That matters because the first run
 * almost never has the mapping exactly right.
 */
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import db from "../src/database";
import {
  columnTable,
  commentTable,
  projectTable,
  taskAttachmentTable,
  taskTable,
  userTable,
  workspaceTable,
} from "../src/database/schema";

function arg(name: string, fallback?: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]?.startsWith("--") === false) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const DRY = process.argv.includes("--dry");

/** Trello lists whose cards are finished work. */
const FINAL_LIST_NAMES = new Set(["approved/cancelled", "done", "complete"]);

type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  due: string | null;
  dueComplete: boolean;
  idList: string;
  idChecklists: string[];
  pos: number;
  attachments?: TrelloAttachment[];
};

type TrelloAttachment = {
  id: string;
  name: string;
  fileName: string;
  url: string;
  bytes: number | null;
  date: string;
  mimeType: string | null;
  isUpload: boolean;
};

type TrelloExport = {
  name: string;
  desc?: string;
  lists: { id: string; name: string; closed: boolean; pos: number }[];
  cards: TrelloCard[];
  checklists: {
    id: string;
    idCard: string;
    name: string;
    checkItems: { name: string; state: string; pos: number }[];
  }[];
  actions: {
    type: string;
    date: string;
    memberCreator?: { fullName?: string; username?: string };
    data?: { text?: string; card?: { id: string } };
  }[];
};

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "board"
  );
}

/** Checklists rendered as markdown, appended under the card's own description. */
function checklistMarkdown(
  card: TrelloCard,
  checklists: TrelloExport["checklists"],
) {
  const mine = checklists.filter((c) => c.idCard === card.id);
  if (mine.length === 0) return "";

  const blocks = mine.map((list) => {
    const items = [...list.checkItems]
      .sort((a, b) => a.pos - b.pos)
      .map((i) => `- [${i.state === "complete" ? "x" : " "}] ${i.name}`)
      .join("\n");
    return `\n\n**${list.name}**\n${items}`;
  });

  return blocks.join("");
}

/**
 * DEPRECATED — kept only to document why it went away.
 *
 * Attachments used to be appended to the description as markdown. Trello shows
 * them as their own panel with file-type icons, size and date, so flattening
 * them into the body is a large part of why an imported card read as a wall of
 * text next to the original. They are rows in task_attachment now.
 *
 * Original doc follows.
 *
 * Attachments as a markdown block on the task.
 *
 * The export contains only metadata and a trello.com URL — the FILES are not in
 * the JSON, and those URLs return 401 without a Trello key/token, so they
 * cannot be mirrored from the export alone. Recording name, size, date and the
 * original link means nothing is silently lost: anyone with Trello access can
 * still reach the file, and when a key is supplied (--trello-key/--trello-token)
 * the files are downloaded and re-hosted instead.
 */
function attachmentMarkdown(card: TrelloCard, mirrored: Map<string, string>) {
  const list = card.attachments ?? [];
  if (list.length === 0) return "";

  const rows = list.map((a) => {
    const size = a.bytes ? ` — ${(a.bytes / 1024 / 1024).toFixed(1)} MB` : "";
    const href = mirrored.get(a.id) ?? a.url;
    const note = mirrored.has(a.id) ? "" : " _(Trello login required)_";
    return `- [${a.name}](${href})${size}, added ${a.date.slice(0, 10)}${note}`;
  });

  return `\n\n**Attachments (${list.length})**\n${rows.join("\n")}`;
}

/**
 * Pull the actual files down and re-host them, when Trello credentials are
 * given. Without them this is a no-op and the links stay pointed at Trello.
 */
async function mirrorAttachments(
  cards: TrelloCard[],
): Promise<Map<string, string>> {
  const trelloKey = arg("trello-key");
  const trelloToken = arg("trello-token");
  const mirrored = new Map<string, string>();

  const all = cards.flatMap((c) => c.attachments ?? []);
  if (all.length === 0) return mirrored;

  if (!trelloKey || !trelloToken) {
    console.log(
      `\n${all.length} attachments found. Files are NOT in the export and\n` +
        "trello.com returns 401 without credentials, so links will point at\n" +
        "Trello. Re-run with --trello-key <key> --trello-token <token> to\n" +
        "download and re-host them.",
    );
    return mirrored;
  }

  const { putPrivateObject } = await import("../src/storage/s3");
  const publicBase = (process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");

  for (const a of all) {
    try {
      const res = await fetch(a.url, {
        headers: {
          Authorization: `OAuth oauth_consumer_key="${trelloKey}", oauth_token="${trelloToken}"`,
        },
      });
      if (!res.ok) {
        console.warn(`  attachment ${a.name}: HTTP ${res.status}`);
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      const key = await putPrivateObject(
        `trello/${a.id}/${a.fileName || a.name}`,
        body,
        a.mimeType ?? "application/octet-stream",
      );
      mirrored.set(a.id, publicBase ? `${publicBase}/${key}` : key);
    } catch (e) {
      console.warn(`  attachment ${a.name}: ${(e as Error).message}`);
    }
  }

  console.log(`Mirrored ${mirrored.size}/${all.length} attachments.`);
  return mirrored;
}

/**
 * Pull a board straight from Trello, in the same shape as its JSON export.
 *
 * `?lists=open&cards=open&card_attachments=true&card_checklists=all
 *  &actions=commentCard` returns exactly the structure the manual export does,
 * so the whole import path below is shared and there is no second code path to
 * keep in step.
 *
 * This exists because the export-a-file loop cannot answer "is this current?".
 * The board gained two cards after the first import and nothing surfaced it —
 * the only way anyone found out was the client saying so.
 */
async function fetchBoard(
  boardId: string,
  key: string,
  token: string,
): Promise<TrelloExport> {
  const params = new URLSearchParams({
    key,
    token,
    lists: "open",
    cards: "open",
    card_attachments: "true",
    card_checklists: "all",
    actions: "commentCard",
    actions_limit: "1000",
    fields: "name,desc",
  });
  const url = `https://api.trello.com/1/boards/${boardId}?${params}`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Trello ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as TrelloExport;
}

async function main() {
  const file = arg("file");
  const boardId = arg("board");
  const trelloKey = arg("trello-key");
  const trelloToken = arg("trello-token");

  if (!file && !boardId) {
    console.error(
      "Usage:\n" +
        "  import-trello.ts --board <boardId> --trello-key <k> --trello-token <t> [--owner <email>]\n" +
        "  import-trello.ts --file <export.json> [--owner <email>] [--dry]",
    );
    process.exit(1);
  }

  let data: TrelloExport;
  if (boardId) {
    if (!trelloKey || !trelloToken) {
      console.error("--board needs --trello-key and --trello-token.");
      process.exit(1);
    }
    console.log(`Fetching board ${boardId} from Trello…`);
    data = await fetchBoard(boardId, trelloKey, trelloToken);
  } else {
    data = JSON.parse(readFileSync(file as string, "utf8")) as TrelloExport;
  }

  const [workspace] = await db.select().from(workspaceTable).limit(1);
  if (!workspace) {
    console.error("No workspace found — run seed-instance.ts first.");
    process.exit(1);
  }

  const ownerEmail = arg("owner");
  const [owner] = ownerEmail
    ? await db
        .select()
        .from(userTable)
        .where(eq(userTable.email, ownerEmail.toLowerCase()))
        .limit(1)
    : await db.select().from(userTable).limit(1);

  if (!owner) {
    console.error(`No user found${ownerEmail ? ` for ${ownerEmail}` : ""}.`);
    process.exit(1);
  }

  const openLists = data.lists
    .filter((l) => !l.closed)
    .sort((a, b) => a.pos - b.pos);
  const openCards = data.cards.filter((c) => !c.closed);
  const attachmentCount = openCards.reduce(
    (n, c) => n + (c.attachments?.length ?? 0),
    0,
  );
  const skipped = data.cards.length - openCards.length;

  console.log(`Board:      ${data.name}`);
  console.log(`Workspace:  ${workspace.name}`);
  console.log(`Owner:      ${owner.email}`);
  console.log(`Lists:      ${openLists.length}`);
  console.log(
    `Cards:      ${openCards.length}${skipped ? ` (${skipped} archived, skipped)` : ""}`,
  );

  const comments = data.actions
    .filter((a) => a.type === "commentCard" && a.data?.card?.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Comments:   ${comments.length}`);
  console.log(`Attachments:${attachmentCount}`);

  if (DRY) {
    for (const list of openLists) {
      const cards = openCards.filter((c) => c.idList === list.id);
      console.log(`\n  ${list.name} (${cards.length})`);
      for (const card of cards) {
        const n = comments.filter((a) => a.data?.card?.id === card.id).length;
        console.log(
          `    - ${card.name}${card.due ? `  due ${card.due.slice(0, 10)}` : ""}${n ? `  ${n} comments` : ""}`,
        );
      }
    }
    console.log("\nDry run — nothing written.");
    process.exit(0);
  }

  // Re-runnable: wipe this project's board and rebuild it.
  const [existing] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspace.id),
        eq(projectTable.name, data.name),
      ),
    )
    .limit(1);

  let projectId: string;

  if (existing) {
    projectId = existing.id;
    // Comments cascade from tasks; delete tasks then columns.
    await db.delete(taskTable).where(eq(taskTable.projectId, projectId));
    await db.delete(columnTable).where(eq(columnTable.projectId, projectId));
    console.log(`\nReplacing existing project ${projectId}`);
  } else {
    const [created] = await db
      .insert(projectTable)
      .values({
        workspaceId: workspace.id,
        name: data.name,
        slug: slugify(data.name),
        description: data.desc || null,
        icon: "Layout",
        createdAt: new Date(),
      })
      .returning({ id: projectTable.id });
    projectId = created.id;
    console.log(`\nCreated project ${projectId}`);
  }

  const mirrored = await mirrorAttachments(openCards);

  // Columns, in Trello's order.
  const columnIdByTrelloList = new Map<string, string>();
  for (const [index, list] of openLists.entries()) {
    const [col] = await db
      .insert(columnTable)
      .values({
        projectId,
        name: list.name,
        slug: slugify(list.name),
        position: index,
        isFinal: FINAL_LIST_NAMES.has(list.name.trim().toLowerCase()),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: columnTable.id });
    columnIdByTrelloList.set(list.id, col.id);
  }

  // Tasks. `number` is the per-project ticket number, so it counts from 1.
  let ticket = 0;
  const taskIdByTrelloCard = new Map<string, string>();

  for (const list of openLists) {
    const cards = openCards
      .filter((c) => c.idList === list.id)
      .sort((a, b) => a.pos - b.pos);

    for (const [index, card] of cards.entries()) {
      ticket += 1;
      const columnId = columnIdByTrelloList.get(list.id);
      // Attachments are rows now, not markdown — see the note on
      // attachmentMarkdown. The description keeps the card's own body plus its
      // checklist, which genuinely is prose.
      const description =
        (card.desc || "") + checklistMarkdown(card, data.checklists);

      const [task] = await db
        .insert(taskTable)
        .values({
          projectId,
          columnId,
          number: ticket,
          userId: owner.id,
          title: card.name,
          description: description.trim() || null,
          status: slugify(list.name),
          position: index * 1000,
          dueDate: card.due ? new Date(card.due) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: taskTable.id });

      taskIdByTrelloCard.set(card.id, task.id);

      for (const a of card.attachments ?? []) {
        await db.insert(taskAttachmentTable).values({
          taskId: task.id,
          name: a.name,
          storageKey: mirrored.get(a.id) ?? null,
          sourceUrl: a.url,
          contentType: a.mimeType,
          bytes: a.bytes,
          uploadedBy: owner.id,
          createdAt: new Date(a.date),
        });
      }
    }
  }

  // Comments, oldest first, with the Trello author preserved in the text.
  let imported = 0;
  for (const action of comments) {
    const taskId = taskIdByTrelloCard.get(action.data?.card?.id ?? "");
    if (!taskId || !action.data?.text) continue;

    const author =
      action.memberCreator?.fullName ||
      action.memberCreator?.username ||
      "Trello";

    await db.insert(commentTable).values({
      taskId,
      userId: owner.id,
      content: `**${author}** (Trello, ${action.date.slice(0, 10)}):\n\n${action.data.text}`,
      createdAt: new Date(action.date),
      updatedAt: new Date(action.date),
    });
    imported += 1;
  }

  console.log(
    `Imported ${openLists.length} columns, ${ticket} tasks, ${imported} comments.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
