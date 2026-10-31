-- Roofing CRM schema (Postgres)
--
-- Originally SQLite; moved to Postgres so this can run as a real hosted
-- service (see the big comment at the top of db.js for why). Every column
-- that used to get bolted on later via an ALTER TABLE migration in db.js
-- (itb_id, project_name, location, notes, email_sent, bid_id on documents,
-- weight2, market, ...) is just part of the table from the start here,
-- since this is a brand-new database, not an upgrade of an old one.
--
-- Every date/time value in this app (due_date, delivered_date, created_at,
-- updated_at, ...) is still a plain TEXT column holding a 'YYYY-MM-DD' or
-- 'YYYY-MM-DD HH:MM:SS' string, exactly like it was under SQLite -- not a
-- real Postgres DATE/TIMESTAMP type. That's deliberate: the whole app
-- compares, sorts, and formats these as strings, so changing the storage
-- type would mean touching every one of those call sites. See db.js's
-- query-translation comment for how datetime('now')/strftime()/date()
-- calls still work against these TEXT columns.

CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  record_type   TEXT NOT NULL DEFAULT 'lead' CHECK (record_type IN ('lead','customer')),
  stage         TEXT NOT NULL DEFAULT 'new',
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  company_name  TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  city          TEXT DEFAULT '',
  state         TEXT DEFAULT '',
  zip           TEXT DEFAULT '',
  branch        TEXT DEFAULT '',
  source        TEXT DEFAULT '',
  assigned_to   TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  market        TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_customers_record_type ON customers(record_type);
CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state);
CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch);

-- Logins. role='manager' sees everything; role='rep' is scoped to one
-- person's own book of business, matched by rep_label against the Sales Rep
-- picklist / a bid's own Estimator (or its customer's assigned_to as a
-- fallback) / an ITB's assigned_to. rep_label is '' for managers (unused).
-- market is which territory (AZ/CA) this login's dashboard defaults to.
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('manager','rep')),
  rep_label       TEXT NOT NULL DEFAULT '',
  market          TEXT DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  label         TEXT DEFAULT '',
  key_hash      TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  last_used_at  TEXT
);

-- Configurable dropdown lists (Contract Type, Vertical Market, Roof Type,
-- Sales Status, Estimator, Sales Rep). "weight" means different things per
-- list: forecast days for contract_type, win probability % for sales_status,
-- and is unused (NULL) for the others. weight2 is a second number, currently
-- only used for contract_type's follow-up cadence (days).
CREATE TABLE IF NOT EXISTS picklists (
  id            SERIAL PRIMARY KEY,
  list_key      TEXT NOT NULL,
  label         TEXT NOT NULL,
  weight        DOUBLE PRECISION,
  weight2       DOUBLE PRECISION,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE(list_key, label)
);

CREATE INDEX IF NOT EXISTS idx_picklists_list_key ON picklists(list_key);

-- Invitation to Bid: a project you've been invited to bid, tracked from the
-- moment it comes in until you either submit a priced Bid for it or decline.
-- Lives earlier in the funnel than a Bid, which is why it's a separate table.
CREATE TABLE IF NOT EXISTS itbs (
  id                  SERIAL PRIMARY KEY,
  project_name        TEXT NOT NULL,
  location            TEXT DEFAULT '',
  due_date            TEXT NOT NULL,
  received_date       TEXT DEFAULT '',
  status              TEXT DEFAULT 'New',
  assigned_to         TEXT DEFAULT '',
  contract_type       TEXT DEFAULT '',
  vertical_market     TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  market              TEXT DEFAULT '',
  source_subject      TEXT DEFAULT '',
  source_from         TEXT DEFAULT '',
  source_received_at  TEXT DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at          TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_itbs_due_date ON itbs(due_date);
CREATE INDEX IF NOT EXISTS idx_itbs_status ON itbs(status);
CREATE INDEX IF NOT EXISTS idx_itbs_assigned_to ON itbs(assigned_to);

-- A bid is the pricing/estimate record for a specific job opportunity.
-- customer_id is nullable -- a project can be started before a customer is
-- known. itb_id links back to the ITB it was converted from, if any.
CREATE TABLE IF NOT EXISTS bids (
  id                    SERIAL PRIMARY KEY,
  customer_id           INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  itb_id                INTEGER REFERENCES itbs(id),
  project_name          TEXT DEFAULT '',
  location              TEXT DEFAULT '',
  price                 DOUBLE PRECISION,
  gm_percent            DOUBLE PRECISION,
  sales_status          TEXT DEFAULT '',
  estimator             TEXT DEFAULT '',
  contract_type         TEXT DEFAULT '',
  vertical_market       TEXT DEFAULT '',
  roof_type             TEXT DEFAULT '',
  squares               DOUBLE PRECISION,
  market                TEXT DEFAULT '',
  delivered_date        TEXT DEFAULT '',
  next_follow_up_date   TEXT DEFAULT '',
  notes                 TEXT DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at            TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_bids_customer_id ON bids(customer_id);
CREATE INDEX IF NOT EXISTS idx_bids_sales_status ON bids(sales_status);
CREATE INDEX IF NOT EXISTS idx_bids_delivered_date ON bids(delivered_date);

-- Extra customers linked to a bid beyond its primary customer_id -- used for
-- New Construction projects that involve more than one customer/stakeholder.
CREATE TABLE IF NOT EXISTS bid_customers (
  id            SERIAL PRIMARY KEY,
  bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(bid_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_customers_bid_id ON bid_customers(bid_id);
CREATE INDEX IF NOT EXISTS idx_bid_customers_customer_id ON bid_customers(customer_id);

-- Customers/GCs bidding an ITB's project -- many-to-many since the same
-- project is often shopped through more than one general contractor at once.
CREATE TABLE IF NOT EXISTS itb_customers (
  id            SERIAL PRIMARY KEY,
  itb_id        INTEGER NOT NULL REFERENCES itbs(id) ON DELETE CASCADE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(itb_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_itb_customers_itb_id ON itb_customers(itb_id);
CREATE INDEX IF NOT EXISTS idx_itb_customers_customer_id ON itb_customers(customer_id);

-- Raw email files (.msg/.eml/etc) dropped onto an ITB -- e.g. one per GC when
-- more than one invites you to bid the same project. Stored on disk under
-- data/attachments/ (see task #17 -- this still needs to move to real cloud
-- storage before this survives a redeploy); this table just indexes them.
CREATE TABLE IF NOT EXISTS itb_attachments (
  id              SERIAL PRIMARY KEY,
  itb_id          INTEGER NOT NULL REFERENCES itbs(id) ON DELETE CASCADE,
  stored_filename TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  content_type    TEXT DEFAULT 'application/octet-stream',
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_itb_attachments_itb_id ON itb_attachments(itb_id);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  bid_id        INTEGER REFERENCES bids(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  due_date      TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  assigned_to   TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  email_sent    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_bid_id ON tasks(bid_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  bid_id        INTEGER REFERENCES bids(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  doc_type      TEXT DEFAULT 'other',
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_bid_id ON documents(bid_id);

-- Overrides the default forecast days (from the contract_type picklist's
-- weight) for a specific contract type + vertical market combination.
-- No row for a combination means "use the contract type's default days".
CREATE TABLE IF NOT EXISTS close_day_rules (
  id                SERIAL PRIMARY KEY,
  contract_type     TEXT NOT NULL,
  vertical_market   TEXT NOT NULL,
  days              DOUBLE PRECISION NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE(contract_type, vertical_market)
);
