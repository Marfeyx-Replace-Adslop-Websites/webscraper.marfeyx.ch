alter table public.scans
  alter column status set default 'queued',
  add column if not exists scope text not null default 'focused',
  add column if not exists platform_ids text[] not null default '{}',
  add column if not exists next_index integer not null default 0,
  add column if not exists checked_count integer not null default 0,
  add column if not exists found_count integer not null default 0,
  add column if not exists last_platform text,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists error_message text,
  add column if not exists worker_attempts smallint not null default 0;

alter table public.scans
  drop constraint if exists scans_platform_count_check,
  drop constraint if exists scans_status_check,
  drop constraint if exists scans_cursor_check,
  drop constraint if exists scans_platform_ids_check,
  drop constraint if exists scans_scope_check,
  drop constraint if exists scans_next_index_check,
  drop constraint if exists scans_checked_count_check,
  drop constraint if exists scans_found_count_check,
  drop constraint if exists scans_worker_attempts_check;

alter table public.scans
  add constraint scans_platform_count_check check (platform_count between 1 and 2500),
  add constraint scans_status_check check (status in ('queued', 'running', 'complete', 'stopped', 'failed')),
  add constraint scans_scope_check check (scope in ('focused', 'deep')),
  add constraint scans_next_index_check check (next_index >= 0),
  add constraint scans_checked_count_check check (checked_count >= 0),
  add constraint scans_found_count_check check (found_count >= 0),
  add constraint scans_worker_attempts_check check (worker_attempts between 0 and 100),
  add constraint scans_cursor_check check (next_index <= platform_count),
  add constraint scans_platform_ids_check check (cardinality(platform_ids) in (0, platform_count));

comment on column public.scans.platform_ids is 'Server-selected allowlisted platform IDs in execution priority order.';
comment on column public.scans.next_index is 'Next platform index for resumable background processing.';
comment on column public.scans.scope is 'Focused checks 600 high-priority sites; deep checks the complete catalogue.';
