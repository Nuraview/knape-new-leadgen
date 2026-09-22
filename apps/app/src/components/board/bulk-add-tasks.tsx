/**
 * Paste a JSON array, get cards.
 *
 * An importer already existed, but it took a .json FILE and lived in project
 * settings — so adding a batch meant leaving the board, writing a file and
 * uploading it. Meeting notes arrive as text in a chat window, and the gap
 * between "text" and "file on disk" is where the batch stops being added at
 * all. This is the same endpoint, reachable from the board, taking the thing
 * people actually have.
 */
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useImportTasks from "@/hooks/mutations/task/use-import-tasks";
import { toast } from "@/lib/toast";

const SAMPLE = `[
  {
    "title": "Move sending from Contabo to MailPool",
    "status": "to-do",
    "priority": "medium",
    "dueDate": "2026-09-10",
    "project": "Win the Day Planner",
    "assigneeEmail": "afham@nuraview.com",
    "labels": ["Infrastructure"],
    "subtasks": ["Warm the new IPs", "Cut the DNS over"],
    "description": "Optional body text."
  }
]`;

type Props = { projectId?: string; defaultStatus?: string };

/**
 * A JSON key, marked as one.
 *
 * The description names six fields, and a bare <code> inherits no styling here — the names read
 * as ordinary prose set in a slightly different face, which is what made the paragraph a wall.
 */
function Field({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

export function BulkAddTasks({ projectId, defaultStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const { mutateAsync: importTasks, isPending } = useImportTasks();
  const { data: columns = [] } = useGetColumns(projectId ?? "");
  // Column slugs are what `status` is checked against, and they differ per
  // board — "on-hold" here, "on-hold-approved" there.
  const statuses = columns.map((c: { slug: string }) => c.slug);

  const run = async () => {
    if (!projectId) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      toast.error(
        `That is not valid JSON — ${
          error instanceof Error ? error.message : "check the brackets"
        }`,
      );
      return;
    }

    // Accept a bare array or {tasks:[...]}, because both are what people
    // paste and rejecting one of them teaches nothing.
    const rows = Array.isArray(parsed)
      ? parsed
      : ((parsed as { tasks?: unknown[] })?.tasks ?? null);

    if (!Array.isArray(rows) || rows.length === 0) {
      toast.error("Expected a JSON array of tasks.");
      return;
    }

    const missing = rows.findIndex(
      (r) => !r || typeof (r as { title?: unknown }).title !== "string",
    );
    if (missing !== -1) {
      toast.error(`Row ${missing + 1} has no "title".`);
      return;
    }

    try {
      const result = (await importTasks({
        projectId,
        // status is the only field the endpoint requires and the one people
        // most often leave out; default it to the board's first column.
        tasks: rows.map((r) => ({
          status: defaultStatus ?? statuses[0] ?? "to-do",
          ...(r as Record<string, unknown>),
        })) as never,
      })) as {
        results?: {
          successful?: number;
          total?: number;
          failed?: number;
          tasks?: Array<{ warnings?: string[] }>;
        };
      };

      const ok = result?.results?.successful ?? rows.length;
      const total = result?.results?.total ?? rows.length;
      // No hand-off on this instance — every row lands on the board being
      // imported into, whoever is named on it (see task/controllers/
      // import-tasks.ts), so there is no second board to account for here.
      const added =
        ok === total
          ? `Added ${ok} card${ok === 1 ? "" : "s"}.`
          : `Added ${ok} of ${total}. The rest are listed in the response.`;
      toast.success(added);

      /*
       * Warnings were being collected by the server and thrown away here.
       * A batch that named an unknown status or an unknown person still
       * reported a clean "Added 16 cards", which is how 146 cards were
       * created into the backlog without anyone noticing for two days.
       * Anything the server flagged is now said out loud.
       */
      const flagged = [
        ...new Set(
          (result?.results?.tasks ?? [])
            .flatMap((row) => row?.warnings ?? []),
        ),
      ];
      for (const warning of flagged.slice(0, 3)) toast.warning(warning);
      if (flagged.length > 3) {
        toast.warning(`…and ${flagged.length - 3} more notes on this batch.`);
      }
      // Not just this board: a handed-off card landed on another one.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-projects"] });
      setText("");
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The import failed.",
      );
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
        disabled={!projectId}
      >
        <ClipboardPaste className="h-3 w-3" />
        Bulk add
      </Button>

      {/*
        Built out of the dialog's own header / panel / footer parts rather than dropped straight
        into the popup.

        DialogPopup is a bare rounded box — every bit of padding in this design system comes from
        those three. Putting a title, a paragraph and a textarea directly inside it produced text
        flush against the border on all four sides, buttons floating with nothing separating them
        from the field, and the close button sitting on top of the second line of the description,
        because nothing had reserved the corner it is absolutely positioned into.
      */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-2xl">
          {/* pe-12 keeps the longest line clear of the close button in the corner. */}
          <DialogHeader className="pe-12">
            <DialogTitle>Bulk add cards</DialogTitle>
            <DialogDescription>
              Paste a JSON array. <Field>title</Field> is the only required
              field. <Field>project</Field>, <Field>labels</Field>,{" "}
              <Field>assigneeEmail</Field> and <Field>assigneeName</Field> are
              matched by name and created if new. <Field>subtasks</Field>{" "}
              become a checklist on the card, and a card assigned to somebody
              else lands on their board.
            </DialogDescription>
          </DialogHeader>

          {/*
            The board's real column slugs, on screen.

            Status is the one field with a fixed vocabulary, it differs per
            board, and there was nowhere to read it — a batch written with
            "todo" against a board whose column is "to-do" was accepted and
            filed out of sight. Showing the accepted values costs one line and
            removes the guess.
          */}
          {statuses.length > 0 && (
            <p className="-mt-1 text-xs text-muted-foreground">
              <span className="font-medium">status</span> on this board:{" "}
              {statuses.map((slug, i) => (
                <span key={slug}>
                  {i > 0 && ", "}
                  <Field>{slug}</Field>
                </span>
              ))}
              . Anything else lands in{" "}
              <Field>{statuses[0]}</Field> and warns.
            </p>
          )}

          <DialogPanel>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              spellCheck={false}
              aria-label="Cards to add, as JSON"
              /*
               * Fixed height and no drag handle. The field lives inside the panel's scroll area,
               * so a resizable box fought it — dragging grew the textarea past the popup and left
               * two scrollbars arguing. Long input scrolls inside the field instead.
               */
              className="h-72 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setText(SAMPLE)}
              disabled={isPending}
            >
              Insert example
            </Button>
            <Button
              type="button"
              onClick={run}
              disabled={isPending || !text.trim()}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add cards
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export default BulkAddTasks;
