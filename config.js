// ════════════════════════════════════════════════════════════════
//  Supabase configuration
//  Put these two values in before deploying. Get them from your
//  Supabase project: Settings → API → Project URL / anon public key.
// ════════════════════════════════════════════════════════════════

export const SUPABASE_URL = "https://jykxfndrmdbgwbdedgzg.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5a3hmbmRybWRiZ3diZGVkZ3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTAwNDAsImV4cCI6MjEwNTEyNjA0MH0.o80xC7Lp_A725XilJX8jvyfTfM2W2Jl9O_wlIU183YA";

// Shared club word. Players type this once per device to open the app, and it
// is sent with every database write so strangers can't post results directly.
// Change it here AND update the same word in supabase/schema.sql.
export const CLUB_CODE = "golf";