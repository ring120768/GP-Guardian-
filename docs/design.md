# GP Guardian — Ingredient Matching & Unit Conversion (v1 Design)

This is the foundational layer everything else (GP calc, alerts, specials) depends on. Get this right first.

---

## 1. Data Model

```
ingredients
  id
  venue_id
  canonical_name        -- "Chicken Supreme"
  default_unit          -- 'g' | 'ml' | 'unit'
  active

ingredient_aliases
  id
  venue_id
  ingredient_id
  raw_text               -- "CHIX SUP 150-175G", "Chicken Supreme 5x1kg"
  supplier_id nullable    -- alias can be supplier-specific
  match_type              -- 'exact' | 'fuzzy_confirmed' | 'manual'
  created_at

supplier_products
  id
  venue_id
  supplier_id
  ingredient_id nullable
  raw_product_name
  pack_count nullable          -- e.g. 10
  unit_weight_min nullable     -- e.g. 150
  unit_weight_max nullable     -- e.g. 175
  unit                          -- 'g' | 'kg' | 'ml' | 'l' | 'unit'
  observed_avg_weight nullable -- calibrates over time, overrides range midpoint
  observation_count            -- increments each time this product appears
  latest_unit_price
  latest_price_date

invoice_lines
  id
  venue_id
  document_id
  supplier_id
  supplier_product_id nullable
  ingredient_id nullable
  product_name_raw
  pack_count
  unit_weight_min
  unit_weight_max
  unit
  unit_price
  total_price
  invoice_date
  is_estimated          -- true if cost used a range midpoint, not an observed weight
  match_confidence       -- 'high' | 'medium' | 'low' | 'unmatched'
```

**Canonical units, always:** weight → grams, volume → millilitres, countable → "unit". Convert on the way in, store everything downstream in these three. Recipes, packs, and invoices all normalize to the same base — this is what makes GP math trustworthy.

---

## 2. Invoice Line Extraction Schema

AI extraction should return this shape per line, whether the source was a photo or a PDF:

```json
{
  "product_name_raw": "CHIX SUPREME 150-175G",
  "pack_count": 10,
  "unit_weight_min": 150,
  "unit_weight_max": 175,
  "unit": "g",
  "unit_price": 2.10,
  "total_price": 21.00,
  "confidence": "high"
}
```

- If only a single weight is given (no range), set `unit_weight_min == unit_weight_max`.
- If it's a countable item with no weight (e.g. "6 x lettuce"), `unit = "unit"`, weight fields null.
- `confidence` reflects how legible/certain the extraction was — separate from ingredient *matching* confidence below.

---

## 3. Matching Pipeline (runs per invoice line, after extraction)

```
1. Normalize raw_text (lowercase, strip pack/weight numbers, trim whitespace)

2. EXACT ALIAS MATCH
   → look up (venue_id, normalized raw_text) in ingredient_aliases
   → if found: auto-assign ingredient_id, match_confidence = 'high', no chef interaction

3. FUZZY / EMBEDDING MATCH (only if no exact match)
   → compare against venue's existing ingredients + aliases
   → score above high threshold  → pre-fill suggestion, chef taps "confirm" (1 tap)
   → score in medium range        → show 2-3 candidates, chef picks or creates new
   → score below threshold        → no suggestion, chef creates new ingredient

4. ON CHEF CONFIRMATION (any path)
   → write/update row in ingredient_aliases for this exact raw_text
   → next time this raw_text appears → step 2 fires, zero clicks
```

This is the "calibration" loop from our earlier discussion — no retraining, just a lookup table that gets more complete every time a chef confirms something.

**Feed the alias list back into the extraction prompt too:** when calling the AI on a new document for a venue, include that venue's known aliases as context. Improves raw extraction accuracy, not just downstream matching.

---

## 4. Pack Weight Calibration

For costing, don't always use the range midpoint:

```
if supplier_product.observation_count >= 3:
    use observed_avg_weight
    is_estimated = false
else:
    use (unit_weight_min + unit_weight_max) / 2
    is_estimated = true
```

Every confirmed invoice line updates `observed_avg_weight` (rolling average) and increments `observation_count`. Ranges tighten into real numbers the more a venue orders that product — exactly the "gets quieter over time" effect you want.

---

## 5. Batch Backfill (month-old invoices at setup)

1. Accept multiple files in one upload session (photos + PDFs, mixed).
2. Extract all in the background.
3. **Deduplicate before asking for confirmation.** Group extracted lines by normalized `raw_text` before showing the review screen — if "CHIX SUP 150-175G" appears on 12 invoices, that's one confirmation question, applied retroactively to all 12 `invoice_lines` rows.
4. Route: PDF → text-layer extraction first, OCR/vision fallback only if no text layer. Photo → OCR/vision directly. Both output the same JSON shape above, so everything downstream is identical.
5. Duplicate invoice detection: unique on `(venue_id, supplier_id, invoice_number, invoice_date)` — needed once both a goods-in photo and an emailed PDF of the same invoice can arrive.

---

## 6. Partial Extraction & Extraction vs Verified %

Real-world condition: invoices get photographed in a batch, often creased/smudged/part-obscured from sitting on a desk all day. Don't let one bad line fail the whole document.

**Per line**, extraction returns one of:
- `extracted` — clean read, normal confidence flow applies (section 3).
- `low_confidence` — readable but uncertain (e.g. smudged price) — still created, flagged for manual check.
- `unreadable` — AI can't safely parse it → line is **disregarded automatically**, not guessed at. Never invent a price or quantity from a corrupt line.

**Add to `documents`:**
```
lines_detected          -- total lines the AI could visually locate on the page
lines_extracted         -- lines successfully parsed (extracted + low_confidence)
lines_disregarded       -- unreadable, skipped
lines_verified          -- confirmed by chef so far
```

**Two metrics shown on the document card, not one:**
- **Extraction %** = `lines_extracted / lines_detected` — machine's read quality. Low extraction % (say, under 70%) is a signal to *re-photograph*, not to review harder — the source image itself is the problem.
- **Verified %** = `lines_verified / lines_extracted` — human confirmation progress. This is the normal review queue metric.

Disregarded lines aren't hidden — list them separately at the bottom of the review screen ("3 lines couldn't be read — tap to add manually") so nothing silently vanishes from the invoice total, but they don't block confirming the rest.

**Why this matters for daily use:** a chef scanning 10 invoices at once should be able to glance at extraction % across the batch and know instantly which ones to re-shoot before they even start reviewing — instead of discovering a bad photo three lines into confirming it.

---

## 7. What "done" looks like for this piece

- Upload an invoice (photo or PDF) → structured lines extracted → known items auto-match silently → unknown items ask one clear question each → confirmed matches never need re-asking for that venue.
- A month of backfilled invoices produces a populated ingredient list, real price history, and calibrated pack weights — before the chef has done anything except upload and answer a short, deduplicated set of questions.

---

# Part B — Recipe Extraction & GP Costing (v1 Design)

Builds directly on Part A. Recipes reference `ingredients` by id and quantities in the same canonical units (g / ml / unit), so costing is just arithmetic once matching is done.

## 8. Data Model

```
recipes
  id
  venue_id
  name
  yield_quantity           -- e.g. batch makes 2000g
  yield_unit
  portions                  -- e.g. 10 portions per batch
  target_gp                 -- venue default unless overridden
  active

recipe_lines
  id
  venue_id
  recipe_id
  ingredient_id nullable    -- goes through same matching pipeline as invoice lines
  raw_text
  quantity
  unit
  waste_percentage          -- trim/prep loss, e.g. 8 for 8%
  match_confidence

menu_items
  id
  venue_id
  name
  selling_price
  recipe_id nullable

gp_snapshots
  id
  venue_id
  menu_item_id
  recipe_id
  food_cost                 -- per portion
  selling_price
  gp_percent
  target_gp
  recommended_price
  is_incomplete              -- true if any recipe_line is unmatched/missing a price
  created_at
```

## 9. Recipe Extraction Schema

Same pattern as invoices — structured JSON, human-confirmed before it counts:

```json
{
  "dish_name": "Chicken Supreme, Fondant Potato, Jus",
  "portions": 10,
  "lines": [
    { "raw_text": "chicken supreme", "quantity": 1, "unit": "unit", "waste_percentage": 0 },
    { "raw_text": "butter", "quantity": 250, "unit": "g", "waste_percentage": 0 },
    { "raw_text": "potato", "quantity": 1500, "unit": "g", "waste_percentage": 15 }
  ]
}
```

Recipe lines run through the **same alias/matching pipeline as Part A** — no separate system. A confirmed match for "potato" on a recipe card and "potato" on an invoice should resolve to the same `ingredient_id`.

## 10. Costing Calculation

```
for each recipe_line:
    ingredient_cost_per_unit = ingredient's latest confirmed cost, in canonical unit
                                (from most recent invoice_line for that ingredient,
                                 using observed_avg_weight where available — see Part A §4)

    effective_quantity = quantity × (1 + waste_percentage / 100)
    line_cost = effective_quantity × ingredient_cost_per_unit

recipe_total_cost = sum(line_cost for all lines)
cost_per_portion  = recipe_total_cost / portions
```

**If any line is unmatched or has no invoice price yet:** don't silently estimate. Set `gp_snapshots.is_incomplete = true`, show cost as "partial — missing: butter, potato" rather than a confident-looking wrong number. Same principle as the extraction/disregarded-line rule in Part A — never guess on a financial figure.

## 11. GP Calculation & Alerts

```
gp_percent = (selling_price - cost_per_portion) / selling_price × 100

recommended_price = cost_per_portion / (1 - target_gp / 100)
```

Trigger a GP alert when:
- `gp_percent < target_gp` (dish is under target)
- `selling_price` is null (menu item has no price set)
- `is_incomplete = true` for more than [N] days (nudge to finish matching, don't just leave it silently wrong)

## 12. Recalculation Trigger

Costing isn't static — it recalculates whenever the inputs change:

```
on invoice_line confirmed (new/updated ingredient price):
    find all recipes containing that ingredient_id
    recalculate cost_per_portion for each
    create new gp_snapshot row (keep history, don't overwrite)
    if gp_percent crosses below target_gp → fire GP alert
```

This is what makes the product feel "live" — a Tuesday morning invoice scan immediately ripples through to every affected dish's GP without the chef doing anything else.

## 13. What "done" looks like for this piece

- Scan a recipe card → lines match to the same ingredient list as invoices → cost per portion calculates automatically once every line has a price.
- Set a selling price on a menu item → GP% and a recommended price appear instantly.
- Next week's price rise on chicken automatically recalculates every dish using chicken, and flags the ones that dropped below target — no chef action required to trigger it.

---

# Part C — Menu Pricing Decision Flow (v1 Design)

The system's job stops at "here's what this dish truly costs." The chef decides the selling price — the system never sets or suggests it should be auto-applied.

## 14. The Screen, Conceptually

When a recipe is linked to a menu item, show three things side by side, always in this order:

```
Cost per portion:  £3.40   (from Part B §10 — the fact)
Target GP:          70%    (venue default, editable per dish)
Recommended price:  £11.33  (= cost / (1 - target_gp/100) — a suggestion, not a field)
─────────────────────────────────
Selling price:      [ chef types here ]
Actual GP:           —%    (recalculates live as they type)
```

- `recommended_price` is always shown as a **suggestion label**, never pre-filled into the `selling_price` input. The chef has to actively type or accept it — no silent default.
- As soon as they type a number, `gp_percent` recalculates live (same formula as Part B §11) so they see the real consequence of their pricing instinct immediately, before saving.
- If they price below target GP, don't block it — just make the shortfall visible in red. It might be a deliberate loss-leader; that's their call, not the system's to override.

## 15. Supporting How Chefs Actually Think About Price

GP% is the correct metric, but not every chef's first mental model — some think in cost multiples ("I always do 3x food cost") or in round menu numbers ("has to end in .95"). Worth showing cost-multiple as a secondary read-out next to GP%, purely informational:

```
cost_multiple = selling_price / cost_per_portion
```

No new logic needed — same inputs, just a second lens on the same numbers so the tool speaks the chef's language, not just the accountant's.

## 16. Data/Trigger Update

- `menu_items.selling_price` is set/edited by a human action only — never written by an automated process.
- Every time `selling_price` changes (chef edit) *or* `cost_per_portion` changes (Part B §12 recalculation), create a new `gp_snapshots` row. This keeps a full history of "what did this dish's margin look like over time" — useful later for trend reporting without any extra design work now.

## 17. What "done" looks like for this piece

- Chef links a menu item to a recipe → sees true cost and a recommended price immediately, but the selling price field stays empty until they decide.
- Typing a price shows real-time GP% and cost-multiple feedback.
- Pricing below target is visible, not blocked — the tool informs, the chef decides.
