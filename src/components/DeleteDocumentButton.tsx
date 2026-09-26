"use client";

// The "Delete" link on a document card.
//
// Two-step, inline — no browser confirm() popup. First click swaps the link for a
// sentence spelling out what will be lost, with [Delete] [Cancel]. Only the second
// click actually calls the API. On success, onDeleted() hides the card straight away,
// then router.refresh() re-syncs the list (and counts) from the server.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDocumentButtonProps {
  documentId: string;
  lineCount: number;
  onDeleted: () => void;
}

// If the dev server / API hangs, don't leave the chef staring at "Deleting…" forever.
const TIMEOUT_MS = 15_000;

export function DeleteDocumentButton({ documentId, lineCount, onDeleted }: DeleteDocumentButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't delete this invoice.");
      }
      // Hide first, refresh second — the refresh can take a moment and the chef
      // shouldn't see a card they've just deleted sitting there in the meantime.
      // No setBusy(false): this component is about to unmount.
      onDeleted();
      router.refresh();
    } catch (err) {
      // On a timeout we genuinely don't know — the server may have finished the
      // delete after we stopped waiting — so tell the chef to refresh and check.
      setError(
        (err as Error).name === "AbortError"
          ? "No response from the server — it may not have been deleted. Refresh the page to check, then try again if it's still there."
          : (err as Error).message,
      );
      setBusy(false);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-neutral-400 hover:text-red-600"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <p className="max-w-[16rem] text-xs text-neutral-700">
        Delete this invoice and its {lineCount} {lineCount === 1 ? "line" : "lines"}? This
        can&apos;t be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <span className="max-w-[16rem] text-xs text-red-600">{error}</span>}
    </div>
  );
}
