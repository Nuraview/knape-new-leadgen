import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Pin the worker to react-pdf's bundled pdfjs version (avoids version-mismatch
// crashes). CDN keeps the bundle lean.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function PdfViewer({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
        <span className="truncate">{title}</span>
        <div className="flex items-center gap-3">
          <button onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(0.6, s - 0.2)); }} className="px-2">−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(2.5, s + 0.2)); }} className="px-2">+</button>
          <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="underline">Open ↗</a>
          <button onClick={onClose} className="rounded bg-white/15 px-3 py-1">Close</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex justify-center py-4" onClick={(e) => e.stopPropagation()}>
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<div className="text-white/70 mt-10">Loading…</div>}
          error={<div className="text-white/70 mt-10">Couldn&apos;t load this file. <a className="underline" href={url} target="_blank" rel="noreferrer">Open directly</a>.</div>}
        >
          <Page pageNumber={page} scale={scale} renderTextLayer={false} />
        </Document>
      </div>

      {numPages > 1 && (
        <div className="flex items-center justify-center gap-4 py-3 text-white text-sm" onClick={(e) => e.stopPropagation()}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded bg-white/15 px-3 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {numPages}</span>
          <button disabled={page >= numPages} onClick={() => setPage((p) => p + 1)} className="rounded bg-white/15 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
