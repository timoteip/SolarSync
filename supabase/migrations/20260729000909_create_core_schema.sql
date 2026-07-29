-- Core schema for the production pipeline.
--
-- Dates in expected_daily and actual_daily are local days at the site, never UTC
-- days. Open-Meteo is queried with the site's own timezone and returns dates
-- already in that zone, so they are stored exactly as received and never shifted.

create table sites (
  id                uuid          primary key default gen_random_uuid(),
  name              text          not null,
  latitude          numeric(8, 5) not null,
  longitude         numeric(8, 5) not null,
  -- An IANA zone name. Postgres cannot check this against pg_timezone_names in a
  -- constraint, so the validation happens in code before the insert.
  timezone          text          not null,
  capacity_kwp      numeric(10, 3) not null,
  performance_ratio numeric(4, 3) not null,
  created_at        timestamptz   not null default now(),

  constraint sites_name_unique unique (name),
  constraint sites_name_not_blank check (length(trim(name)) > 0),
  constraint sites_latitude_range check (latitude between -90 and 90),
  constraint sites_longitude_range check (longitude between -180 and 180),
  constraint sites_capacity_positive check (capacity_kwp > 0),
  constraint sites_performance_ratio_range check (
    performance_ratio > 0 and performance_ratio <= 1
  )
);

-- Every sync writes a row here, successes and failures alike. The row is inserted
-- as 'running' before any work starts and updated once the work ends, so a process
-- that dies mid-run leaves its evidence behind without having to execute anything.
create table sync_runs (
  id               uuid        primary key default gen_random_uuid(),
  kind             text        not null,
  status           text        not null,
  site_id          uuid        references sites (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  rows_written     integer     not null default 0,
  rows_quarantined integer     not null default 0,
  error            text,

  constraint sync_runs_kind_known check (kind in ('expected_fetch', 'actual_import')),
  constraint sync_runs_status_known check (status in ('running', 'succeeded', 'failed')),
  constraint sync_runs_running_has_no_finish check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  ),
  constraint sync_runs_finished_after_started check (
    finished_at is null or finished_at >= started_at
  ),
  constraint sync_runs_failed_has_error check (status <> 'failed' or error is not null),
  constraint sync_runs_row_counts_non_negative check (
    rows_written >= 0 and rows_quarantined >= 0
  )
);

-- Production the site should have generated, derived from radiation. The capacity
-- and performance ratio used in the calculation are stored alongside the result so
-- that a row stays explicable if either is retuned later.
create table expected_daily (
  site_id                uuid          not null references sites (id) on delete cascade,
  date                   date          not null,
  -- Wider than the plausible range on purpose, so that an out-of-range value is
  -- caught by the named check below rather than by numeric overflow, which reports
  -- a precision error instead of saying what is actually wrong.
  radiation_mj_m2        numeric(8, 3) not null,
  expected_kwh           numeric(12, 3) not null,
  capacity_kwp_used      numeric(10, 3) not null,
  performance_ratio_used numeric(4, 3) not null,
  sync_run_id            uuid          not null references sync_runs (id),
  fetched_at             timestamptz   not null default now(),

  primary key (site_id, date),

  -- Peak terrestrial insolation is around 35 MJ/m2/day. The ceiling is here to
  -- catch a unit change upstream, which would otherwise produce plausible-looking
  -- wrong numbers indefinitely.
  constraint expected_daily_radiation_plausible check (
    radiation_mj_m2 >= 0 and radiation_mj_m2 <= 50
  ),

  -- capacity_kwp_used and performance_ratio_used are copied from a sites row that
  -- has already passed its own checks, so they are not re-validated here.
  constraint expected_daily_kwh_non_negative check (expected_kwh >= 0)
);

-- Production the operator reported. Re-importing a date overwrites it; source_file
-- and sync_run_id record which import the surviving figure came from.
create table actual_daily (
  site_id     uuid           not null references sites (id) on delete cascade,
  date        date           not null,
  actual_kwh  numeric(12, 3) not null,
  source_file text           not null,
  sync_run_id uuid           not null references sync_runs (id),
  imported_at timestamptz    not null default now(),

  primary key (site_id, date),
  constraint actual_daily_kwh_non_negative check (actual_kwh >= 0),
  constraint actual_daily_source_file_not_blank check (length(trim(source_file)) > 0)
);

-- Rejected input rows. No row from an import is ever discarded without landing
-- here first, carrying a machine-readable reason and the payload it came from.
--
-- site_id is nullable on purpose: the commonest rejection is a row whose site
-- could not be resolved, and requiring one would make that case unrecordable.
-- There is no unique key either, since two identical bad rows are two facts.
create table quarantine (
  id                uuid        primary key default gen_random_uuid(),
  sync_run_id       uuid        not null references sync_runs (id) on delete cascade,
  site_id           uuid        references sites (id) on delete set null,
  source_row_number integer     not null,
  reason_code       text        not null,
  reason_detail     text,
  raw_payload       jsonb       not null,
  created_at        timestamptz not null default now(),

  constraint quarantine_source_row_number_positive check (source_row_number > 0),
  constraint quarantine_reason_known check (
    reason_code in (
      'missing_column',
      'unparseable_date',
      'non_numeric_value',
      'negative_value',
      'unknown_site',
      'duplicate_in_file'
    )
  )
);

-- The dashboard opens on the most recent run.
create index sync_runs_started_at_idx on sync_runs (started_at desc);

-- Drilling from a run into the rows it rejected.
create index quarantine_sync_run_id_idx on quarantine (sync_run_id);
