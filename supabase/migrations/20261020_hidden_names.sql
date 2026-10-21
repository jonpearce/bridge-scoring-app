-- =============================================================
--  Chicago scoring app — migration 3 (20 Oct 2026)
--  Names the organiser has removed from the name suggestions.
--  Game results are not changed. A removed name comes back by
--  itself if it is used in a new game after it was removed.
--  Undo: 20261020_hidden_names_ROLLBACK.sql
-- =============================================================
create table if not exists public.chi_hidden_names (
  name_key  text primary key,          -- the name in lower case
  name      text not null,             -- as it was shown
  hidden_at timestamptz not null default now()
);
alter table public.chi_hidden_names enable row level security;
revoke all on public.chi_hidden_names from anon, authenticated;

-- Only the app's server (service_role) may use these tables. Explicit grant so
-- the tables still work if they are ever re-created after Supabase's
-- 30 Oct 2026 change (no automatic grants for new tables).
grant select, insert, update, delete on public.chi_hidden_names to service_role;
