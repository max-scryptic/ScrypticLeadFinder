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
-- Current officers and persons with significant control, and the capital and
-- resolution filings that tell a first funding round from a later one. Written
-- by src/collectors/company-history.ts; null until fetched, and left null for
-- companies the lead rules exclude anyway.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS officers jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pscs jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS filings jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS history_version smallint;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS history_fetched_at timestamptz;

-- Company names from sources without a company number (grant records), and the
-- number Companies House has registered under exactly that name. A null
-- company_number means no exact match was found when last searched.
CREATE TABLE IF NOT EXISTS company_name_matches (
  name           text PRIMARY KEY,
  company_number text,
  searched_at    timestamptz NOT NULL DEFAULT now()
);

-- Each lead company's website, found by guessing domains from its name and
-- then by a Brave web search. A site only counts when one of its pages shows
-- the company number or the registered name with "Ltd" or "Limited". A null
-- url means none was found when last checked. Written by
-- src/collectors/company-websites.ts.
CREATE TABLE IF NOT EXISTS company_websites (
  company_number text PRIMARY KEY,
  url            text,
  -- How the site was found: "guess" or "search".
  method         text,
  -- What proved it is the company's: "company-number" or "registered-name".
  evidence       text,
  title          text,
  -- Visible text of the pages read, kept for judging whether the company needs an app.
  page_text      text,
  finder_version smallint    NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now(),
  -- When the company was last searched for on Brave, to stay within the monthly allowance.
  searched_at    timestamptz
);

CREATE INDEX IF NOT EXISTS company_websites_searched_idx ON company_websites (searched_at);

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
