// Hand-written to match supabase/migrations/0001_init.sql.
// Once the schema stabilises, replace with:
//   npx supabase gen types typescript --project-id <id> > src/types/database.ts

export type Unit = "g" | "ml" | "unit";
export type PackUnit = "g" | "kg" | "ml" | "l" | "unit";
export type MatchConfidence = "high" | "medium" | "low" | "unmatched";
export type ExtractionStatus = "extracted" | "low_confidence" | "unreadable";
export type ReviewStatus = "pending" | "in_review" | "confirmed";
export type DocumentType = "invoice" | "recipe" | "menu";
export type SourceFormat = "photo" | "pdf";

export interface Venue {
  id: string;
  name: string;
  default_target_gp: number;
  currency: string;
  created_at: string;
}

export interface Ingredient {
  id: string;
  venue_id: string;
  canonical_name: string;
  default_unit: Unit;
  active: boolean;
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
  file_url: string;
  source_format: SourceFormat;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  lines_detected: number;
  lines_extracted: number;
  lines_disregarded: number;
  lines_verified: number;
  review_status: ReviewStatus;
  created_at: string;
}

export interface InvoiceLine {
  id: string;
  venue_id: string;
  document_id: string;
  supplier_id: string | null;
  supplier_product_id: string | null;
  ingredient_id: string | null;
  product_name_raw: string;
  pack_count: number | null;
  unit_weight_min: number | null;
  unit_weight_max: number | null;
  unit: PackUnit;
  unit_price: number | null;
  total_price: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  is_estimated: boolean;
  extraction_status: ExtractionStatus;
  match_confidence: MatchConfidence | null;
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
export interface Database {
  public: {
    Tables: {
      venues: { Row: Venue; Insert: Partial<Venue>; Update: Partial<Venue> };
      ingredients: { Row: Ingredient; Insert: Partial<Ingredient>; Update: Partial<Ingredient> };
      suppliers: { Row: Supplier; Insert: Partial<Supplier>; Update: Partial<Supplier> };
      ingredient_aliases: { Row: IngredientAlias; Insert: Partial<IngredientAlias>; Update: Partial<IngredientAlias> };
      supplier_products: { Row: SupplierProduct; Insert: Partial<SupplierProduct>; Update: Partial<SupplierProduct> };
      documents: { Row: DocumentRow; Insert: Partial<DocumentRow>; Update: Partial<DocumentRow> };
      invoice_lines: { Row: InvoiceLine; Insert: Partial<InvoiceLine>; Update: Partial<InvoiceLine> };
      recipes: { Row: Recipe; Insert: Partial<Recipe>; Update: Partial<Recipe> };
      recipe_lines: { Row: RecipeLine; Insert: Partial<RecipeLine>; Update: Partial<RecipeLine> };
      menu_items: { Row: MenuItem; Insert: Partial<MenuItem>; Update: Partial<MenuItem> };
      gp_snapshots: { Row: GpSnapshot; Insert: Partial<GpSnapshot>; Update: Partial<GpSnapshot> };
    };
  };
}
