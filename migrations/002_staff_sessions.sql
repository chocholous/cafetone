-- Move from singular staff.session_hash to many-to-one staff_sessions.
-- Lets one barista stay signed in on multiple devices at once.

create table if not exists staff_sessions (
  id            text primary key,                           -- ulid
  staff_id      text not null references staff(id) on delete cascade,
  session_hash  text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index if not exists staff_sessions_staff_idx on staff_sessions (staff_id);
create unique index if not exists staff_sessions_hash_idx on staff_sessions (session_hash);

-- Carry over any still-valid singular session so nobody gets kicked out on deploy.
insert into staff_sessions (id, staff_id, session_hash, expires_at)
  select
    gen_random_uuid()::text,
    id,
    session_hash,
    session_exp
  from staff
  where session_hash is not null
    and session_exp is not null
    and session_exp > now();

alter table staff drop column if exists session_hash;
alter table staff drop column if exists session_exp;
