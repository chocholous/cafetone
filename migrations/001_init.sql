-- Loyalty Wallet MVP — initial schema.
-- Single tenant. If you find yourself adding a tenants table here, stop and
-- build v2 instead.

create extension if not exists "pgcrypto";

create table if not exists staff (
  id              text primary key,        -- ulid
  email           text not null unique,
  -- active magic-link token hash; null means no pending link.
  magic_link_hash text,
  magic_link_exp  timestamptz,
  -- active session cookie hash (rotated on login)
  session_hash    text,
  session_exp     timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists customers (
  id            text primary key,          -- ulid
  email         text unique,
  phone         text unique,
  created_at    timestamptz not null default now(),
  consent_at    timestamptz not null,
  deleted_at    timestamptz,
  -- denormalised for fast wallet updates
  stamps_count  integer not null default 0,
  reward_ready  boolean not null default false,
  last_stamp_at timestamptz
);

create index if not exists customers_email_idx on customers (lower(email));

-- One row per (customer, platform). A customer may add the pass to both iOS
-- and Android, but re-installing on the same platform overwrites.
create table if not exists passes (
  id                 text primary key,      -- ulid
  customer_id        text not null references customers(id) on delete cascade,
  platform           text not null check (platform in ('apple','google')),
  serial_number      text not null unique,  -- shown in pkpass / used as Google objectId suffix
  auth_token         text not null,         -- Apple PassKit WS auth header
  last_updated_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (customer_id, platform)
);

create index if not exists passes_serial_idx on passes (serial_number);

-- Apple PassKit Web Service device registry.
-- A single pass (identified by its serial) may be registered on many devices
-- (iPhone, iPad, Watch). Each device has one push token per pass type id.
create table if not exists apple_devices (
  device_library_id text not null,
  pass_type_id      text not null,
  serial_number     text not null,
  push_token        text not null,
  registered_at     timestamptz not null default now(),
  primary key (device_library_id, pass_type_id, serial_number)
);

create index if not exists apple_devices_serial_idx
  on apple_devices (pass_type_id, serial_number);

create table if not exists stamps (
  id          text primary key,            -- ulid
  customer_id text not null references customers(id) on delete cascade,
  staff_id    text not null references staff(id) on delete restrict,
  created_at  timestamptz not null default now(),
  device_ip   inet
);

create index if not exists stamps_customer_idx on stamps (customer_id, created_at desc);

create table if not exists redemptions (
  id            text primary key,          -- ulid
  customer_id   text not null references customers(id) on delete cascade,
  staff_id      text not null references staff(id) on delete restrict,
  stamps_count  integer not null,
  created_at    timestamptz not null default now()
);

create index if not exists redemptions_customer_idx
  on redemptions (customer_id, created_at desc);

-- Single-row config. Seed with defaults.
create table if not exists config (
  id                 integer primary key default 1 check (id = 1),
  stamps_required    integer not null default 10,
  reward_text        text    not null default 'Free drink of your choice',
  bar_name           text    not null default 'Cafetone',
  updated_at         timestamptz not null default now()
);

insert into config (id) values (1) on conflict do nothing;
