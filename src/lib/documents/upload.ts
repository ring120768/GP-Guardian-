// Document upload — photo and PDF, both first-class (design doc principle #5).
//
// The flow is deliberately two-step and fails loudly rather than quietly:
//
//   1. Put the file in the private `documents` Storage bucket.
//   2. Insert the `documents` row pointing at it, processing_status = 'uploaded'.
//
// If step 2 fails we delete the orphaned file from step 1, so we never end up with
// storage objects no row knows about. If step 1 fails we never create a row — so we
// never end up with a row whose file doesn't exist. A document either fully exists
// or doesn't; there is no half-uploaded state for the chef to trip over.
//
// Extraction is NOT triggered here. Upload and extraction are separate lifecycles
// (that's the whole point of processing_status) — the next slice adds the AI call.

import { createClient } from "@/lib/supabase/client";
import type { DocumentType, SourceFormat, DocumentRow } from "@/types/database";

export const STORAGE_BUCKET = "documents";

/** 20 MB. A phone photo of an invoice is 3–8MB; a multi-page supplier PDF fits easily. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * What the Anthropic vision API can actually read, plus PDF.
 *
 * HEIC/HEIF is deliberately ABSENT. iPhones shoot HEIC by default — Safari normally
 * transcodes to JPEG when you pick a file, but a file dragged off a Mac can still be
 * raw .heic, and Anthropic's vision API will not accept it. Rejecting it here, at the
 * input, with a clear message beats accepting it and failing mysteriously at
 * extraction three steps later. Same instinct as "never guess on money": if we can't
 * handle it, say so immediately rather than pretending.
 */
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Fed to <input accept="..."> so the OS file picker greys out what we can't read. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");

export interface ValidationError {
  file: string;
  reason: string;
}

/**
 * Checks a file BEFORE any network call. Returns null if it's fine, or a
 * chef-readable reason if it isn't — no error codes, no MIME types in the message.
 */
export function validateFile(file: File): ValidationError | null {
  if (file.size === 0) {
    return { file: file.name, reason: "This file is empty." };
  }

  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      file: file.name,
      reason: `Too large (${mb}MB). The limit is 20MB — try a lower-resolution photo.`,
    };
  }

  // HEIC gets its own message, because it's the single most likely rejection a chef
  // will hit and "unsupported file type" would be a useless thing to tell them.
  if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)) {
    return {
      file: file.name,
      reason:
        "iPhone HEIC photos can't be read yet. In Settings → Camera → Formats, " +
        "choose 'Most Compatible' — or re-save this image as a JPEG.",
    };
  }

  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return {
      file: file.name,
      reason: "Not a supported file. Upload a JPEG, PNG, WebP photo or a PDF.",
    };
  }

  return null;
}

/**
 * `source_format` is 'photo' | 'pdf' — it drives the extraction route later
 * (design doc §5: PDFs try their text layer first, photos go straight to vision).
 * Everything that isn't a PDF is, for our purposes, a photo.
 */
export function deriveSourceFormat(file: File): SourceFormat {
  return file.type === "application/pdf" ? "pdf" : "photo";
}

/**
 * Storage path: `{venue_id}/{document_type}/{random}.{ext}`
 *
 * venue_id leads so that when multi-tenancy arrives, the Storage RLS policy is a
 * one-liner against the first path segment — no data migration needed. The filename
 * is randomised rather than reusing the chef's ("IMG_4821.jpg", "scan.pdf") because
 * those collide constantly and could otherwise overwrite a previous invoice.
 */
function buildStoragePath(venueId: string, documentType: DocumentType, file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const unique = crypto.randomUUID();
  return `${venueId}/${documentType}/${unique}.${extension}`;
}

export interface UploadResult {
  document: DocumentRow;
}

/**
 * Uploads one file and creates its `documents` row.
 *
 * Throws on failure — the caller is responsible for surfacing the message. We throw
 * rather than returning a null/partial document because a half-made document is
 * exactly the kind of thing that silently rots in a review queue.
 */
export async function uploadDocument(
  file: File,
  venueId: string,
  documentType: DocumentType
): Promise<UploadResult> {
  const supabase = createClient();

  const invalid = validateFile(file);
  if (invalid) throw new Error(invalid.reason);

  const path = buildStoragePath(venueId, documentType, file);

  // ── Step 1: file into Storage ──────────────────────────────
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false, // path is a fresh UUID, so a collision means something is badly wrong
    });

  if (storageError) {
    throw new Error(`Couldn't upload ${file.name}: ${storageError.message}`);
  }

  // ── Step 2: row into Postgres ──────────────────────────────
  const { data, error: dbError } = await supabase
    .from("documents")
    .insert({
      venue_id: venueId,
      document_type: documentType,
      file_url: path,
      source_format: deriveSourceFormat(file),
      processing_status: "uploaded", // extraction hasn't run — say so honestly
      review_status: "pending",
    })
    .select()
    .single();

  if (dbError || !data) {
    // Roll back step 1 so we don't leave an orphaned file in the bucket that no
    // row points at. Best-effort: if this cleanup itself fails there's nothing
    // useful left to do, and the original error is the one worth reporting.
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    throw new Error(`Couldn't save ${file.name}: ${dbError?.message ?? "unknown error"}`);
  }

  return { document: data as DocumentRow };
}

/**
 * Mints a short-lived signed URL so the chef can see the original document
 * (needed for the side-by-side review screen in the next slice).
 *
 * The bucket is private, so there is no permanent URL by design — supplier invoices
 * carry pricing that shouldn't be a public link someone can forward.
 */
export async function getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new Error(`Couldn't open that document: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
