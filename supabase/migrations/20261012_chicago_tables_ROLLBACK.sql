-- Undo migration 20261012_chicago_tables.sql
-- WARNING: this removes all Chicago results recorded by the new app.
-- The old app's tables are not affected.
drop table if exists public.chi_deals;
drop table if exists public.chi_sessions;
drop table if exists public.chi_events;
drop function if exists public.chi_touch_updated_at();
