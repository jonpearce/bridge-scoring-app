-- =============================================================
--  Chicago scoring app — migration 5 (21 Oct 2026)
--  1. chi_settings: app-wide switches set by the organiser.
--     'vul_locked' → true/false. No row = locked (the default).
--  2. chi_name_fixes: spelling corrections made by the organiser
--     (old name → correct name), so phones that remembered the old
--     spelling switch to the new one.
--  Undo: 20261021_settings_and_name_fixes_ROLLBACK.sql
-- =============================================================
create table if not exists public.chi_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.chi_name_fixes (
  from_key  text primary key,          -- the wrong spelling, lower case
  from_name text not null,
  to_name   text not null,
  fixed_at  timestamptz not null default now()
);
alter table public.chi_settings   enable row level security;
alter table public.chi_name_fixes enable row level security;
revoke all on public.chi_settings, public.chi_name_fixes from anon, authenticated;
