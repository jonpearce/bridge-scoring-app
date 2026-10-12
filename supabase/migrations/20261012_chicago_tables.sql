-- =============================================================
--  Chicago scoring app — migration 1 (additive only)
--  Adds three new tables. Does NOT change or delete the old
--  sessions / boards / results / day_controllers tables.
--  Undo: run 20261012_chicago_tables_ROLLBACK.sql
-- =============================================================

-- A playing day (the "event"). Board numbers are compared within one event.
create table if not exists public.chi_events (
  id          uuid primary key default gen_random_uuid(),
  play_date   date not null,
  name        text not null default 'Social bridge',
  created_at  timestamptz not null default now(),
  unique (play_date, name)
);

-- One four-deal Chicago session at one table (shared by both pairs).
create table if not exists public.chi_sessions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.chi_events(id) on delete restrict,
  location      text not null check (length(trim(location)) between 1 and 80),
  start_board   int  not null check (start_board between 1 and 999),
  first_dealer  text not null default 'N' check (first_dealer in ('N','E','S','W')),
  ns_p1         text not null check (length(trim(ns_p1)) between 1 and 40),
  ns_p2         text not null check (length(trim(ns_p2)) between 1 and 40),
  ew_p1         text not null check (length(trim(ew_p1)) between 1 and 40),
  ew_p2         text not null check (length(trim(ew_p2)) between 1 and 40),
  client_token  uuid unique,            -- stops a double-tap creating two sessions
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists chi_sessions_event_idx on public.chi_sessions (event_id);

-- One deal (board) played in a session. Raw facts are stored so scores
-- can be recalculated; ns_score is calculated on the server.
create table if not exists public.chi_deals (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.chi_sessions(id) on delete cascade,
  deal_no          int  not null check (deal_no between 1 and 4),
  board_num        int  not null check (board_num between 1 and 999),
  passed_out       boolean not null default false,
  level            int  check (level between 1 and 7),
  strain           text check (strain in ('C','D','H','S','NT')),
  doubled          text not null default '' check (doubled in ('','X','XX')),
  declarer         text check (declarer in ('N','E','S','W')),
  tricks           int  check (tricks between 0 and 13),
  lead_suit        text check (lead_suit in ('S','H','D','C')),
  lead_rank        text check (lead_rank in ('A','K','Q','J','10','9','8','7','6','5','4','3','2')),
  ns_score         int  not null,       -- + means N/S gained, − means E/W gained
  scoring_version  int  not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (session_id, deal_no),         -- a correction updates, never duplicates
  check (passed_out or (level is not null and strain is not null and declarer is not null and tricks is not null))
);
create index if not exists chi_deals_board_idx on public.chi_deals (board_num);

-- Keep updated_at fresh
create or replace function public.chi_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists chi_sessions_touch on public.chi_sessions;
create trigger chi_sessions_touch before update on public.chi_sessions
  for each row execute function public.chi_touch_updated_at();

drop trigger if exists chi_deals_touch on public.chi_deals;
create trigger chi_deals_touch before update on public.chi_deals
  for each row execute function public.chi_touch_updated_at();

-- Security: no public access at all. Only the app's server functions
-- (using the secret service key held in Vercel) can read or write.
alter table public.chi_events   enable row level security;
alter table public.chi_sessions enable row level security;
alter table public.chi_deals    enable row level security;
revoke all on public.chi_events, public.chi_sessions, public.chi_deals from anon, authenticated;
