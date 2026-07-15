"use client";

// Multi-file, mixed photo+PDF uploader.
//
// Built multi-file from the start because the design doc's core setup story (§5) is a
// chef backfilling a month of invoices in one go — a single-file uploader would be
// thrown away immediately. Each file tracks its own status so one bad photo in a batch
// of twelve fails on its own line and never blocks the other eleven (same "don't let
// one bad line fail the whole document" instinct as §6, applied at the file level).

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadDocument,
  validateFile,
  ACCEPT_ATTRIBUTE,
  deriveSourceFormat,
} from "@/lib/documents/upload";
import type { DocumentType } from "@/types/database";

type ItemStatus = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  message?: string; // error reason, or a short success note
}

interface DocumentUploaderProps {
  venueId: string;
  /** What kind of document this uploader creates. Invoices first; recipes/menus reuse it later. */
  documentType?: DocumentType;
}

export function DocumentUploader({
  venueId,
  documentType = "invoice",
}: DocumentUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Add dropped/picked files to the queue, rejecting invalid ones up front (before
  // any network call) so the chef sees "iPhone HEIC photos can't be read yet" the
  // instant they pick the file, not after a pointless round-trip.
  const enqueue = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map<QueueItem>((file) => {
      const invalid = validateFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        status: invalid ? "error" : "queued",
        message: invalid?.reason,
      };
    });
    setItems((prev) => [...prev, ...incoming]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files);
    },
    [enqueue]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Upload every queued item. Sequential rather than parallel: a chef on kitchen wifi
  // uploading a phone photo at a time is gentler on a flaky connection than firing ten
  // at once, and the per-file progress reads more clearly. Errors are captured per item.
  const uploadAll = useCallback(async () => {
    setIsUploading(true);
    let anySucceeded = false;

    for (const item of items) {
      if (item.status !== "queued") continue;

      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it))
      );

      try {
        await uploadDocument(item.file, venueId, documentType);
        anySucceeded = true;
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "done", message: `Uploaded as ${deriveSourceFormat(item.file)}` }
              : it
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "error", message: (err as Error).message }
              : it
          )
        );
      }
    }

    setIsUploading(false);
    // Refresh server components (the document list below) so new uploads appear
    // without a full page reload.
    if (anySucceeded) router.refresh();
  }, [items, venueId, documentType, router]);

  const queuedCount = items.filter((it) => it.status === "queued").length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? "border-blue-400 bg-blue-50"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) enqueue(e.target.files);
            e.target.value = ""; // let the same file be re-picked after a removal
          }}
        />
        <p className="text-sm font-medium text-neutral-700">
          Drop invoice photos or PDFs here, or click to choose
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          JPEG, PNG, WebP or PDF · up to 20MB each · add as many as you like
        </p>
      </div>

      {/* Queue */}
      {items.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-neutral-800">{item.file.name}</p>
                {item.message && (
                  <p
                    className={`truncate text-xs ${
                      item.status === "error" ? "text-red-600" : "text-neutral-500"
                    }`}
                  >
                    {item.message}
                  </p>
                )}
              </div>
              {(item.status === "queued" || item.status === "error") && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-neutral-400 hover:text-neutral-700"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Action */}
      {queuedCount > 0 && (
        <button
          type="button"
          onClick={uploadAll}
          disabled={isUploading}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isUploading
            ? "Uploading…"
            : `Upload ${queuedCount} ${queuedCount === 1 ? "document" : "documents"}`}
        </button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ItemStatus }) {
  const styles: Record<ItemStatus, string> = {
    queued: "bg-neutral-300",
    uploading: "bg-blue-400 animate-pulse",
    done: "bg-emerald-500",
    error: "bg-red-500",
  };
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles[status]}`} aria-hidden />;
}
