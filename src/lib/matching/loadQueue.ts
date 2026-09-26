// Loads the unmatched invoice lines and groups them into the Match ingredients queue.
// Used by the /ingredients/match page and by the layout (for the nav badge count).
//
// ponytail: loads every unmatched line and groups in JS, because the grouping key
// (matchText) is TypeScript, not SQL. Fine while the queue is hundreds of lines; a
// stored normalised-name column would let Postgres do it if it ever grows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { groupUnmatched, type QueueLine, type QueueRow } from "./queue";

export async function loadMatchQueue(supabase: SupabaseClient<Database>): Promise<QueueRow[]> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .select("id, supplier_id, product_name_raw, unit_price, price_basis, invoice_date, created_at")
    .is("ingredient_id", null)
    .returns<QueueLine[]>();
  if (error) throw new Error(`Couldn't load unmatched lines: ${error.message}`);
  return groupUnmatched(data ?? []);
}
