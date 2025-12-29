import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing env vars. Check .env.local for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart `npm run dev`."
  );
}

// Browser client (safe to use in Client Components)
console.log("SUPABASE_URL:", supabaseUrl);
console.log("SUPABASE_KEY_PREFIX:", supabaseAnonKey?.slice(0, 12), "LEN:", supabaseAnonKey?.length);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
