# GP Guardian — test invoices

Five fictional supplier invoices for testing AI extraction, plus `answer-key.json` with the
correct reading of every line. All suppliers are made up and each document is marked
"SAMPLE DOCUMENT" in the footer.

| File | Type | What it tests |
|---|---|---|
| INV-01 Fenland Butchery | Clean PDF | Weight ranges (150-175g), catch-weight £/kg lines, qty > 1 |
| INV-02 Cam Valley Produce | Phone photo (mild) | Countable items, a SHORT line (not delivered, £0) |
| INV-03 Anglia Catering Wholesale | Clean PDF | Mixed VAT, non-food lines, delivery charge, CREDIT (negative) line |
| INV-04 North Sea Fish | Phone photo (rough) | Handwritten weights, crossed-out price correction, coffee stain over a price |
| INV-05 Fenland Butchery (week 2) | Phone photo (mild) | Same supplier with price rises — for testing price-change alerts later |

## How to test
1. Upload one invoice in the app, click **Read invoice**.
2. Compare the `invoice_lines` rows in Supabase against `answer-key.json`.
3. Score each line: product name, pack, weights, unit, unit_price, total_price.

## What "pass" looks like
- Prices exactly right, or honestly marked low/unreadable — never a confident wrong number.
- INV-02 avocado: total £0.00, not £16.
- INV-03 credit line: total **-£18.60**; delivery charge not treated as a product.
- INV-04 prawns: stained price marked low/unreadable (reading £19.80 is OK only if flagged low).
- INV-04 salmon: uses the handwritten £22.40, not the crossed-out £21.00.
