alter table public.scans drop constraint scans_platform_count_check;
alter table public.scans drop constraint scans_status_check;

alter table public.scans
  alter column status set default 'queued',
  add column scope text not null default 'focused' check (scope in ('focused', 'deep')),
  add column platform_ids text[] not null default '{}',
  add column next_index integer not null default 0 check (next_index >= 0),
  add column checked_count integer not null default 0 check (checked_count >= 0),
  add column found_count integer not null default 0 check (found_count >= 0),
  add column last_platform text,
  add column last_heartbeat_at timestamptz,
  add column error_message text,
  add column worker_attempts smallint not null default 0 check (worker_attempts between 0 and 100);

alter table public.scans
  add constraint scans_platform_count_check check (platform_count between 1 and 2500),
  add constraint scans_status_check check (status in ('queued', 'running', 'complete', 'stopped', 'failed')),
  add constraint scans_cursor_check check (next_index <= platform_count),
  add constraint scans_platform_ids_check check (cardinality(platform_ids) in (0, platform_count));

create index scans_worker_status_idx
  on public.scans (status, last_heartbeat_at)
  where status in ('queued', 'running');

comment on column public.scans.platform_ids is 'Server-selected allowlisted platform IDs in execution priority order.';
comment on column public.scans.next_index is 'Next platform index for resumable background processing.';
comment on column public.scans.scope is 'Focused checks 600 high-priority sites; deep checks the complete catalogue.';
