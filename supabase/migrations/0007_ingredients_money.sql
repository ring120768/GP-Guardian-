-- GP Guardian — Ingredients & the agreed money rules (see CLAUDE.md "Money rules")
--
-- Additive only — no data is rewritten. Apply with the others.

-- ─────────────────────────────────────────────
-- venues — VAT and the flat waste allowance
-- ─────────────────────────────────────────────
alter table venues
  -- Menu prices INCLUDE VAT; GP is worked out on the net price. 20 = UK standard rate.
  add column vat_rate numeric not null default 20,
  -- Everyday prep/spoilage waste, as a % of NET selling price, taken off GP.
  -- 4 ≈ the WRAP hospitality baseline (~3.6% of sales), rounded up to be safe.
  add column waste_allowance_pct numeric not null default 4;

-- ─────────────────────────────────────────────
-- ingredients — yield and kind
-- ─────────────────────────────────────────────
alter table ingredients
  -- % of what you buy that ends up usable. 100 = off (the default for almost
  -- everything). Only for in-house butchery/filleting: a whole salmon at 60% yield
  -- makes every usable gram cost 1/0.6 of the invoice price per gram.
  -- Never 0 — you'd be dividing by it.
  add column yield_percent numeric not null default 100
    check (yield_percent between 1 and 100),
  --   food        → costed normally
  --   non_food    → blue roll, cling film, cleaning. Tracked for price, never in recipes.
  --   by_product  → trim / bones from in-house butchery. Costed at £0 so the parent cut
  --                 carries the full cost (conservative).
  add column kind text not null default 'food'
    check (kind in ('food', 'non_food', 'by_product'));

-- NOTE: recipe_lines.waste_percentage is DEPRECATED — superseded by
-- venues.waste_allowance_pct and ingredients.yield_percent. Left in place (dropping a
-- column is a separate, deliberate decision); costing ignores it.
