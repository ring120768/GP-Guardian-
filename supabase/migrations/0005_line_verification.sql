-- GP Guardian — Line verification (design doc §6, non-negotiable #2: AI extracts,
-- human confirms)
--
-- Additive only. Apply with the others — no data is rewritten.
alter table invoice_lines
  -- When the chef confirmed this line. NULL = not confirmed yet.
  -- A timestamp rather than a boolean: it answers "when did we start trusting this
  -- price?" for free, and editing a line sets it back to NULL (edit = un-confirm).
  add column verified_at timestamptz,

  -- The AI's original values, snapshotted the FIRST time the chef edits the line
  -- (and never overwritten after that). NULL = never edited, i.e. the AI got it right
  -- or nobody's looked yet. Comparing this to the final values later tells us how
  -- accurate extraction really is — per field, per supplier, per photo vs PDF.
  add column ai_original jsonb;
