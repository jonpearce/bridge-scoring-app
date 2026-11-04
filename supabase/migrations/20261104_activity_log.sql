-- =============================================================
--  Chicago scoring app — migration 7 (4 Nov 2026)
--  chi_log: activity log, so problems at the club can be traced.
--  One row per event: when, which phone (random id kept on the phone),
--  who was using it (the pair names that phone last played as),
--  organiser or player, what happened, and details.
--  Kept for 120 days (older rows are tidied away by the app).
--  Undo: 20261104_activity_log_ROLLBACK.sql
-- =============================================================
create table if not exists public.chi_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  device      text,
  who         text,
  role        text,
  kind        text not null,
  event_id    uuid,
  session_id  uuid,
  source      text not null default 'server' check (source in ('server', 'phone')),
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists chi_log_at_idx on public.chi_log (at desc);
create index if not exists chi_log_event_idx on public.chi_log (event_id, at desc);
alter table public.chi_log enable row level security;
revoke all on public.chi_log from anon, authenticated;
-- Explicit grant (Supabase stopped automatic grants for new tables on 30 Oct 2026).
grant select, insert, delete on public.chi_log to service_role;
