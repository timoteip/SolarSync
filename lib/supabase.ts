import { createClient } from "@supabase/supabase-js";

// The service role key bypasses row level security, so this module must only ever
// be imported from server code. Reading process.env at module scope means a missing
// variable fails on the first import rather than halfway through a sync.
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error("SUPABASE_URL is not set. Copy .env.example to .env.local.");
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.example to .env.local.");
}

export const supabase = createClient(url, serviceRoleKey, {
  // Nothing here signs in, so there is no session to persist or refresh.
  auth: { persistSession: false },
});
