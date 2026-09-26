"use client";

// The "Delete" link on a document card.
//
// Two-step, inline — no browser confirm() popup. First click swaps the link for a
// sentence spelling out what will be lost, with [Delete] [Cancel]. Only the second
// click actually calls the API. On success, router.refresh() re-renders the list
// from the server and the card is simply gone.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDocumentButtonProps {
  documentId: string;
  lineCount: number;
}

export function DeleteDocumentButton({ documentId, lineCount }: DeleteDocumentButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't delete this invoice.");
      }
      router.refresh();
      // No setBusy(false) on success — the card is about to disappear, and flicking
      // the buttons back to enabled in the meantime would invite a double-click.
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
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
