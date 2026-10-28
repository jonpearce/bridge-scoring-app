-- Undo 20261028_rubber_scoring.sql. Rubber tables become Chicago tables
-- (their scores are re-worked the Chicago way by the app).
-- Roll the app back to a deployment before 28 Oct FIRST, then run this.
delete from public.chi_settings where key = 'scoring_mode';
alter table public.chi_sessions drop column if exists scoring;
