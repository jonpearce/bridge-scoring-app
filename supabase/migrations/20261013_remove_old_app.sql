-- =============================================================
--  Remove the OLD duplicate-bridge app's tables (13 Oct 2026)
--  The new Chicago app does not use any of these.
--  This PERMANENTLY deletes the old app's data:
--    sessions (11 rows), boards (240), results (10), day_controllers (1)
--  The new app's tables (chi_events, chi_sessions, chi_deals) are not touched.
--  It also closes the old tables' open "golf" write access.
-- =============================================================
drop table if exists public.results;
drop table if exists public.boards;
drop table if exists public.day_controllers;
drop table if exists public.sessions;
drop function if exists public.club_ok();
drop function if exists public.set_updated_at();
