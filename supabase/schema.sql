-- =============================================================
-- Duplicate Bridge Scoring App - Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL > New query)
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Session (one evening / competition) ----------
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,               -- 6-char room code used to join
  title       text,
  num_boards  int  not null default 24,
  created_at  timestamptz not null default now()
);

-- ---------- Boards (vulnerability + dealer per board) ----------
create table if not exists public.boards (
  session_id text not null references public.sessions(code) on delete cascade,
  board_num  int  not null,
  dealer     text not null,          -- N, E, S, W
  vul_ns     boolean not null,       -- NS vulnerable
  vul_ew     boolean not null,       -- EW vulnerable
  primary key (session_id, board_num)
);

-- ---------- Results (one row per board played by a pair) ----------
create table if not exists public.results (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null references public.sessions(code) on delete cascade,
  board_num    int  not null,
  pair         text not null,        -- pair name entered on the phone, e.g. "Jon & Mary"
  side         text not null,        -- 'NS' or 'EW' — the side this pair sat
  contract_level int null,           -- 1..7, null = passed out
  strain       text null,            -- S,H,D,C,NT
  doubled      text not null default 'No',  -- No, X, XX
  declarer     text null,            -- N,S,E,W (declaring side)
  open_lead    text null,            -- e.g. "Q" + suit, or free text
  tricks       int null,             -- tricks won by declaring side (0..13)
  score        int not null default 0,   -- N/S raw score (computed on client)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (session_id, board_num, pair)
);

create index if not exists results_session_idx on public.results (session_id, board_num);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists results_updated_at on public.results;
create trigger results_updated_at
  before update on public.results
  for each row execute function public.set_updated_at();

-- ---------- Realtime ----------
-- Publish live changes for these tables so every phone updates instantly.
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.results;

-- ---------- Row Level Security ----------
-- This app is a casual club tool used without login, so the anon key is given
-- access scoped to sessions. To harden for the public internet, enable
-- authentication and tighten the policies below instead.

alter table public.sessions       enable row level security;
alter table public.boards         enable row level security;
alter table public.results        enable row level security;

drop policy if exists "sessions select" on public.sessions;
create policy "sessions select" on public.sessions
  for select using (true);

drop policy if exists "sessions insert" on public.sessions;
create policy "sessions insert" on public.sessions
  for insert with check (true);

drop policy if exists "sessions update" on public.sessions;
create policy "sessions update" on public.sessions
  for update using (true);

drop policy if exists "boards select" on public.boards;
create policy "boards select" on public.boards
  for select using (true);

drop policy if exists "boards insert" on public.boards;
create policy "boards insert" on public.boards
  for insert with check (true);

drop policy if exists "boards update" on public.boards;
create policy "boards update" on public.boards
  for update using (true);

drop policy if exists "results select" on public.results;
create policy "results select" on public.results
  for select using (true);

drop policy if exists "results insert" on public.results;
create policy "results insert" on public.results
  for insert with check (true);

drop policy if exists "results update" on public.results;
create policy "results update" on public.results
  for update using (true);

drop policy if exists "results delete" on public.results;
create policy "results delete" on public.results
  for delete using (true);