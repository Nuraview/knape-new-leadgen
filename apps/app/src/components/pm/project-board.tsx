import { useCallback, useEffect, useRef, useState } from "react";

// Copied from the cockpit's stylesheet alongside this component. Imported
// here rather than from the route so the two can never be separated.
import "@/styles/pm-board.css";

/**
 * Project Management — Trello-lite kanban (Jul-20 client call).
 *
 * Peter won't use Trello as a separate app, so the board lives in the
 * cockpit. Six fixed columns mirroring his Trello board; cards carry a
 * title, description and a chronological timeline of comments + activity.
 *
 * Drag-and-drop is native HTML5 (no library). While dragging, the cursor's
 * position over a card decides whether the insertion slot shows above or
 * below it; the server recomputes the fractional position from the neighbour
 * ids we send, so concurrent drags can't corrupt the order.
 */

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

type PmCard = {
  id: number;
  column_key: string;
  position: number;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  due_at?: number | null;
  labels?: string[];
  comment_count?: number;
  checklist_total?: number;
  checklist_done?: number;
};

type PmChecklistItem = {
  id: number;
  card_id: number;
  text: string;
  done: boolean;
  position: number;
  created_at: number;
};

type PmEvent = {
  id: number;
  card_id: number;
  kind: "comment" | "created" | "moved" | "updated";
  body: string | null;
  from_column: string | null;
  to_column: string | null;
  field: string | null;
  actor: string | null;
  created_at: number;
};

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "new", label: "New Projects", tone: "new" },
  { key: "in_progress", label: "In Progress", tone: "progress" },
  { key: "ready_for_review", label: "Ready for Review", tone: "review" },
  { key: "revision_requested", label: "Revision Requested", tone: "revision" },
  { key: "approved_cancelled", label: "Approved / Cancelled", tone: "done" },
  { key: "on_hold", label: "On Hold", tone: "hold" },
];

function columnLabel(key: string | null): string {
  return COLUMNS.find((c) => c.key === key)?.label ?? key ?? "?";
}

// Trello's classic label palette, keyed by the names the backend validates.
const LABELS: { key: string; color: string; name: string }[] = [
  { key: "green", color: "#61bd4f", name: "Green" },
  { key: "yellow", color: "#f2d600", name: "Yellow" },
  { key: "orange", color: "#ff9f1a", name: "Orange" },
  { key: "red", color: "#eb5a46", name: "Red" },
  { key: "purple", color: "#c377e0", name: "Purple" },
  { key: "blue", color: "#0079bf", name: "Blue" },
];

function labelColor(key: string): string {
  return LABELS.find((l) => l.key === key)?.color ?? "#94a3b8";
}

/** overdue → red, due within 48h → amber, otherwise neutral. */
function dueState(dueAt: number): "overdue" | "soon" | "normal" {
  const now = Date.now() / 1000;
  if (dueAt < now) return "overdue";
  if (dueAt < now + 48 * 3600) return "soon";
  return "normal";
}

function fmtDue(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** epoch seconds → value for <input type="datetime-local"> in local time. */
function epochToLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relShort(epoch: number): string {
  const s = Math.max(0, Date.now() / 1000 - epoch);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmtWhen(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function actorName(email: string | null): string {
  if (!email) return "Someone";
  return email.split("@")[0];
}

function initials(email: string | null): string {
  const name = actorName(email);
  return name.slice(0, 2).toUpperCase();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Where the dragged card would land if dropped right now. */
type DropHint = { column: string; beforeCardId: number | null };

type ProjectBoardProps = { api: Api };

export function ProjectBoard({ api }: ProjectBoardProps) {
  const [cards, setCards] = useState<PmCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addColumn, setAddColumn] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ cards: PmCard[] }>("/api/pm/cards");
      setCards(res.cards);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const byColumn = (key: string) =>
    cards.filter((c) => c.column_key === key).sort((a, b) => a.position - b.position);

  /** Optimistically apply a move locally, then persist; reload on failure. */
  async function moveCard(cardId: number, toColumn: string, beforeCardId: number | null) {
    const moving = cards.find((c) => c.id === cardId);
    if (!moving) return;
    const dest = byColumn(toColumn).filter((c) => c.id !== cardId);
    const insertAt = beforeCardId === null ? dest.length : dest.findIndex((c) => c.id === beforeCardId);
    const idx = insertAt < 0 ? dest.length : insertAt;
    const after = idx > 0 ? dest[idx - 1] : null;
    const before = idx < dest.length ? dest[idx] : null;

    const afterPos = after?.position ?? null;
    const beforePos = before?.position ?? null;
    const optimistic =
      afterPos !== null && beforePos !== null
        ? (afterPos + beforePos) / 2
        : afterPos !== null
        ? afterPos + 1024
        : beforePos !== null
        ? beforePos - 512
        : 1024;
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column_key: toColumn, position: optimistic } : c))
    );
    try {
      await api(`/api/pm/cards/${cardId}/move`, {
        method: "POST",
        body: JSON.stringify({
          to_column: toColumn,
          after_card_id: after?.id ?? null,
          before_card_id: before?.id ?? null,
        }),
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      void load();
    }
  }

  function clearDrag() {
    dragId.current = null;
    setDraggingId(null);
    setDropHint(null);
  }

  /** dragover on a card: cursor above the midpoint → slot before it, below → slot after it. */
  function hintForCard(e: React.DragEvent, card: PmCard) {
    e.preventDefault();
    e.stopPropagation();
    if (dragId.current === null || dragId.current === card.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    const colCards = byColumn(card.column_key).filter((c) => c.id !== dragId.current);
    const i = colCards.findIndex((c) => c.id === card.id);
    const beforeCardId = below ? (colCards[i + 1]?.id ?? null) : card.id;
    setDropHint({ column: card.column_key, beforeCardId });
  }

  function drop(e: React.DragEvent) {
    e.preventDefault();
    const id = dragId.current;
    const hint = dropHint;
    clearDrag();
    if (id === null || !hint) return;
    void moveCard(id, hint.column, hint.beforeCardId);
  }

  return (
    <section className="pm-board-wrap" aria-label="Project management board">
      <header className="pm-board-head">
        <div>
          <h1 className="pm-board-title">Project Management</h1>
          <p className="pm-board-sub">
            Drag cards between columns — click a card for details, comments and history.
          </p>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="pm-board-loading">Loading board…</p>
      ) : (
        <div className="pm-board" role="list">
          {COLUMNS.map((col) => {
            const colCards = byColumn(col.key);
            const hintHere = dropHint?.column === col.key ? dropHint : null;
            return (
              <div
                key={col.key}
                role="listitem"
                className={`pm-col pm-col--${col.tone}${hintHere ? " pm-col--over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId.current !== null && !hintHere) {
                    setDropHint({ column: col.key, beforeCardId: null });
                  }
                }}
                onDrop={drop}
              >
                <div className="pm-col-head">
                  <span className="pm-col-dot" aria-hidden="true" />
                  <span className="pm-col-label">{col.label}</span>
                  <span className="pm-col-count">{colCards.length}</span>
                </div>
                <div className="pm-col-cards">
                  {colCards.map((card) => (
                    <div key={card.id}>
                      {hintHere?.beforeCardId === card.id ? (
                        <div className="pm-drop-slot" aria-hidden="true" />
                      ) : null}
                      <article
                        className={`pm-card${draggingId === card.id ? " pm-card--dragging" : ""}`}
                        draggable
                        tabIndex={0}
                        onDragStart={(e) => {
                          dragId.current = card.id;
                          setDraggingId(card.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(card.id));
                        }}
                        onDragEnd={clearDrag}
                        onDragOver={(e) => hintForCard(e, card)}
                        onDrop={drop}
                        onClick={() => setOpenCardId(card.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenCardId(card.id);
                          }
                        }}
                      >
                        {(card.labels?.length ?? 0) > 0 ? (
                          <div className="pm-card-labels" aria-hidden="true">
                            {card.labels!.map((l) => (
                              <span key={l} className="pm-card-label" style={{ background: labelColor(l) }} />
                            ))}
                          </div>
                        ) : null}
                        <h3 className="pm-card-title">{card.title}</h3>
                        {card.description ? <p className="pm-card-desc">{card.description}</p> : null}
                        <div className="pm-card-foot">
                          {card.due_at ? (
                            <span className={`pm-chip pm-chip--due-${dueState(card.due_at)}`} title="Due date">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                                <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              {fmtDue(card.due_at)}
                            </span>
                          ) : null}
                          {(card.checklist_total ?? 0) > 0 ? (
                            <span
                              className={`pm-chip${card.checklist_done === card.checklist_total ? " pm-chip--done" : ""}`}
                              title="Checklist"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M9 11l3 3 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              {card.checklist_done}/{card.checklist_total}
                            </span>
                          ) : null}
                          {(card.comment_count ?? 0) > 0 ? (
                            <span className="pm-chip" title="Comments">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                  d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              {card.comment_count}
                            </span>
                          ) : null}
                          <span className="pm-card-when" title={`Updated ${fmtWhen(card.updated_at)}`}>
                            {relShort(card.updated_at)}
                          </span>
                        </div>
                      </article>
                    </div>
                  ))}
                  {hintHere && hintHere.beforeCardId === null ? (
                    <div className="pm-drop-slot" aria-hidden="true" />
                  ) : null}
                </div>
                <button type="button" className="pm-col-add-ghost" onClick={() => setAddColumn(col.key)}>
                  + Add a card
                </button>
              </div>
            );
          })}
        </div>
      )}

      {addColumn ? (
        <NewCardModal
          api={api}
          column={addColumn}
          onClose={() => setAddColumn(null)}
          onCreated={() => {
            setAddColumn(null);
            void load();
          }}
        />
      ) : null}

      {openCardId !== null ? (
        <CardDetailModal
          api={api}
          cardId={openCardId}
          onClose={() => setOpenCardId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </section>
  );
}

function NewCardModal({
  api,
  column,
  onClose,
  onCreated,
}: {
  api: Api;
  column: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/pm/cards", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, column }),
      });
      onCreated();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div
        className="pm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pm-modal-head">
          <h2 className="pm-modal-title">New card</h2>
          <p className="pm-modal-sub">
            in list <strong>{columnLabel(column)}</strong>
          </p>
          <button type="button" className="pm-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <form onSubmit={submit} className="pm-modal-body">
          <label className="pm-field">
            <span className="pm-field-label">Title</span>
            <input
              className="pm-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rebrand my LinkedIn"
              maxLength={255}
              autoFocus
            />
          </label>
          <label className="pm-field">
            <span className="pm-field-label">Description</span>
            <textarea
              className="pm-input pm-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to happen?"
              rows={4}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <footer className="pm-modal-actions">
            <button type="button" className="pm-btn pm-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="pm-btn pm-btn--primary" disabled={busy}>
              {busy ? "Creating…" : "Create card"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function CardDetailModal({
  api,
  cardId,
  onClose,
  onChanged,
}: {
  api: Api;
  cardId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<PmCard | null>(null);
  const [events, setEvents] = useState<PmEvent[]>([]);
  const [checklist, setChecklist] = useState<PmChecklistItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    try {
      const res = await api<{ card: PmCard; events: PmEvent[]; checklist: PmChecklistItem[] }>(
        `/api/pm/cards/${cardId}`
      );
      setCard(res.card);
      setEvents(res.events);
      setChecklist(res.checklist ?? []);
      setTitle(res.card.title);
      setDescription(res.card.description ?? "");
      setError("");
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api, cardId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  /** Immediate PATCH (title / description / labels / due date). */
  async function patchCard(patch: Record<string, unknown>) {
    try {
      await api(`/api/pm/cards/${cardId}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadDetail();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  /** Stage select — server appends at the bottom of the target column. */
  async function changeStage(toColumn: string) {
    try {
      await api(`/api/pm/cards/${cardId}/move`, {
        method: "POST",
        body: JSON.stringify({ to_column: toColumn, after_card_id: null, before_card_id: null }),
      });
      await loadDetail();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function toggleLabel(key: string) {
    if (!card) return;
    const current = card.labels ?? [];
    const next = current.includes(key) ? current.filter((l) => l !== key) : [...current, key];
    void patchCard({ labels: next });
  }

  async function postComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api(`/api/pm/cards/${cardId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment.trim() }),
      });
      setComment("");
      await loadDetail();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function addChecklistItem() {
    if (!newItem.trim()) return;
    try {
      await api(`/api/pm/cards/${cardId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ text: newItem.trim() }),
      });
      setNewItem("");
      await loadDetail();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function toggleChecklistItem(item: PmChecklistItem) {
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      await api(`/api/pm/checklist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
      onChanged();
    } catch (err) {
      setError(errMsg(err));
      await loadDetail();
    }
  }

  async function deleteChecklistItem(itemId: number) {
    try {
      await api(`/api/pm/checklist/${itemId}`, { method: "DELETE" });
      await loadDetail();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function deleteCard() {
    if (!card) return;
    if (!window.confirm(`Delete "${card.title}"? It leaves the board; its history is kept.`)) return;
    setBusy(true);
    try {
      await api(`/api/pm/cards/${cardId}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div
        className="pm-modal pm-modal--detail"
        role="dialog"
        aria-modal="true"
        aria-label="Card details"
        onClick={(e) => e.stopPropagation()}
      >
        {!card ? (
          <p className="pm-board-loading">Loading…</p>
        ) : (
          <>
            <header className="pm-modal-head">
              <input
                className="pm-title-input"
                value={title}
                maxLength={255}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  const t = title.trim();
                  if (t && t !== card.title) void patchCard({ title: t });
                  else setTitle(card.title);
                }}
              />
              <button type="button" className="pm-modal-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </header>

            <div className="pm-modal-body">
              <div className="pm-stage-row">
                <label htmlFor="pm-stage" className="pm-section-head pm-section-head--inline">
                  Stage
                </label>
                <select
                  id="pm-stage"
                  className="pm-input pm-stage-select"
                  value={card.column_key}
                  onChange={(e) => void changeStage(e.target.value)}
                >
                  {COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="pm-created-at">Created {fmtWhen(card.created_at)}</span>
              </div>

              <div className="pm-meta-row">
                <div className="pm-meta-block">
                  <h3 className="pm-section-head">Labels</h3>
                  <div className="pm-label-picker">
                    {LABELS.map((l) => {
                      const active = (card.labels ?? []).includes(l.key);
                      return (
                        <button
                          key={l.key}
                          type="button"
                          className={`pm-label-swatch${active ? " pm-label-swatch--on" : ""}`}
                          style={{ background: l.color }}
                          title={l.name}
                          aria-pressed={active}
                          onClick={() => toggleLabel(l.key)}
                        >
                          {active ? "✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="pm-meta-block">
                  <h3 className="pm-section-head">Due date</h3>
                  <div className="pm-due-row">
                    <input
                      type="datetime-local"
                      className="pm-input pm-input--due"
                      value={card.due_at ? epochToLocalInput(card.due_at) : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        void patchCard({ due_at: v ? new Date(v).getTime() / 1000 : null });
                      }}
                    />
                    {card.due_at ? (
                      <button
                        type="button"
                        className="pm-btn pm-btn--ghost"
                        onClick={() => void patchCard({ due_at: null })}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <h3 className="pm-section-head">Description</h3>
              <textarea
                className="pm-input pm-textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                onBlur={() => {
                  if (description !== (card.description ?? "")) {
                    void patchCard({ description });
                  }
                }}
              />

              <div className="pm-check-head">
                <h3 className="pm-section-head pm-section-head--inline">Checklist</h3>
                {checklist.length > 0 ? (
                  <span className="pm-check-count">
                    {doneCount}/{checklist.length}
                  </span>
                ) : null}
              </div>
              {checklist.length > 0 ? (
                <div className="pm-check-progress-track" aria-hidden="true">
                  <div
                    className="pm-check-progress-fill"
                    style={{ width: `${(doneCount / checklist.length) * 100}%` }}
                  />
                </div>
              ) : null}
              <ul className="pm-checklist">
                {checklist.map((item) => (
                  <li key={item.id} className="pm-check-item">
                    <label className={`pm-check-label${item.done ? " pm-check-label--done" : ""}`}>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => void toggleChecklistItem(item)}
                      />
                      <span>{item.text}</span>
                    </label>
                    <button
                      type="button"
                      className="pm-check-delete"
                      aria-label={`Delete "${item.text}"`}
                      onClick={() => void deleteChecklistItem(item.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="pm-check-add">
                <input
                  className="pm-input"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Add a checklist item…"
                  maxLength={500}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addChecklistItem();
                    }
                  }}
                />
                <button
                  type="button"
                  className="pm-btn pm-btn--ghost"
                  onClick={() => void addChecklistItem()}
                  disabled={!newItem.trim()}
                >
                  Add
                </button>
              </div>

              <h3 className="pm-section-head">Activity</h3>
              <ol className="pm-timeline">
                {events.length === 0 ? <li className="pm-timeline-empty">No activity yet.</li> : null}
                {events.map((ev) =>
                  ev.kind === "comment" ? (
                    <li key={ev.id} className="pm-tl-item">
                      <span className="pm-tl-dot pm-tl-dot--comment" aria-hidden="true" />
                      <div className="pm-tl-body">
                        <div className="pm-tl-meta">
                          <strong>{actorName(ev.actor)}</strong>
                          <span className="pm-tl-when">{fmtWhen(ev.created_at)}</span>
                        </div>
                        <p className="pm-tl-text">{ev.body}</p>
                      </div>
                    </li>
                  ) : (
                    <li key={ev.id} className="pm-tl-item pm-tl-item--event">
                      <span className="pm-tl-dot" aria-hidden="true" />
                      <div className="pm-tl-body">
                        <p className="pm-tl-event">
                          <strong>{actorName(ev.actor)}</strong>{" "}
                          {ev.kind === "moved" ? (
                            <>
                              moved this card from <strong>{columnLabel(ev.from_column)}</strong> to{" "}
                              <strong>{columnLabel(ev.to_column)}</strong>
                            </>
                          ) : ev.kind === "created" ? (
                            <>
                              added this card to <strong>{columnLabel(ev.to_column)}</strong>
                            </>
                          ) : (
                            <>updated the {ev.field ?? "card"}</>
                          )}
                          <span className="pm-tl-when"> · {fmtWhen(ev.created_at)}</span>
                        </p>
                      </div>
                    </li>
                  )
                )}
              </ol>

              <div className="pm-comment-row">
                <input
                  className="pm-input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void postComment();
                    }
                  }}
                />
                <button
                  type="button"
                  className="pm-btn pm-btn--primary"
                  onClick={() => void postComment()}
                  disabled={busy || !comment.trim()}
                >
                  Comment
                </button>
              </div>

              {error ? <p className="error">{error}</p> : null}

              <div className="pm-modal-foot">
                <button
                  type="button"
                  className="pm-btn pm-btn--ghost pm-btn--danger-text"
                  onClick={() => void deleteCard()}
                  disabled={busy}
                >
                  Delete card
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
