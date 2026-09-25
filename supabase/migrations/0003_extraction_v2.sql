-- GP Guardian — Extraction schema v2
--
-- Everything here came out of testing extraction against five real-shaped fixture
-- invoices. Prices were correct on four of the five; these are the gaps that testing
-- exposed. Apply with the others (this migration is additive — no data is rewritten).
--
-- ─────────────────────────────────────────────
-- 1. invoice_lines — price basis, quantity, status note
-- ─────────────────────────────────────────────
alter table invoice_lines
  -- WHAT THE PRICE IS PER. Two lines that look nearly identical on paper:
  --
  --   PORK BELLY   £7.95   kg   3.42   → £7.95 PER KG, 3.42kg delivered → £27.19
  --   BEEF MINCE   £38.75  kg   5      → £38.75 for the whole 5kg PACK  → £38.75
  --
  -- Without this column the costing layer has to guess which is which, and that guess
  -- is a 3-5x error on a food cost. Nullable on purpose: if the invoice layout genuinely
  -- doesn't say, we record an honest gap rather than a plausible-looking wrong basis.
  add column price_basis text
    check (price_basis in ('per_pack', 'per_kg', 'per_litre', 'per_unit')),

  -- HOW MANY WERE ORDERED — the "2" in "2 x chicken @ £16.80 = £33.60". Without it the
  -- line total doesn't reconcile and we can't tell one case from a dozen.
  --   numeric, not integer → some products are ordered by weight or part-cases
  --   negative             → a credit / returned goods
  --   0                    → short-delivered or not delivered (see status_note)
  --   null                 → not printed on the invoice
  add column qty_ordered numeric,

  -- The supplier's own label against the line — 'SHORT', 'NOT DELIVERED', 'CREDIT'.
  -- These used to get swept into product_name_raw, which quietly broke ingredient
  -- matching ("CHICKEN SUPREME SHORT" matches no ingredient we have). Kept separate so
  -- the product name stays clean and the note stays visible in review.
  -- Also carries our own repair notes, e.g. `pack count "2.84" isn't a whole number`,
  -- so a field we had to null doesn't look identical to one the invoice never printed.
  add column status_note text;

-- ─────────────────────────────────────────────
-- 2. documents — invoice-level charges
-- ─────────────────────────────────────────────
-- Delivery and surcharges are real money and belong in the invoice total, but they are
-- NOT ingredients. Costed as product lines they'd turn up as an unmatchable "DELIVERY"
-- in the chef's review queue every single week. So they live on the document.
alter table documents
  add column delivery_charge numeric,
  -- Fuel surcharge, small-order fee, crate deposit… as [{ "label": ..., "amount": ... }].
  -- jsonb (not a child table) because nothing joins to these or aggregates them yet —
  -- they're read back with the document and shown. Promote to a table if that changes.
  add column other_charges jsonb not null default '[]'::jsonb;
