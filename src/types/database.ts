// Hand-written to match supabase/migrations/0001_init.sql.
// Once the schema stabilises, replace with:
//   npx supabase gen types typescript --project-id <id> > src/types/database.ts

export type Unit = "g" | "ml" | "unit";
export type PackUnit = "g" | "kg" | "ml" | "l" | "unit";
export type MatchConfidence = "high" | "medium" | "low" | "unmatched";
export type ExtractionStatus = "extracted" | "low_confidence" | "unreadable";
// What an invoice line's unit_price is PER. Nullable in the DB: "£7.95 kg 3.42" (per kg)
// and "£38.75 kg 5" (per 5kg pack) look almost identical on paper, so when the layout
// genuinely doesn't say we record an honest gap rather than a 3-5x costing error.
export type PriceBasis = "per_pack" | "per_kg" | "per_litre" | "per_unit";
/** food → costed; non_food → tracked, never in recipes; by_product → costed at £0. */
export type IngredientKind = "food" | "non_food" | "by_product";
export type DocumentType = "invoice" | "recipe" | "menu";
export type SourceFormat = "photo" | "pdf";

// Two independent lifecycles on `documents` — do not conflate them (see 0002 migration).
//
//   ProcessingStatus = what the MACHINE has done. Has the AI read this document?
//   ReviewStatus     = what the HUMAN has done. Has the chef confirmed it?
//
// A document can legitimately be `failed` + `pending` (extraction broke, nobody's
// looked yet). One column can't say that; two can. Same reasoning as the design doc's
// Extraction % vs Verified % split (§6).
export type ProcessingStatus = "uploaded" | "extracting" | "extracted" | "failed";
export type ReviewStatus = "pending" | "in_review" | "confirmed";

/** One non-product charge on an invoice — fuel surcharge, small-order fee, crate deposit. */
export interface OtherCharge {
  label: string; // as printed on the invoice
  amount: number; // negative for a discount/credit
}

export interface Venue {
  id: string;
  name: string;
  default_target_gp: number;
  currency: string;
  /** Menu prices include VAT; GP is on the net price. Default 20. */
  vat_rate: number;
  /** Flat waste allowance, % of NET selling price, taken off GP. Default 4. */
  waste_allowance_pct: number;
  created_at: string;
}

export interface Ingredient {
  id: string;
  venue_id: string;
  canonical_name: string;
  default_unit: Unit;
  active: boolean;
  /** % usable after in-house prep, 1–100. 100 = off. */
  yield_percent: number;
  kind: IngredientKind;
  created_at: string;
}

export interface Supplier {
  id: string;
  venue_id: string;
  name: string;
  active: boolean;
}

export interface IngredientAlias {
  id: string;
  venue_id: string;
  ingredient_id: string;
  raw_text: string;
  supplier_id: string | null;
  match_type: "exact" | "fuzzy_confirmed" | "manual";
  created_at: string;
}

export interface SupplierProduct {
  id: string;
  venue_id: string;
  supplier_id: string;
  ingredient_id: string | null;
  raw_product_name: string;
  pack_count: number | null;
  unit_weight_min: number | null;
  unit_weight_max: number | null;
  unit: PackUnit;
  observed_avg_weight: number | null;
  observation_count: number;
  latest_unit_price: number | null;
  latest_price_date: string | null;
}

export interface DocumentRow {
  id: string;
  venue_id: string;
  document_type: DocumentType;
  /**
   * Path *within* the private `documents` Storage bucket — e.g.
   * "a1b2.../invoice/c3d4....jpg". NOT a public URL: supplier invoices are
   * commercial data, so the bucket is private and the app mints short-lived
   * signed URLs on demand. (Column name kept as-is to match 0001.)
   */
  file_url: string;
  source_format: SourceFormat;
  supplier_id: string | null;
  /** Supplier name exactly as printed. supplier_id is our link; this is the evidence. */
  supplier_name_raw: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  lines_detected: number;
  lines_extracted: number;
  lines_disregarded: number;
  lines_verified: number;
  /**
   * Invoice-level charges. Delivery and surcharges are real money in the invoice total
   * but they aren't ingredients — as product lines they'd appear as an unmatchable
   * "DELIVERY" in the review queue every week, so they live here instead.
   */
  delivery_charge: number | null;
  other_charges: OtherCharge[];
  processing_status: ProcessingStatus;
  extraction_error: string | null;
  review_status: ReviewStatus;
  created_at: string;
}

export interface InvoiceLine {
  id: string;
  venue_id: string;
  document_id: string;
  supplier_id: string | null;
  /** Position on the paper invoice (1, 2, 3…). Null on lines read before 0006. */
  line_no: number | null;
  supplier_product_id: string | null;
  ingredient_id: string | null;
  product_name_raw: string;
  /** Units per pack. Postgres `integer` — a catch weight in here is what lost INV-04. */
  pack_count: number | null;
  /** How many ordered. Negative = credit, 0 = short/not delivered, null = not printed. */
  qty_ordered: number | null;
  unit_weight_min: number | null;
  unit_weight_max: number | null;
  unit: PackUnit;
  unit_price: number | null;
  total_price: number | null;
  /** What unit_price is per. Null when the invoice genuinely doesn't say. */
  price_basis: PriceBasis | null;
  /**
   * Supplier's label against the line ("SHORT", "CREDIT"), kept out of
   * product_name_raw so ingredient matching still works. Also carries our own repair
   * notes, so a field we had to null doesn't look like one that was never printed.
   */
  status_note: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  is_estimated: boolean;
  extraction_status: ExtractionStatus;
  match_confidence: MatchConfidence | null;
  /** When the chef confirmed this line. Null = not confirmed. Editing resets it to null. */
  verified_at: string | null;
  /** The AI's values, snapshotted on the chef's FIRST edit. Null = never edited. */
  ai_original: Record<string, unknown> | null;
  created_at: string;
}

export interface Recipe {
  id: string;
  venue_id: string;
  name: string;
  yield_quantity: number | null;
  yield_unit: string | null;
  portions: number;
  target_gp: number | null;
  active: boolean;
  created_at: string;
}

export interface RecipeLine {
  id: string;
  venue_id: string;
  recipe_id: string;
  ingredient_id: string | null;
  raw_text: string;
  quantity: number;
  unit: Unit;
  /**
   * @deprecated Superseded by venues.waste_allowance_pct + ingredients.yield_percent
   * (CLAUDE.md "Money rules"). Still in the schema; costing ignores it.
   */
  waste_percentage: number;
  match_confidence: MatchConfidence | null;
}

export interface MenuItem {
  id: string;
  venue_id: string;
  name: string;
  selling_price: number | null;
  recipe_id: string | null;
  active: boolean;
  created_at: string;
}

export interface GpSnapshot {
  id: string;
  venue_id: string;
  menu_item_id: string | null;
  recipe_id: string | null;
  food_cost: number | null;
  selling_price: number | null;
  gp_percent: number | null;
  target_gp: number | null;
  recommended_price: number | null;
  is_incomplete: boolean;
  created_at: string;
}

// Minimal Supabase Database generic — enough to type the client.
// Extend row/insert/update per table as you build out queries.
//
// `Relationships: []` is REQUIRED on every table, not decorative. supabase-js's
// internal `GenericTable` constraint is `{ Row, Insert, Update, Relationships }`.
// Omit Relationships and the library can't recognise the table, so it silently
// resolves insert/update payloads to `never` — which surfaces as the baffling
// "venue_id does not exist in type 'never[]'" error on your first typed write.
// Empty array = "no foreign-key relationships declared", which is fine for our
// hand-written types; the generated types would fill these in.
type Rel = []; // shorthand so the table map below stays readable

export interface Database {
  public: {
    Tables: {
      venues: { Row: Venue; Insert: Partial<Venue>; Update: Partial<Venue>; Relationships: Rel };
      ingredients: { Row: Ingredient; Insert: Partial<Ingredient>; Update: Partial<Ingredient>; Relationships: Rel };
      suppliers: { Row: Supplier; Insert: Partial<Supplier>; Update: Partial<Supplier>; Relationships: Rel };
      ingredient_aliases: { Row: IngredientAlias; Insert: Partial<IngredientAlias>; Update: Partial<IngredientAlias>; Relationships: Rel };
      supplier_products: { Row: SupplierProduct; Insert: Partial<SupplierProduct>; Update: Partial<SupplierProduct>; Relationships: Rel };
      documents: { Row: DocumentRow; Insert: Partial<DocumentRow>; Update: Partial<DocumentRow>; Relationships: Rel };
      invoice_lines: { Row: InvoiceLine; Insert: Partial<InvoiceLine>; Update: Partial<InvoiceLine>; Relationships: Rel };
      recipes: { Row: Recipe; Insert: Partial<Recipe>; Update: Partial<Recipe>; Relationships: Rel };
      recipe_lines: { Row: RecipeLine; Insert: Partial<RecipeLine>; Update: Partial<RecipeLine>; Relationships: Rel };
      menu_items: { Row: MenuItem; Insert: Partial<MenuItem>; Update: Partial<MenuItem>; Relationships: Rel };
      gp_snapshots: { Row: GpSnapshot; Insert: Partial<GpSnapshot>; Update: Partial<GpSnapshot>; Relationships: Rel };
    };
    // Also required: supabase-js's `GenericSchema` is `{ Tables, Views, Functions }`.
    // We have no views or DB functions yet, but the KEYS must exist or the whole
    // schema fails the constraint and every insert/update silently becomes `never`.
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
