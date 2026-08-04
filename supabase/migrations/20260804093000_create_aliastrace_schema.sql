create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (length(token_hash) = 64),
  client_hash text not null check (length(client_hash) = 64),
  aliases text[] not null check (cardinality(aliases) between 1 and 3),
  alias_count smallint not null check (alias_count between 1 and 3),
  platform_count smallint not null check (platform_count between 1 and 455),
  status text not null default 'running' check (status in ('running', 'complete', 'stopped', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint aliases_match_count check (alias_count = cardinality(aliases))
);

create table public.scan_results (
  id bigint generated always as identity primary key,
  scan_id uuid not null references public.scans(id) on delete cascade,
  alias text not null check (length(alias) between 1 and 32),
  platform_id text not null check (length(platform_id) between 1 and 64),
  status text not null check (status in ('found', 'not_found', 'uncertain', 'error')),
  profile_url text not null check (profile_url like 'https://%'),
  response_ms integer not null default 0 check (response_ms between 0 and 60000),
  result_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (scan_id, alias, platform_id)
);

create table public.rate_limits (
  bucket text primary key check (length(bucket) = 64),
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index scans_expires_at_idx on public.scans (expires_at);
create index scan_results_scan_status_idx on public.scan_results (scan_id, status);
create index rate_limits_expires_at_idx on public.rate_limits (expires_at);

alter table public.scans enable row level security;
alter table public.scan_results enable row level security;
alter table public.rate_limits enable row level security;

revoke all on table public.scans from anon, authenticated;
revoke all on table public.scan_results from anon, authenticated;
revoke all on table public.rate_limits from anon, authenticated;
revoke all on sequence public.scan_results_id_seq from anon, authenticated;

grant all on table public.scans to service_role;
grant all on table public.scan_results to service_role;
grant all on table public.rate_limits to service_role;
grant usage, select on sequence public.scan_results_id_seq to service_role;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_expires timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if length(p_bucket) <> 64 or p_limit < 1 or p_limit > 10000 or p_expires <= now() then
    return false;
  end if;

  insert into public.rate_limits (bucket, request_count, expires_at)
  values (p_bucket, 1, p_expires)
  on conflict (bucket) do update
    set request_count = public.rate_limits.request_count + 1
    where public.rate_limits.request_count < p_limit
  returning request_count into v_count;

  return v_count is not null and v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, timestamptz) to service_role;

create or replace function public.cleanup_aliastrace_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.scans where expires_at < now();
  delete from public.rate_limits where expires_at < now();
end;
$$;

revoke all on function public.cleanup_aliastrace_data() from public, anon, authenticated;
grant execute on function public.cleanup_aliastrace_data() to postgres, service_role;

select cron.schedule(
  'aliastrace-hourly-cleanup',
  '17 * * * *',
  $$select public.cleanup_aliastrace_data();$$
);

comment on table public.scans is 'Short-lived AliasTrace scan sessions; deleted within 24 hours.';
comment on table public.scan_results is 'Public-profile scan evidence linked to a short-lived scan.';
comment on table public.rate_limits is 'Hashed fixed-window counters used only to prevent service abuse.';
