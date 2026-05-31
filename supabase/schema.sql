-- ============================================================
-- Interactive GTD — Stage 1 database schema
-- Run this in the Supabase SQL Editor (one time) on a fresh project.
-- ============================================================

-- ---------- enums ----------
do $$ begin
  create type user_role   as enum ('principal','assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_status as enum ('open','in_progress','awaiting_principal','pending_review','follow_up','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_source as enum ('email','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type comment_type as enum ('comment','question','answer');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
-- One row per signed-in user, linked to Supabase auth.users.
-- user_key is a stable logical id ('stephane' | 'nicole') used by
-- items/comments so seed data does not depend on auth user ids.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  user_key    text unique not null,            -- 'stephane' | 'nicole'
  name        text not null,
  initials    text not null,
  role        user_role not null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ---------- projects ----------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#3B6CF0',
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- contacts ----------
create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  created_at  timestamptz not null default now()
);

-- ---------- action items ----------
create table if not exists action_items (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text default '',
  status            item_status not null default 'open',
  return_status     item_status,                          -- where to resume after a question is answered
  project_id        uuid references projects(id) on delete set null,
  contact_id        uuid references contacts(id) on delete set null,
  source            item_source not null default 'manual',
  source_email_id   text unique,                          -- Gmail message id (dedupe key)
  source_email_url  text,                                 -- deep link back to the Gmail thread
  email_from        text,                                 -- original sender display / address
  email_subject     text,                                 -- original email subject
  email_date        timestamptz,                          -- when the email was sent
  email_body        text,                                 -- full original email body (attached)
  priority          text,                                 -- 'low' | 'normal' | 'high' | null
  due_date          date,
  created_by        text not null,                        -- user_key
  assigned_to       text not null default 'nicole',       -- user_key
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index if not exists action_items_status_idx on action_items(status);
create index if not exists action_items_updated_idx on action_items(updated_at desc);

-- ---------- comments / questions / answers ----------
create table if not exists comments (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid not null references action_items(id) on delete cascade,
  author          text not null,                          -- user_key
  type            comment_type not null default 'comment',
  body            text not null,
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists comments_item_idx on comments(action_item_id, created_at);

-- ---------- activity log ----------
create table if not exists activity_log (
  id              uuid primary key default gen_random_uuid(),
  action_item_id  uuid references action_items(id) on delete cascade,
  actor           text not null,                          -- user_key or 'system'
  change          text not null,
  created_at      timestamptz not null default now()
);
create index if not exists activity_item_idx on activity_log(action_item_id, created_at);

-- ============================================================
-- Helpers / triggers
-- ============================================================

-- Map the current auth user to their profile role.
create or replace function current_role_of() returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Touch updated_at on any action_items update.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_updated on action_items;
create trigger trg_touch_updated before update on action_items
  for each row execute function touch_updated_at();

-- Only the principal may move an item to 'closed'.
create or replace function enforce_close() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'closed' and (old.status is distinct from 'closed') then
    if current_role_of() is distinct from 'principal' then
      raise exception 'Only the principal can close an item';
    end if;
    new.closed_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_close on action_items;
create trigger trg_enforce_close before update on action_items
  for each row execute function enforce_close();

-- When a new auth user is created, create their profile.
-- Role + identity are derived from the email address.
create or replace function handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  e text := lower(coalesce(new.email, ''));
begin
  if e in ('stephane.chatonsky@ivest.com.au', 'stephane@chatonsky.com') then
    insert into public.profiles (id, user_key, name, initials, role)
    values (new.id, 'stephane', 'Stephane Chatonsky', 'SC', 'principal')
    on conflict (id) do nothing;
  else
    -- everyone else on the team is treated as the assistant for Stage 1
    insert into public.profiles (id, user_key, name, initials, role)
    values (new.id, 'nicole', 'Nicole Sciacca', 'NS', 'assistant')
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Row Level Security
-- Stage 1: the two trusted users may read and write everything.
-- The principal-only-close rule is enforced by the trigger above.
-- Access is gated to authenticated users; restrict sign-ups to
-- the allowed domains in Supabase Auth settings (see README).
-- ============================================================
alter table profiles      enable row level security;
alter table projects      enable row level security;
alter table contacts      enable row level security;
alter table action_items  enable row level security;
alter table comments      enable row level security;
alter table activity_log  enable row level security;

-- profiles: anyone signed in can read; you can update only your own row.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- everything else: signed-in users have full read/write.
do $$
declare t text;
begin
  foreach t in array array['projects','contacts','action_items','comments','activity_log'] loop
    execute format('drop policy if exists %1$s_rw on %1$s;', t);
    execute format('create policy %1$s_rw on %1$s for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ============================================================
-- Realtime: broadcast changes so both users stay in sync live.
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table action_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table comments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table activity_log;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table projects;
exception when duplicate_object then null; end $$;
