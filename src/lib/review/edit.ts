// What the chef is allowed to change on an invoice line, and the rules for each field.
//
// Shared by the PATCH route (the real gatekeeper) and the review screen (so it knows
// which fields to render). Pure — no DB.

// zod/v4 to match the extraction schema, so PackUnitSchema/PriceBasisSchema can be reused.
import { z } from "zod/v4";
import { PackUnitSchema, PriceBasisSchema } from "@/lib/extraction/schema";
import type { InvoiceLine } from "@/types/database";

export const EDITABLE_FIELDS = [
  "product_name_raw",
  "qty_ordered",
  "pack_count",
  "unit_weight_min",
  "unit_weight_max",
  "unit",
  "price_basis",
  "unit_price",
  "total_price",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * PATCH /api/invoice-lines/[id] body. Every field optional — send only what changed.
 *
 * .strict() rejects unknown keys, so nobody can slip `verified_at` or `ai_original` in
 * through the edit endpoint. Confirming goes through `confirm`, nothing else.
 */
export const LineEditSchema = z
  .object({
    product_name_raw: z.string().trim().min(1, "Product name can't be blank."),
    // Negative = credit, 0 = short/not delivered — both legitimate, so no min.
    qty_ordered: z.number().nullable(),
    // Postgres `integer`. The INV-04 bug: a fractional value here once lost a whole invoice.
    pack_count: z.number().int("Pack count must be a whole number.").positive().nullable(),
    unit_weight_min: z.number().nonnegative().nullable(),
    unit_weight_max: z.number().nonnegative().nullable(),
    unit: PackUnitSchema,
    // Null is a real answer: "the invoice doesn't say".
    price_basis: PriceBasisSchema.nullable(),
    unit_price: z.number().nullable(),
    total_price: z.number().nullable(),
    // true = confirm, false = un-confirm. Omitted = leave as is (unless fields change).
    confirm: z.boolean(),
  })
  .partial()
  .strict();

export type LineEdit = z.infer<typeof LineEditSchema>;

/** The AI's values for the editable fields — what we snapshot into ai_original. */
export function snapshotEditable(line: Pick<InvoiceLine, EditableField>) {
  return Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, line[f]]));
}
