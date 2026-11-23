-- ============================================================
-- CISTERN — MASTER DATABASE SCHEMA
-- Version 1.0
-- Every table maps directly to the 48-feature architecture
-- Built on: Friedman, Modigliani, Thaler, Kahneman, Maslow, Keynes, Simon
-- ============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- TABLE 1: user_profile
-- The financial identity of the user. One row, always.
-- Drives: life stage calibration, adaptive dashboard, AI tone
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profile (
    id                      INTEGER PRIMARY KEY DEFAULT 1,
    name                    TEXT NOT NULL DEFAULT 'Sricharan',
    life_stage              TEXT NOT NULL DEFAULT 'student'
                            CHECK(life_stage IN ('student','intern','early_career',
                                                 'mid_career','freelance','other')),
    currency                TEXT NOT NULL DEFAULT 'INR',
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- Survival floor (Maslow base) — user defines their non-negotiable monthly minimum
    survival_floor_amount   REAL NOT NULL DEFAULT 0,
    
    -- Financial floor (AI-computed, updated each cycle)
    -- 1=Survival, 2=Stability, 3=Growth, 4=Wealth
    current_floor           INTEGER NOT NULL DEFAULT 1,
    
    -- Cycle definition — not everyone is monthly
    cycle_type              TEXT NOT NULL DEFAULT 'monthly'
                            CHECK(cycle_type IN ('weekly','fortnightly','monthly','irregular')),
    cycle_start_day         INTEGER DEFAULT 1, -- day of month, if monthly
    
    -- Behavioral fingerprint (AI-computed, updated each cycle)
    mpc                     REAL DEFAULT NULL,   -- marginal propensity to consume
    self_investment_ratio   REAL DEFAULT NULL,   -- fraction spent on self-investment
    consistency_score       REAL DEFAULT NULL    -- intention vs reality accuracy
);

-- Seed the profile immediately on first run
INSERT OR IGNORE INTO user_profile (id) VALUES (1);


-- ============================================================
-- TABLE 2: income_sources
-- Every source of money has its own identity and reliability record
-- Drives: source-DNA tagging, source reliability scoring, source evolution chart
-- ============================================================
CREATE TABLE IF NOT EXISTS income_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,               -- "Pocket money from Amma", "Freelance gig"
    source_type     TEXT NOT NULL
                    CHECK(source_type IN ('pocket_money','stipend','freelance',
                                         'scholarship','gift','asset_sale',
                                         'salary','other')),
    entity          TEXT,                        -- person or organisation name
    is_recurring    INTEGER NOT NULL DEFAULT 0,  -- 0=one-time, 1=recurring
    expected_amount REAL DEFAULT NULL,           -- what you expect each cycle
    expected_day    INTEGER DEFAULT NULL,        -- which day of cycle it usually arrives
    
    -- AI-computed reliability metrics
    reliability_score       REAL DEFAULT NULL,   -- 0.0 to 1.0
    avg_actual_amount       REAL DEFAULT NULL,
    arrival_consistency     REAL DEFAULT NULL,   -- did it come when expected?
    
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT
);


-- ============================================================
-- TABLE 3: buckets
-- Thaler's mental accounting — named containers for money
-- Drives: bucket system, bucket archaeology, ghost bucket detector
-- ============================================================
CREATE TABLE IF NOT EXISTS buckets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,               -- "Hostel life", "Food", "Books"
    description     TEXT,
    
    -- Liquidity rule — friction by design
    liquidity       TEXT NOT NULL DEFAULT 'flexible'
                    CHECK(liquidity IN ('locked','flexible','overflow')),
    
    -- Allocation per cycle (amount or percentage)
    alloc_type      TEXT NOT NULL DEFAULT 'amount'
                    CHECK(alloc_type IN ('amount','percentage')),
    alloc_value     REAL NOT NULL DEFAULT 0,
    
    -- Current state (updated on each transaction)
    current_balance REAL NOT NULL DEFAULT 0,
    
    -- Maslow necessity tier this bucket primarily serves
    necessity_tier  TEXT NOT NULL DEFAULT 'comfort'
                    CHECK(necessity_tier IN ('survival','comfort','aspiration','investment')),
    
    display_order   INTEGER DEFAULT 0,
    color           TEXT DEFAULT '#4A90D9',      -- hex color for UI
    icon            TEXT DEFAULT 'wallet',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 4: bucket_history
-- The biography of every bucket across every cycle
-- Drives: bucket archaeology — unique feature, no other app has this
-- ============================================================
CREATE TABLE IF NOT EXISTS bucket_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id       INTEGER NOT NULL REFERENCES buckets(id),
    cycle_id        INTEGER NOT NULL,            -- references cycles table
    
    allocated       REAL NOT NULL DEFAULT 0,
    spent           REAL NOT NULL DEFAULT 0,
    surplus         REAL NOT NULL DEFAULT 0,     -- allocated - spent
    
    -- streak tracking
    was_over_budget INTEGER NOT NULL DEFAULT 0,  -- 0=no, 1=yes
    
    recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 5: cycles
-- The replenishment rhythm — not necessarily monthly
-- Drives: irregular cycle reset, period comparison, MPC computation
-- ============================================================
CREATE TABLE IF NOT EXISTS cycles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL,               -- "June 2026", "Cycle 12"
    start_date      TEXT NOT NULL,
    end_date        TEXT,                        -- NULL if current cycle
    is_current      INTEGER NOT NULL DEFAULT 0,
    
    -- Declared intentions at cycle start (intention vs reality tracker)
    intended_budget TEXT DEFAULT NULL,           -- JSON: {bucket_id: amount}
    
    -- Cycle-end computed metrics
    total_income    REAL DEFAULT 0,
    total_expense   REAL DEFAULT 0,
    net_position    REAL DEFAULT 0,              -- income - expense
    mpc_this_cycle  REAL DEFAULT NULL,
    floor_at_end    INTEGER DEFAULT NULL,
    
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 6: transactions
-- The heartbeat of the entire system — every rupee tracked
-- Drives: entry engine, all analytics, AI behavioral modeling
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Core fields
    type                TEXT NOT NULL
                        CHECK(type IN ('income','expense','transfer')),
    amount              REAL NOT NULL CHECK(amount > 0),
    date                TEXT NOT NULL DEFAULT (date('now')),
    time                TEXT DEFAULT (time('now')),
    
    -- Source DNA (income) / Destination taxonomy (expense)
    source_id           INTEGER REFERENCES income_sources(id), -- for income
    bucket_id           INTEGER REFERENCES buckets(id),        -- for expense
    category            TEXT NOT NULL,
    subcategory         TEXT,
    
    -- The three-tier classification (Maslow)
    necessity_tier      TEXT NOT NULL DEFAULT 'comfort'
                        CHECK(necessity_tier IN ('survival','comfort',
                                                  'aspiration','investment')),
    
    -- Was this planned or impulse?
    was_planned         INTEGER NOT NULL DEFAULT 1,  -- 0=impulse, 1=planned
    
    -- Emotional state at time of purchase (optional, behavioral AI feed)
    emotional_state     TEXT CHECK(emotional_state IN 
                        ('neutral','happy','stressed','bored',
                         'celebratory','pressured',NULL)),
    
    -- Entry method
    entry_method        TEXT DEFAULT 'manual'
                        CHECK(entry_method IN ('manual','voice','import','recurring')),
    
    -- Split transaction support
    is_split            INTEGER NOT NULL DEFAULT 0,
    split_parent_id     INTEGER REFERENCES transactions(id),
    
    -- Cycle linkage
    cycle_id            INTEGER REFERENCES cycles(id),
    
    -- Bank reconciliation
    is_reconciled       INTEGER NOT NULL DEFAULT 0,
    bank_ref            TEXT,                    -- reference from bank statement
    
    description         TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT NULL
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_bucket ON transactions(bucket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cycle ON transactions(cycle_id);
CREATE INDEX IF NOT EXISTS idx_transactions_necessity ON transactions(necessity_tier);


-- ============================================================
-- TABLE 7: recurring_templates
-- Pre-saved entries for things that repeat
-- Drives: recurring template system, missed entry nudges
-- ============================================================
CREATE TABLE IF NOT EXISTS recurring_templates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,               -- "Hostel fee", "Pocket money"
    type            TEXT NOT NULL CHECK(type IN ('income','expense')),
    amount          REAL NOT NULL,
    source_id       INTEGER REFERENCES income_sources(id),
    bucket_id       INTEGER REFERENCES buckets(id),
    category        TEXT NOT NULL,
    necessity_tier  TEXT NOT NULL DEFAULT 'comfort',
    
    -- When does this usually happen?
    frequency       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK(frequency IN ('daily','weekly','fortnightly','monthly')),
    expected_day    INTEGER,                     -- day of month
    
    last_logged     TEXT DEFAULT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 8: savings_targets
-- Named goals with progress tracking
-- Drives: savings targets, milestone system
-- ============================================================
CREATE TABLE IF NOT EXISTS savings_targets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,               -- "Emergency fund", "New SSD"
    target_amount   REAL NOT NULL,
    current_amount  REAL NOT NULL DEFAULT 0,
    deadline        TEXT DEFAULT NULL,
    
    priority        INTEGER DEFAULT 1,           -- 1=highest
    is_completed    INTEGER NOT NULL DEFAULT 0,
    completed_at    TEXT DEFAULT NULL,
    
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 9: ai_insights
-- Every AI-generated insight, nudge, letter stored locally
-- Drives: weekly financial letter, contextual insight cards, loss-framed nudges
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_insights (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL
                    CHECK(type IN ('weekly_letter','nudge','anomaly',
                                   'pattern','projection','milestone',
                                   'conflict','opportunity_cost')),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,               -- full AI-generated text
    
    -- What triggered this insight
    trigger_metric  TEXT,                        -- "food_bucket_overspend"
    trigger_value   REAL,
    
    -- Was it read / dismissed?
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_dismissed    INTEGER NOT NULL DEFAULT 0,
    
    cycle_id        INTEGER REFERENCES cycles(id),
    generated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 10: milestones
-- Immutable financial autobiography — significant events
-- Drives: milestone system, ledger memory, life stage timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS milestones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL
                    CHECK(type IN ('auto','manual')),
    category        TEXT NOT NULL
                    CHECK(category IN ('savings','floor_change','budget',
                                       'income','behavior','life_event')),
    title           TEXT NOT NULL,
    description     TEXT,
    
    -- The number behind the milestone
    metric_value    REAL DEFAULT NULL,
    
    -- Life stage at time of milestone
    life_stage      TEXT,
    floor_at_time   INTEGER,
    
    occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
    is_pinned       INTEGER NOT NULL DEFAULT 0   -- user can pin important ones
);


-- ============================================================
-- TABLE 11: bank_anchors
-- Manual balance reconciliation points
-- Drives: bank account balance anchor, discrepancy detection
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_anchors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actual_balance  REAL NOT NULL,               -- what the bank actually shows
    ledger_balance  REAL NOT NULL,               -- what Cistern computed
    discrepancy     REAL NOT NULL,               -- difference
    note            TEXT,
    anchored_at     TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- TABLE 12: scenario_simulations
-- "What if" runs stored for reference
-- Drives: scenario simulator
-- ============================================================
CREATE TABLE IF NOT EXISTS scenario_simulations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL,               -- "If I cut food by 20%"
    description     TEXT,
    
    -- The simulation parameters (JSON)
    parameters      TEXT NOT NULL,               -- JSON: changes applied
    
    -- The result
    baseline_projection     REAL,               -- end balance without change
    simulated_projection    REAL,               -- end balance with change
    delta                   REAL,               -- difference
    
    -- Full AI narrative result
    narrative       TEXT,
    
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- VIEWS — pre-built queries for the most common AI and UI needs
-- ============================================================

-- Current cycle summary
CREATE VIEW IF NOT EXISTS v_current_cycle AS
SELECT 
    c.id,
    c.label,
    c.start_date,
    COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END), 0) AS net_position
FROM cycles c
LEFT JOIN transactions t ON t.cycle_id = c.id
WHERE c.is_current = 1
GROUP BY c.id;

-- Spend by necessity tier this cycle
CREATE VIEW IF NOT EXISTS v_necessity_breakdown AS
SELECT
    necessity_tier,
    COUNT(*) AS transaction_count,
    SUM(amount) AS total_spent,
    ROUND(SUM(amount) * 100.0 / (SELECT SUM(amount) FROM transactions 
          WHERE type='expense' AND cycle_id = 
          (SELECT id FROM cycles WHERE is_current=1)), 1) AS percentage
FROM transactions
WHERE type = 'expense'
AND cycle_id = (SELECT id FROM cycles WHERE is_current = 1)
GROUP BY necessity_tier;

-- Running net worth (Modigliani's curve)
CREATE VIEW IF NOT EXISTS v_net_worth_curve AS
SELECT
    date,
    SUM(CASE WHEN type='income' THEN amount ELSE -amount END) 
        OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) AS running_net_worth
FROM transactions
ORDER BY date;

-- Bucket health dashboard
CREATE VIEW IF NOT EXISTS v_bucket_health AS
SELECT
    b.id,
    b.name,
    b.liquidity,
    b.necessity_tier,
    b.alloc_value AS allocated,
    b.current_balance,
    COALESCE(SUM(t.amount), 0) AS spent_this_cycle,
    b.alloc_value - COALESCE(SUM(t.amount), 0) AS remaining,
    CASE 
        WHEN b.alloc_value = 0 THEN 0
        ELSE ROUND(COALESCE(SUM(t.amount), 0) * 100.0 / b.alloc_value, 1)
    END AS pct_used
FROM buckets b
LEFT JOIN transactions t ON t.bucket_id = b.id 
    AND t.type = 'expense'
    AND t.cycle_id = (SELECT id FROM cycles WHERE is_current = 1)
WHERE b.is_active = 1
GROUP BY b.id
ORDER BY b.display_order;

CREATE TABLE IF NOT EXISTS planning_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    locked_amount   REAL NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS planned_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          INTEGER NOT NULL REFERENCES planning_sessions(id),
    item_type           TEXT NOT NULL CHECK(item_type IN ('income','expense')),
    label               TEXT NOT NULL,
    amount              REAL NOT NULL,
    planned_date        TEXT NOT NULL,
    emergency_fund_pct  REAL DEFAULT NULL,
    linked_target_id    INTEGER REFERENCES savings_targets(id),
    priority            INTEGER DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sealed_reserves (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL,
    amount          REAL NOT NULL,
    is_released     INTEGER NOT NULL DEFAULT 0,
    sealed_at       TEXT NOT NULL DEFAULT (datetime('now')),
    released_at     TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS loans (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    label                   TEXT NOT NULL,
    principal               REAL NOT NULL,
    repayment_per_cycle     REAL NOT NULL,
    total_repaid            REAL NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','repaid','defaulted')),
    taken_date              TEXT NOT NULL DEFAULT (date('now')),
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS savings_contributions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id       INTEGER NOT NULL REFERENCES savings_targets(id),
    amount          REAL NOT NULL,
    date            TEXT NOT NULL DEFAULT (date('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);