-- =============================================================
--  Chicago scoring app — migration 6 (28 Oct 2026)
--  Rubber bridge option. Each table remembers how it is scored,
--  fixed when the table is set up:
--    chi_sessions.scoring = 'chicago' (every existing table, and the
--    default) or 'rubber'.
--  The organiser's switch is a row in chi_settings: key 'scoring_mode',
--  value "chicago" or "rubber". No row = Chicago.
--  Purely additive: the app before this change ignores the new column.
--  Undo: 20261028_rubber_scoring_ROLLBACK.sql
-- =============================================================
alter table public.chi_sessions
  add column if not exists scoring text not null default 'chicago'
  check (scoring in ('chicago', 'rubber'));
