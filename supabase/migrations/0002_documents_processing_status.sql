-- GP Guardian — Document processing status + Storage bucket
--
-- Two changes, both needed before upload can work honestly:
--
-- 1. `documents.review_status` tracks the HUMAN (pending → in_review → confirmed).
--    There was nothing tracking the MACHINE. So a document whose AI extraction
--    silently failed looked identical to one simply waiting in the review queue —
--    the UI would present an unknown as a known. That breaks the project's first
--    principle ("never guess on money").
--
--    This is the same split the design doc already makes in §6 between
--    Extraction % (machine's read quality) and Verified % (human progress).
--    The status column just never got the same treatment. Now it does.
--
-- 2. A private Storage bucket to actually hold the uploaded photos/PDFs.
--    `documents.file_url` stores the *path within the bucket*, not a public URL —
--    supplier invoices are commercial data and must not be world-readable.
--    The app mints short-lived signed URLs on demand instead.

-- ─────────────────────────────────────────────
-- 1. Machine-side status
-- ─────────────────────────────────────────────
alter table documents
  add column processing_status text not null
    default 'uploaded'
    check (processing_status in (
      'uploaded',    -- file is in Storage; extraction has not started
      'extracting',  -- AI call is in flight
      'extracted',   -- lines written to invoice_lines / recipe_lines; ready for a human
      'failed'       -- extraction errored — see extraction_error. NOT the same as "empty".
    )),
  -- Human-readable reason the extraction failed, shown directly to the chef so a
  -- failure is actionable ("image too blurry to read") rather than a silent nothing.
  add column extraction_error text;

-- The review queue and the "needs attention" queue are different questions.
-- Index the machine status so "show me everything that failed or is still waiting"
-- stays fast as documents pile up.
create index idx_documents_processing_status
  on documents (venue_id, processing_status);

-- Guard rail: a document can't be marked human-confirmed if the machine never
-- successfully read it. Prevents a failed extraction being waved through as "done".
alter table documents
  add constraint chk_confirmed_requires_extraction
  check (review_status <> 'confirmed' or processing_status = 'extracted');

-- ─────────────────────────────────────────────
-- 2. Private Storage bucket for uploaded documents
-- ─────────────────────────────────────────────
-- `public = false` → no anonymous access. Reads go through signed URLs.
-- 20MB ceiling: comfortably fits a phone photo of an invoice (3–8MB typical) and a
-- multi-page supplier PDF, while stopping an accidental 200MB video upload.
--
-- NOTE ON HEIC: iPhones shoot HEIC by default. Safari usually transcodes to JPEG on
-- upload, but a file dragged straight off a Mac can still be .heic — and the Anthropic
-- vision API does NOT accept HEIC. It's allowed here at the storage layer, but the app
-- rejects it at the input with a clear message. Better to refuse the file up front than
-- to accept it and fail mysteriously at extraction time three steps later.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520, -- 20 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

-- Storage policies — same MVP posture as the table RLS in 0001: any authenticated
-- user, because there is exactly one venue and one user. Tighten to per-venue when
-- multi-tenancy arrives (paths are already prefixed with venue_id, so the future
-- policy is a `(storage.foldername(name))[1] = <user's venue>` check).
create policy "authenticated upload documents"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.role() = 'authenticated');

create policy "authenticated read documents"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

create policy "authenticated delete documents"
  on storage.objects for delete
  using (bucket_id = 'documents' and auth.role() = 'authenticated');
