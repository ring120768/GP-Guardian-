-- GP Guardian — Line order
--
-- The review screen should list lines in the same order as the paper invoice, so the
-- chef can run a finger down both at once. Until now we relied on Postgres returning
-- rows in insert order, which it usually does but never promises.
--
-- line_no = the line's position on the invoice (1, 2, 3…), set by extraction.
-- Nullable: rows extracted before this migration have none, and the app falls back to
-- created_at, then id, for those. Additive only — no data is rewritten.
alter table invoice_lines
  add column line_no integer;
