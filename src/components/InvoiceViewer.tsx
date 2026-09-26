"use client";

// The original invoice on the left of the review screen.
//
//   Photo → shown fitted to the column. Click it to open full-screen, with − / + zoom.
//           Close by clicking anywhere or pressing Esc.
//   PDF   → the browser's own PDF viewer in an iframe (it already has zoom), plus an
//           "Open full size" link to the same signed URL in a new tab.
//
// Zoomed-in images scroll inside the overlay, so a phone photo of a long invoice can be
// read line by line.

import { useEffect, useState } from "react";

const ZOOM_STEPS = [1, 1.5, 2, 3];

export function InvoiceViewer({ url, isPdf }: { url: string; isPdf: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const zoom = ZOOM_STEPS[step];

  // Esc closes the overlay. Only listening while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (isPdf) {
    return (
      <div className="flex h-full flex-col gap-2">
        <iframe
          src={url}
          title="Original invoice"
          className="h-[80vh] w-full flex-1 rounded-lg border border-neutral-200 lg:h-auto"
        />
        {/* noopener: the new tab can't reach back into this page. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-neutral-600 hover:underline"
        >
          Open full size ↗
        </a>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        className="block h-full w-full cursor-zoom-in"
        aria-label="Open the invoice full screen"
      >
        {/* Plain <img>, not next/image: a signed URL changes every visit and expires,
            so there's nothing for Next's image optimiser to cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Original invoice"
          className="max-h-full w-full rounded-lg border border-neutral-200 object-contain"
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Invoice, full screen"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-auto bg-black/85"
        >
          {/* Zoom controls. stopPropagation so clicking them doesn't close the overlay. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed right-4 top-4 z-10 flex items-center gap-1 rounded-md bg-white/95 p-1 text-sm shadow"
          >
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="rounded px-2.5 py-1 font-medium hover:bg-neutral-100 disabled:opacity-40"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1))}
              disabled={step === ZOOM_STEPS.length - 1}
              className="rounded px-2.5 py-1 font-medium hover:bg-neutral-100 disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-1 rounded px-2.5 py-1 hover:bg-neutral-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* At 100% the image fits the screen; above that it's wider than the screen
              and the overlay scrolls. min-h-full + flex centres it when it's smaller. */}
          <div className="flex min-h-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Original invoice, full screen"
              className={zoom === 1 ? "max-h-[92vh] max-w-full" : "max-w-none"}
              style={zoom === 1 ? undefined : { width: `${zoom * 90}vw` }}
            />
          </div>
        </div>
      )}
    </>
  );
}
