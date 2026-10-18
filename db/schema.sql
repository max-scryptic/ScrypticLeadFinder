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
