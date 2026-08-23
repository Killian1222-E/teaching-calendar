-- ===========================================================================
-- 課程行事曆 — Supabase 資料表
-- 用法：Supabase 主控台 → SQL Editor → 貼上整份 → Run
-- 可以重複執行，不會弄壞既有資料。
-- ===========================================================================

-- 每張表都有：
--   user_id    擁有者（自動帶入登入者，RLS 確保只看得到自己的資料）
--   updated_at 由裝置寫入，用來做「後寫入者勝」的衝突判定
--   deleted    軟刪除，這樣刪除動作才能同步到其他裝置
--   server_ts  伺服器時間戳，同步時的水位線，避免各裝置時鐘不準

create extension if not exists "pgcrypto";

-- --- 共用觸發器：每次寫入都更新 server_ts ---------------------------------
create or replace function public.touch_server_ts()
returns trigger language plpgsql as $$
begin
  new.server_ts := now();
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;

-- --- 地點 -----------------------------------------------------------------
create table if not exists public.locations (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  address     text,
  color       text not null default '#6c8cff',
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  server_ts   timestamptz not null default now()
);

-- --- 課程種類 -------------------------------------------------------------
create table if not exists public.courses (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  aliases     jsonb not null default '[]'::jsonb,
  color       text not null default '#34d399',
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  server_ts   timestamptz not null default now()
);

-- --- 班級 / 學生組 --------------------------------------------------------
create table if not exists public.groups (
  id                  text primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                text not null,
  aliases             jsonb not null default '[]'::jsonb,
  default_location_id text,
  default_course_id   text,
  note                text,
  updated_at          timestamptz not null default now(),
  deleted             boolean not null default false,
  server_ts           timestamptz not null default now()
);

-- --- 學生 -----------------------------------------------------------------
create table if not exists public.students (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id    text not null,
  name        text not null,
  note        text,
  active      smallint not null default 1,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  server_ts   timestamptz not null default now()
);

-- --- 固定課表 -------------------------------------------------------------
create table if not exists public.patterns (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  text not null,
  end_time    text not null,
  location_id text,
  course_id   text,
  group_id    text,
  active      smallint not null default 1,
  valid_from  text,
  valid_to    text,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  server_ts   timestamptz not null default now()
);

-- --- 課堂 -----------------------------------------------------------------
create table if not exists public.lessons (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date              text not null,
  start_time        text not null,
  end_time          text not null,
  location_id       text,
  course_id         text,
  group_id          text,
  kind              text not null default 'class',
  title             text,
  is_substitute     smallint not null default 0,
  substitute_for    text,
  guest_students    jsonb not null default '[]'::jsonb,
  headcount         integer,
  topic             text,
  prev_topic_manual text,
  note              text,
  status            text not null default 'planned',
  attendance        jsonb not null default '{}'::jsonb,
  pattern_id        text,
  updated_at        timestamptz not null default now(),
  deleted           boolean not null default false,
  server_ts         timestamptz not null default now()
);

-- --- 索引 -----------------------------------------------------------------
create index if not exists locations_sync_idx on public.locations (user_id, server_ts);
create index if not exists courses_sync_idx   on public.courses   (user_id, server_ts);
create index if not exists groups_sync_idx    on public.groups    (user_id, server_ts);
create index if not exists students_sync_idx  on public.students  (user_id, server_ts);
create index if not exists patterns_sync_idx  on public.patterns  (user_id, server_ts);
create index if not exists lessons_sync_idx   on public.lessons   (user_id, server_ts);
create index if not exists lessons_date_idx   on public.lessons   (user_id, date);

-- 舊專案升級用：這些欄位是後來才加的，重跑整份 SQL 會自動補上
alter table public.lessons add column if not exists kind text not null default 'class';
alter table public.lessons add column if not exists title text;
alter table public.lessons add column if not exists guest_students jsonb not null default '[]'::jsonb;
alter table public.lessons add column if not exists headcount integer;

-- --- 觸發器 + RLS ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['locations','courses','groups','students','patterns','lessons']
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before insert or update on public.%I
       for each row execute function public.touch_server_ts()', t, t);

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I
       for all to authenticated
       using (user_id = auth.uid())
       with check (user_id = auth.uid())', t, t);
  end loop;
end $$;
