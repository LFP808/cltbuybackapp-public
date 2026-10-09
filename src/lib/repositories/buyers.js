import { createClient } from "@/lib/supabase/server";
import { rowToBuyer } from "@/lib/mappers";

/**
 * Buyers — the wholesalers invoices are made out to. Deliberately not a CRM:
 * a name for the dropdown, the bill-to/ship-to address, and the terms block
 * (ACH details) printed at the bottom of the invoice document.
 */

export async function listBuyers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buyers")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToBuyer);
}

export async function getBuyer(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("buyers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToBuyer(data) : null;
}

export async function createBuyer(buyer, createdBy) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buyers")
    .insert({
      name: buyer.name,
      street: buyer.street ?? null,
      street2: buyer.street2 ?? null,
      city: buyer.city ?? null,
      state: buyer.state ?? null,
      zip: buyer.zip ?? null,
      terms: buyer.terms ?? null,
      created_by: createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToBuyer(data);
}

export async function updateBuyer(id, patch) {
  const supabase = await createClient();
  const row = {};
  if ("name" in patch) row.name = patch.name;
  for (const f of ["street", "street2", "city", "state", "zip", "terms"]) {
    if (f in patch) row[f] = patch[f] ?? null;
  }
  const { data, error } = await supabase
    .from("buyers")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToBuyer(data);
}
