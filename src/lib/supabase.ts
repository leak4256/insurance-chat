import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * לקוח Supabase לצד שרת בלבד (service role). אסור לייבא מקובץ client component.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
