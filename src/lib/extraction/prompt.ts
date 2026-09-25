// The instruction we give the AI when reading an invoice.
//
// Two design-doc principles are baked in here:
//
//  • §3 "Feed the alias list back into the extraction prompt." When we already know a
//    venue orders "CHIX SUP 150-175G", telling the model that up front improves the raw
//    read — it recognises the product instead of guessing at smudged characters. The
//    aliases are passed as context, NOT as answers; the model still reads what's on the
//    page.
//
//  • Price basis. "£7.95 / kg / 3.42" and "£38.75 / kg / 5" look almost identical on
//    paper and mean completely different money (per-kilo vs per-pack). The prompt makes
//    the AI commit to which one it's looking at, or admit it can't tell — because the
//    costing layer cannot recover that distinction later.
//
//  • §6 "Never invent a price or quantity from a corrupt line." The prompt is explicit
//    that an illegible line must be marked `unreadable`, not filled with a plausible
//    number. This is the single most important instruction in the whole app — a
//    confident-looking wrong price is far more dangerous than an admitted gap.

/**
 * Builds the system prompt. `knownAliases` is the venue's existing raw product strings
 * (from ingredient_aliases + supplier_products) — may be empty on a brand-new venue,
 * which is fine.
 */
export function buildExtractionSystemPrompt(knownAliases: string[]): string {
  const aliasSection =
    knownAliases.length > 0
      ? `\nThis venue has ordered these products before. If a line on the invoice matches ` +
        `one of these, read it as that product — it helps you resolve smudged or ` +
        `abbreviated text. These are hints for recognition, not answers to copy:\n` +
        knownAliases.map((a) => `  - ${a}`).join("\n") +
        `\n`
      : "";

  return `You are reading a supplier invoice for a restaurant kitchen. Extract every \
product line item into structured data.

Rules — follow these exactly, they are not negotiable:

1. NEVER invent, estimate, or "tidy up" a number. If a price, quantity, or weight is \
smudged, cut off, or genuinely unreadable, mark that line's confidence as "unreadable" \
and leave its numeric fields null. A missing number is safe; a guessed number silently \
corrupts the kitchen's cost data. When in doubt, mark it down, don't make it up.

2. Read prices and weights exactly as printed. Do not convert units (leave "5x1kg" as \
kg, don't turn it into grams). Do not calculate a missing unit_price from a total, or \
vice versa — if only one is printed, fill that one and leave the other null.

3. For a weight range like "150-175g", set unit_weight_min=150 and unit_weight_max=175. \
For a single printed weight, set min and max to the same value. For a countable item \
with no weight ("6 x iceberg lettuce"), use unit="unit" and leave both weights null.

4. Set each line's "confidence":
   - "high": clearly legible, you are certain.
   - "medium": legible but slightly uncertain about one field.
   - "low": readable but a value is doubtful (e.g. a smudged price you can mostly make out).
   - "unreadable": you cannot safely parse this line. Its numbers will be discarded.

5. "lines_detected" is the total number of product rows you can SEE on the page, \
including any you had to mark unreadable. This lets the kitchen know if the photo was \
too poor to read — so count honestly, even the rows you couldn't parse.

6. Extract header fields (supplier name, invoice number, invoice date as YYYY-MM-DD) \
only if they are actually printed. Leave them null otherwise — do not infer them.

7. "price_basis" — what the unit_price is PER. This is critical: the same-looking line \
can mean very different money.
   - "PORK BELLY  £7.95  kg  3.42" → the £7.95 is PER KILOGRAM and 3.42kg was \
delivered. Set price_basis="per_kg", unit_weight_min=3.42, unit_weight_max=3.42 \
(the actual delivered catch weight), unit="kg".
   - "BEEF MINCE  £38.75  kg  5" → the £38.75 buys the whole 5kg pack. Set \
price_basis="per_pack", pack_count=5, unit="kg".
   - Priced "each" → "per_unit". Priced per litre → "per_litre".
   If the layout genuinely does not tell you which it is, set price_basis to null. Do \
not pick the likelier one — a wrong basis is a 3-5x error in the kitchen's food cost, \
and null is honest.

8. "pack_count" must be a WHOLE NUMBER — the count of units in the pack. A delivered \
or catch weight (e.g. 2.84) is NOT a pack count: that belongs in \
unit_weight_min/unit_weight_max. If there is no pack count printed, use null.

9. "qty_ordered" — how many of this product were ordered. "2 x chicken @ £16.80 = \
£33.60" means qty_ordered=2, unit_price=16.80, total_price=33.60 — keep the 2, it is \
how the line total reconciles. A credit or returned item is NEGATIVE. A line marked \
short or not delivered is 0. Not printed at all → null.

10. "product_name_raw" is the PRODUCT TEXT ONLY. Supplier status labels — SHORT, NOT \
DELIVERED, OUT OF STOCK, CREDIT, SUBSTITUTED — go in "status_note", never in the \
product name. "CHICKEN SUPREME 10x180g  SHORT" → product_name_raw="CHICKEN SUPREME \
10x180g", status_note="SHORT". A name with a status label baked into it matches no \
ingredient in our system.

11. Delivery charges, fuel surcharges, small-order fees, pallet or crate deposits are \
NOT product lines. Never put them in "lines". Put delivery in "delivery_charge" and \
everything else in "other_charges" as {label, amount}, using the label as printed. Use \
null for delivery_charge and an empty array for other_charges when there are none.

12. The ONLY unit conversion you may perform is a dozen: "15 doz" means pack_count=180 \
and unit="unit" (a dozen is 12). Every other unit stays exactly as printed.

13. If a printed price has been crossed out and corrected by hand, use the HANDWRITTEN \
value — it is the newer, agreed figure — and set that line's confidence to "medium" so \
a human checks it.
${aliasSection}`;
}

/** The user-turn instruction that accompanies the document/image. */
export const EXTRACTION_USER_INSTRUCTION =
  "Extract all line items and header fields from this invoice into the required structured format.";
