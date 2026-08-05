import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The creatives strip: click to browse or drop files on it, since a creative
 * usually arrives as a file already sitting on someone's desktop.
 */
export function Creatives({
  items,
  onFiles,
  onRemove,
  busy,
  hint,
}: {
  items: { id: string; kind: string; url: string; fileName: string }[];
  onFiles: (files: File[]) => void;
  onRemove?: (id: string) => void;
  busy?: boolean;
  hint?: string;
}) {
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border border-dashed p-3.5 transition-colors",
        over && "border-primary bg-primary/5",
      )}
      onDragOver={(e) => {
        // Only react to a real file drag, not a post chip being moved.
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(false);
        const picked = Array.from(e.dataTransfer.files).filter(
          (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
        );
        if (picked.length) onFiles(picked);
      }}
    >
      <div className="flex items-center gap-2.5">
        <h3 className="m-0 font-semibold text-[12px] text-muted-foreground uppercase tracking-[0.07em]">
          Creatives
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto h-7 text-[12px]"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Uploading…" : "Add image or video"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="m-0 text-[12.5px] text-muted-foreground">
          Nothing attached yet.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
          {items.map((m) => (
            <figure
              key={m.id}
              className="m-0 overflow-hidden rounded-md border border-border bg-muted/40"
            >
              {m.kind === "video" ? (
                // biome-ignore lint/a11y/useMediaCaption: a creative preview, not content
                <video
                  src={m.url}
                  controls
                  preload="metadata"
                  className="block h-[108px] w-full bg-black object-cover"
                />
              ) : (
                <img
                  src={m.url}
                  alt={m.fileName}
                  loading="lazy"
                  className="block h-[108px] w-full object-cover"
                />
              )}
              <figcaption className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] text-muted-foreground">
                <span className="flex-1 truncate">{m.fileName}</span>
                {onRemove ? (
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-rose-500"
                    aria-label={`Remove ${m.fileName}`}
                    onClick={() => onRemove(m.id)}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <p className="m-0 text-[11px] text-muted-foreground/80">
        {hint ?? "Drop files here, or use the button."}
      </p>
    </div>
  );
}
