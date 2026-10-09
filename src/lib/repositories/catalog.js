import { createClient } from "@/lib/supabase/server";
import { rowToCatalogItem } from "@/lib/mappers";

/**
 * The item catalog — what we buy, without prices (pricing is negotiated per
 * person, so reference prices were removed on purpose). DB-backed rather than
 * the old static list so off-list items can be added from the admin page
 * without a deploy; migration 0017 seeded it from the supplier sheet.
 */

/** Active items, in supplier-sheet order, grouped stably by category. */
export async function listCatalogItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("*")
    .eq("active", true)
    .order("sort", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToCatalogItem);
}

/** Everything, including deactivated items — for the catalog admin page. */
export async function listAllCatalogItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("*")
    .order("sort", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToCatalogItem);
}

/**
 * Add an item at the end of its category. Returns null on a duplicate name —
 * an expected outcome the action reports, not a fault.
 */
export async function addCatalogItem({ name, category }) {
  const supabase = await createClient();
  // Slot after the current max so the new item lands at the bottom of its
  // category group instead of interleaving the seeded ordering.
  const { data: maxRow } = await supabase
    .from("catalog_items")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("catalog_items")
    .insert({ name, category, sort: (maxRow?.sort ?? 0) + 10 })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return null; // unique_violation on name
    throw error;
  }
  return rowToCatalogItem(data);
}

/**
 * Deactivate rather than delete: lots reference items by name, and a name
 * that vanishes from the picker must keep meaning something in history.
 */
export async function setCatalogItemActive(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("catalog_items").update({ active }).eq("id", id);
  if (error) throw error;
}
