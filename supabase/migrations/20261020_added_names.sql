-- =============================================================
--  Chicago scoring app — migration 4 (20 Oct 2026)
--  Names the organiser has added by hand on the Edit names page
--  (so they are suggested before the player has played a game).
--  Undo: 20261020_added_names_ROLLBACK.sql
-- =============================================================
create table if not exists public.chi_added_names (
  name_key text primary key,           -- the name in lower case
  name     text not null,              -- as typed
  added_at timestamptz not null default now()
);
alter table public.chi_added_names enable row level security;
revoke all on public.chi_added_names from anon, authenticated;

-- Only the app's server (service_role) may use these tables. Explicit grant so
-- the tables still work if they are ever re-created after Supabase's
-- 30 Oct 2026 change (no automatic grants for new tables).
grant select, insert, update, delete on public.chi_added_names to service_role;
