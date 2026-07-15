"use client";

// The "Read this invoice" trigger on a document card.
//
// Only shown for documents the machine hasn't successfully read yet
// (processing_status 'uploaded' or 'failed'). Calls the extraction route, then
// refreshes the server components so the card's health badge and line counts update.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessingStatus } from "@/types/database";

interface ExtractButtonProps {
  documentId: string;
  processingStatus: ProcessingStatus;
}

export function ExtractButton({ documentId, processingStatus }: ExtractButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to do if the machine is mid-read or already done.
  if (processingStatus === "extracting" || processingStatus === "extracted") {
    return null;
  }

  async function extract() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/extract`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Extraction failed.");
      }
      router.refresh(); // re-render the card with its new status + counts
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // 'failed' gets a retry affordance; 'uploaded' gets the first-run one.
  const label = busy
    ? "Reading…"
    : processingStatus === "failed"
      ? "Try reading again"
      : "Read invoice";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={extract}
        disabled={busy}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {label}
      </button>
      {error && <span className="max-w-[16rem] text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
