import { createClient } from "@/lib/supabase/server";
import { normPhone } from "@/domain/format";

/** Add a customer by hand (before any order exists). */
export async function createManualCustomer({
  name,
  phone,
  street,
  street2,
  city,
  state,
  zip,
  createdBy,
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manual_customers")
    .insert({
      name,
      phone: normPhone(phone),
      street: street ?? null,
      street2: street2 ?? null,
      city: city ?? null,
      state: state ?? null,
      zip: zip ?? null,
      created_by: createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
