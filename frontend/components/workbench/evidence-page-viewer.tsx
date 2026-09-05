"use client";

import { useEffect, useRef, useState } from "react";
import { Highlight } from "@/app/workbench/DocumentFacsimile";

export type ViewerBBox = { x: number; y: number; width: number; height: number };

export function EvidencePageViewer({
  src,
  mimeType,
  page,
  bbox,
}: {
  src: string | null;
  mimeType?: string | null;
  page: number;
  bbox: ViewerBBox | null;
}) {
  if (!src) {
    return (
      <div className="relative mx-auto aspect-[210/297] w-full max-w-[520px] border border-dashed border-stone-300 bg-[#fbfaf6]">
        <p className="p-6 text-[12px] text-stone-500">
          No page file on this document. Upload a PDF or image on the engagement to bind a real
          page.
        </p>
        {bbox ? <Highlight bbox={bbox} /> : null}
      </div>
    );
  }

  if (mimeType?.startsWith("image/")) {
    return (
      <div className="relative mx-auto w-full max-w-[520px] overflow-hidden border border-stone-300 bg-[#fbfaf6]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Evidence page" className="block w-full" />
        {bbox ? <Highlight bbox={bbox} /> : null}
      </div>
    );
  }

  return <PdfCanvas src={src} page={Math.max(1, page)} bbox={bbox} />;
}

function PdfCanvas({
  src,
  page,
  bbox,
}: {
  src: string;
  page: number;
  bbox: ViewerBBox | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      className="relative mx-auto w-full max-w-[520px] overflow-hidden border border-stone-300 bg-[#fbfaf6]"
    >
      {status !== "ready" ? (
        <p className="p-6 text-[12px] text-stone-500">{message}</p>
      ) : null}
      <canvas ref={canvasRef} className="block w-full" />
      {status === "ready" && bbox ? <Highlight bbox={bbox} /> : null}
    </div>
  );
}
