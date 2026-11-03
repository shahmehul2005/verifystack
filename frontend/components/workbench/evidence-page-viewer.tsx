"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Highlight } from "./document-facsimile";

export type ViewerBBox = { x: number; y: number; width: number; height: number };

export function EvidencePageViewer({
  src,
  mimeType,
  page,
  bbox,
  overlay,
  onPages,
}: {
  src: string | null;
  mimeType?: string | null;
  page: number;
  bbox: ViewerBBox | null;
  /** Drawn over the page, filling it. Used to draw a region on the page. */
  overlay?: ReactNode;
  /** Called with the page count once a PDF has loaded. */
  onPages?: (pages: number) => void;
}) {
  if (!src) {
    return (
      <div className="relative mx-auto aspect-[210/297] w-full max-w-[520px] rounded-md border border-dashed border-mist-300 bg-white">
        <p className="p-6 text-[13px] leading-relaxed text-mist-500">
          No page file on this document. Upload a PDF or image on the engagement to bind a real
          page.
        </p>
        {bbox ? <Highlight bbox={bbox} /> : null}
      </div>
    );
  }

  if (mimeType?.startsWith("image/")) {
    return (
      <div className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-md border border-mist-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Evidence page" className="block w-full" />
        {bbox ? <Highlight bbox={bbox} /> : null}
        {overlay}
      </div>
    );
  }

  return <PdfCanvas src={src} page={Math.max(1, page)} bbox={bbox} overlay={overlay} onPages={onPages} />;
}

function PdfCanvas({
  src,
  page,
  bbox,
  overlay,
  onPages,
}: {
  src: string;
  page: number;
  bbox: ViewerBBox | null;
  overlay?: ReactNode;
  onPages?: (pages: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPagesRef = useRef(onPages);
  useEffect(() => {
    onPagesRef.current = onPages;
  }, [onPages]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Rendering page…");

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;

    async function draw() {
      setStatus("loading");
      setMessage("Rendering page…");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      const loading = pdfjs.getDocument({ url: src, withCredentials: true });
      const pdf = await loading.promise;
      destroy = () => {
        void pdf.destroy();
      };
      if (cancelled) return;
      onPagesRef.current?.(pdf.numPages);

      const pageNumber = Math.min(page, pdf.numPages);
      const pdfPage = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const cssWidth = wrap.clientWidth || 520;
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const scale = cssWidth / unscaled.width;
      const viewport = pdfPage.getViewport({ scale });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.height = "auto";

      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      if (!cancelled) setStatus("ready");
    }

    draw().catch((err: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not render PDF");
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src, page]);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-md border border-mist-200 bg-white shadow-sm"
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2.5 p-6 text-[13px] text-mist-500">
          <span className="size-4 animate-spin rounded-full border-2 border-mist-200 border-t-teal-600" />
          {message}
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="p-6 text-[13px] text-red-700">
          Could not render this page: {message}
        </p>
      ) : null}
      <canvas ref={canvasRef} className="block w-full" />
      {status === "ready" && bbox ? <Highlight bbox={bbox} /> : null}
      {status === "ready" ? overlay : null}
    </div>
  );
}
