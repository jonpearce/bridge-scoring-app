-- Chicago scoring app — migration 8 (4 Nov 2026)
-- chi_deals.saved_by: random id of the phone that last saved the board, so a
-- different phone is asked before it changes that result. Additive.
-- Undo: 20261104_deal_saved_by_ROLLBACK.sql
alter table public.chi_deals add column if not exists saved_by text;
