-- Idempotent schema. Apply with `npm run db:migrate`.

-- One row per lead signal a collector found: a share allotment, a grant award, ...
CREATE TABLE IF NOT EXISTS signals (
  id            bigserial PRIMARY KEY,
  source_id     text        NOT NULL,
  -- Stable id from the upstream system, so re-fetching the same item updates it.
  external_id   text        NOT NULL,
  company_name  text,
  company_number text,
  title         text        NOT NULL,
  summary       text,
  amount        numeric,
  currency      text,
  -- When the event happened upstream (filing date, grant start date).
  occurred_on   date,
  url           text,
  data          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS signals_source_seen_idx ON signals (source_id, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS signals_source_occurred_idx ON signals (source_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS signals_company_number_idx ON signals (company_number);

-- Companies House profiles, cached so each company is fetched once.
CREATE TABLE IF NOT EXISTS companies (
  company_number   text PRIMARY KEY,
  name             text,
  status           text,
  type             text,
  date_of_creation date,
  sic_codes        text[] NOT NULL DEFAULT '{}',
  locality         text,
  postcode         text,
  -- False when Companies House returned 404 for the number.
  found            boolean NOT NULL DEFAULT true,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);

-- Columns added after the table was first created.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS accounts_type text;
-- Which version of the enrichment code wrote the row; older rows are fetched again.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_version smallint NOT NULL DEFAULT 1;

-- Company names from sources without a company number (grant records), and the
-- number Companies House has registered under exactly that name. A null
-- company_number means no exact match was found when last searched.
CREATE TABLE IF NOT EXISTS company_name_matches (
  name           text PRIMARY KEY,
  company_number text,
  searched_at    timestamptz NOT NULL DEFAULT now()
);

-- Triage status of a lead. lead_key is the company number, or 'name:' plus the
-- company name for a lead not matched to Companies House. Leads without a row
-- are new.
CREATE TABLE IF NOT EXISTS lead_status (
  lead_key   text PRIMARY KEY,
  status     text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per collector run, from the cron job or the "Run now" button.
CREATE TABLE IF NOT EXISTS collector_runs (
  id          bigserial PRIMARY KEY,
  source_id   text        NOT NULL,
  trigger     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'running',
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  items_seen  integer     NOT NULL DEFAULT 0,
  items_new   integer     NOT NULL DEFAULT 0,
  message     text,
  stats       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS collector_runs_source_idx ON collector_runs (source_id, started_at DESC);

-- Per-collector cursor, such as the Companies House stream timepoint.
CREATE TABLE IF NOT EXISTS collector_state (
  source_id  text PRIMARY KEY,
  state      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
