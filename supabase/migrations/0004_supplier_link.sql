-- GP Guardian — Supplier linking
--
-- Price-change alerts compare a product against the same SUPPLIER's last invoice, so
-- every invoice needs a supplier. Extraction now reads the supplier name, finds-or-
-- creates a `suppliers` row (case-insensitive, trimmed, exact match) and sets
-- documents.supplier_id + invoice_lines.supplier_id.
--
-- supplier_name_raw keeps the name exactly as printed. The link to `suppliers` is our
-- interpretation of it; the raw text is the evidence. If "BROWNS MEATS LTD" and
-- "Browns Meats" ever get merged or split, we can re-link from what was actually on
-- the paper instead of guessing. Same idea as product_name_raw on invoice_lines.
--
-- Additive only — no data is rewritten. Nullable: old invoices, and invoices with no
-- readable supplier name, honestly have none.
alter table documents
  add column supplier_name_raw text;
