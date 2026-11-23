// Cistern — main.rs (Tauri v2 compatible)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod crypto;
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};


struct DbState(Mutex<Option<Connection>>);

// ============================================================
// DATA STRUCTS
// ============================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Transaction {
    pub id: Option<i64>,
    pub transaction_type: String,
    pub amount: f64,
    pub date: String,
    pub time: Option<String>,
    pub source_id: Option<i64>,
    pub bucket_id: Option<i64>,
    pub category: String,
    pub subcategory: Option<String>,
    pub necessity_tier: String,
    pub was_planned: bool,
    pub emotional_state: Option<String>,
    pub entry_method: String,
    pub is_split: bool,
    pub split_parent_id: Option<i64>,
    pub cycle_id: Option<i64>,
    pub description: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Bucket {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub liquidity: String,
    pub alloc_type: String,
    pub alloc_value: f64,
    pub current_balance: f64,
    pub necessity_tier: String,
    pub display_order: i64,
    pub color: String,
    pub icon: String,
    pub is_active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IncomeSource {
    pub id: Option<i64>,
    pub name: String,
    pub source_type: String,
    pub entity: Option<String>,
    pub is_recurring: bool,
    pub expected_amount: Option<f64>,
    pub expected_day: Option<i64>,
    pub reliability_score: Option<f64>,
    pub is_active: bool,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserProfile {
    pub id: i64,
    pub name: String,
    pub life_stage: String,
    pub currency: String,
    pub survival_floor_amount: f64,
    pub current_floor: i64,
    pub cycle_type: String,
    pub mpc: Option<f64>,
    pub self_investment_ratio: Option<f64>,
    pub consistency_score: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BucketHealth {
    pub id: i64,
    pub name: String,
    pub liquidity: String,
    pub necessity_tier: String,
    pub allocated: f64,
    pub current_balance: f64,
    pub spent_this_cycle: f64,
    pub remaining: f64,
    pub pct_used: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Vitals {
    pub current_balance: f64,
    pub days_of_runway: f64,
    pub current_floor: i64,
    pub survival_floor_amount: f64,
    pub cycle_label: String,
    pub total_income: f64,
    pub total_expense: f64,
    pub net_position: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiInsight {
    pub id: Option<i64>,
    pub insight_type: String,
    pub title: String,
    pub body: String,
    pub trigger_metric: Option<String>,
    pub trigger_value: Option<f64>,
    pub is_read: bool,
    pub is_dismissed: bool,
    pub generated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Milestone {
    pub id: Option<i64>,
    pub milestone_type: String,
    pub category: String,
    pub title: String,
    pub description: Option<String>,
    pub metric_value: Option<f64>,
    pub life_stage: Option<String>,
    pub floor_at_time: Option<i64>,
    pub occurred_at: String,
    pub is_pinned: bool,
}

// ============================================================
// DATABASE INIT
// ============================================================
fn finalize_db(conn: &Connection) -> SqlResult<()> {
    let schema = include_str!("../db/schema.sql");
    conn.execute_batch(schema)?;
    ensure_current_cycle(conn)?;
    let _ = conn.execute("ALTER TABLE cycles ADD COLUMN accuracy_score REAL DEFAULT NULL", []);
    let _ = conn.execute("ALTER TABLE planning_sessions ADD COLUMN parent_session_id INTEGER REFERENCES planning_sessions(id) DEFAULT NULL", []);
    let _ = conn.execute("ALTER TABLE transactions ADD COLUMN fund TEXT NOT NULL DEFAULT 'regular'", []);
    Ok(())
}

fn ensure_current_cycle(conn: &Connection) -> SqlResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cycles WHERE is_current = 1",
        [],
        |row| row.get(0),
    )?;
    if count == 0 {
        let now = chrono::Local::now();
        let label = now.format("%B %Y").to_string();
        let start = now.format("%Y-%m-%d").to_string();
        conn.execute(
            "INSERT INTO cycles (label, start_date, is_current) VALUES (?1, ?2, 1)",
            rusqlite::params![label, start],
        )?;
    }
    Ok(())
}

// ============================================================
// TAURI COMMANDS
// ============================================================

#[tauri::command]
fn get_vitals(state: State<DbState>) -> Result<Vitals, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    if let Ok(current_cycle_id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ) {
        let _ = update_cycle_totals(&conn, current_cycle_id);
    }
    let status = compute_floor_status(&conn);
    let survival_floor = status["survival_floor"].as_f64().unwrap_or(0.0);
    let current_floor = status["floor"].as_i64().unwrap_or(1);

    let (cycle_label, total_income, total_expense, net_position): (String, f64, f64, f64) = conn
        .query_row(
            "SELECT label, COALESCE(total_income,0), COALESCE(total_expense,0), COALESCE(net_position,0)
             FROM cycles WHERE is_current = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap_or(("No cycle".to_string(), 0.0, 0.0, 0.0));

    let ledger_balance: f64 = conn
    .query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
         FROM transactions WHERE fund='regular'",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0.0);
    let sealed_total: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM sealed_reserves WHERE is_released=0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0.0);
    let current_balance = ledger_balance - sealed_total;

    let daily_floor = if survival_floor > 0.0 { survival_floor / 30.0 } else { 1.0 };
    let days_of_runway = if current_balance > 0.0 { current_balance / daily_floor } else { 0.0 };

    Ok(Vitals {
        current_balance,
        days_of_runway,
        current_floor,
        survival_floor_amount: survival_floor,
        cycle_label,
        total_income,
        total_expense,
        net_position,
    })
}

#[tauri::command]
fn add_transaction(tx: Transaction, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let cycle_id: i64 = conn
        .query_row("SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions
         (type, amount, date, time, source_id, bucket_id, category, subcategory,
          necessity_tier, was_planned, emotional_state, entry_method,
          is_split, split_parent_id, cycle_id, description, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        rusqlite::params![
            tx.transaction_type, tx.amount, tx.date, tx.time,
            tx.source_id, tx.bucket_id, tx.category, tx.subcategory,
            tx.necessity_tier, tx.was_planned as i32, tx.emotional_state,
            tx.entry_method, tx.is_split as i32, tx.split_parent_id,
            cycle_id, tx.description, tx.notes
        ],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    if tx.transaction_type == "expense" {
        if let Some(bucket_id) = tx.bucket_id {
            conn.execute(
                "UPDATE buckets SET current_balance = current_balance - ?1 WHERE id = ?2",
                rusqlite::params![tx.amount, bucket_id],
            ).map_err(|e| e.to_string())?;
        }
    }
    Ok(id)
}

#[tauri::command]
fn get_transactions(limit: Option<i64>, state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let limit = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        "SELECT t.id, t.type, t.amount, t.date, t.category, t.subcategory,
                t.necessity_tier, t.was_planned, t.emotional_state, t.description,
                b.name as bucket_name, s.name as source_name
         FROM transactions t
         LEFT JOIN buckets b ON t.bucket_id = b.id
         LEFT JOIN income_sources s ON t.source_id = s.id
         WHERE t.fund='regular'
         ORDER BY t.date DESC, t.id DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "type": row.get::<_,String>(1)?,
            "amount": row.get::<_,f64>(2)?,
            "date": row.get::<_,String>(3)?,
            "category": row.get::<_,String>(4)?,
            "subcategory": row.get::<_,Option<String>>(5)?,
            "necessity_tier": row.get::<_,String>(6)?,
            "was_planned": row.get::<_,bool>(7)?,
            "emotional_state": row.get::<_,Option<String>>(8)?,
            "description": row.get::<_,Option<String>>(9)?,
            "bucket_name": row.get::<_,Option<String>>(10)?,
            "source_name": row.get::<_,Option<String>>(11)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn get_bucket_health(state: State<DbState>) -> Result<Vec<BucketHealth>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT b.id, b.name, b.liquidity, b.necessity_tier, b.alloc_value, b.current_balance,
                COALESCE((SELECT SUM(amount) FROM transactions
                          WHERE bucket_id = b.id AND type='expense'
                          AND cycle_id = (SELECT id FROM cycles WHERE is_current=1)), 0) as spent,
                CASE WHEN b.alloc_value = 0 THEN 0.0
                     ELSE ROUND(COALESCE((SELECT SUM(amount) FROM transactions
                                WHERE bucket_id = b.id AND type='expense'
                                AND cycle_id = (SELECT id FROM cycles WHERE is_current=1)), 0)
                                * 100.0 / b.alloc_value, 1)
                END as pct
         FROM buckets b WHERE b.is_active = 1 ORDER BY b.display_order"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let allocated: f64 = row.get(4)?;
        let spent: f64 = row.get(6)?;
        Ok(BucketHealth {
            id: row.get(0)?,
            name: row.get(1)?,
            liquidity: row.get(2)?,
            necessity_tier: row.get(3)?,
            allocated,
            current_balance: row.get(5)?,
            spent_this_cycle: spent,
            remaining: allocated - spent,
            pct_used: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn add_bucket(bucket: Bucket, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO buckets (name, description, liquidity, alloc_type, alloc_value,
          current_balance, necessity_tier, display_order, color, icon)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        rusqlite::params![
            bucket.name, bucket.description, bucket.liquidity,
            bucket.alloc_type, bucket.alloc_value, bucket.current_balance,
            bucket.necessity_tier, bucket.display_order, bucket.color, bucket.icon
        ],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_income_sources(state: State<DbState>) -> Result<Vec<IncomeSource>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, name, source_type, entity, is_recurring, expected_amount,
                expected_day, reliability_score, is_active, notes
         FROM income_sources WHERE is_active = 1 ORDER BY name"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(IncomeSource {
            id: Some(row.get(0)?),
            name: row.get(1)?,
            source_type: row.get(2)?,
            entity: row.get(3)?,
            is_recurring: row.get::<_,i32>(4)? != 0,
            expected_amount: row.get(5)?,
            expected_day: row.get(6)?,
            reliability_score: row.get(7)?,
            is_active: row.get::<_,i32>(8)? != 0,
            notes: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn add_income_source(source: IncomeSource, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO income_sources (name, source_type, entity, is_recurring,
          expected_amount, expected_day, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            source.name, source.source_type, source.entity,
            source.is_recurring as i32, source.expected_amount,
            source.expected_day, source.notes
        ],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_profile(state: State<DbState>) -> Result<UserProfile, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.query_row(
        "SELECT id, name, life_stage, currency, survival_floor_amount,
                current_floor, cycle_type, mpc, self_investment_ratio, consistency_score
         FROM user_profile WHERE id = 1",
        [],
        |row| Ok(UserProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            life_stage: row.get(2)?,
            currency: row.get(3)?,
            survival_floor_amount: row.get(4)?,
            current_floor: row.get(5)?,
            cycle_type: row.get(6)?,
            mpc: row.get(7)?,
            self_investment_ratio: row.get(8)?,
            consistency_score: row.get(9)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_survival_floor(amount: f64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE user_profile SET survival_floor_amount = ?1 WHERE id = 1",
        rusqlite::params![amount],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn query_ai(prompt: String, context: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let full_prompt = format!(
        "You are Cistern, a private offline financial AI. \
         You have the user's financial data. Be concise, honest, direct. \
         Use INR (₹). Never be preachy. The user is a student.\n\n\
         Financial context:\n{}\n\nUser question: {}",
        context, prompt
    );
    let body = serde_json::json!({
        "model": "qwen2.5:7b",
        "prompt": full_prompt,
        "stream": false
    });
    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running: {}", e))?;
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["response"].as_str().unwrap_or("No response").to_string())
}

#[tauri::command]
fn get_net_worth_curve(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    ).map_err(|e| e.to_string())?;

    let baseline_id: Option<i64> = conn.query_row(
        "SELECT value FROM app_settings WHERE key='curve_baseline_id'", [],
        |r| r.get::<_, String>(0)
    ).ok().and_then(|s| s.parse().ok());

    let mut results = Vec::new();

    if let Some(baseline_id) = baseline_id {
        let baseline_balance: f64 = conn.query_row(
            "SELECT value FROM app_settings WHERE key='curve_baseline_balance'", [],
            |r| r.get::<_, String>(0)
        ).ok().and_then(|s| s.parse().ok()).unwrap_or(0.0);
        let baseline_date: String = conn.query_row(
            "SELECT value FROM app_settings WHERE key='curve_baseline_date'", [], |r| r.get(0)
        ).unwrap_or_else(|_| chrono::Local::now().format("%Y-%m-%d").to_string());

        results.push(serde_json::json!({ "date": baseline_date, "net_worth": baseline_balance }));

        let mut stmt = conn.prepare(
            "WITH running AS (
                SELECT date, id,
                       ?2 + SUM(CASE WHEN type='income' THEN amount ELSE -amount END)
                       OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) as running_total
                FROM transactions WHERE id > ?1
             )
             SELECT date, MAX(running_total) FROM running GROUP BY date ORDER BY date"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![baseline_id, baseline_balance], |row| {
            Ok(serde_json::json!({ "date": row.get::<_,String>(0)?, "net_worth": row.get::<_,f64>(1)? }))
        }).map_err(|e| e.to_string())?;
        for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    } else {
        let mut stmt = conn.prepare(
            "WITH running AS (
                SELECT date, id,
                       SUM(CASE WHEN type='income' THEN amount ELSE -amount END)
                       OVER (ORDER BY date, id ROWS UNBOUNDED PRECEDING) as running_total
                FROM transactions
             )
             SELECT date, MAX(running_total) FROM running GROUP BY date ORDER BY date"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({ "date": row.get::<_,String>(0)?, "net_worth": row.get::<_,f64>(1)? }))
        }).map_err(|e| e.to_string())?;
        for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    }
    Ok(results)
}

#[tauri::command]
fn get_milestones(state: State<DbState>) -> Result<Vec<Milestone>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, type, category, title, description, metric_value,
                life_stage, floor_at_time, occurred_at, is_pinned
         FROM milestones ORDER BY occurred_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Milestone {
            id: Some(row.get(0)?),
            milestone_type: row.get(1)?,
            category: row.get(2)?,
            title: row.get(3)?,
            description: row.get(4)?,
            metric_value: row.get(5)?,
            life_stage: row.get(6)?,
            floor_at_time: row.get(7)?,
            occurred_at: row.get(8)?,
            is_pinned: row.get::<_,i32>(9)? != 0,
        })
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn get_unread_insights(state: State<DbState>) -> Result<Vec<AiInsight>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, type, title, body, trigger_metric, trigger_value,
                is_read, is_dismissed, generated_at
         FROM ai_insights WHERE is_dismissed = 0 ORDER BY generated_at DESC LIMIT 5"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(AiInsight {
            id: Some(row.get(0)?),
            insight_type: row.get(1)?,
            title: row.get(2)?,
            body: row.get(3)?,
            trigger_metric: row.get(4)?,
            trigger_value: row.get(5)?,
            is_read: row.get::<_,i32>(6)? != 0,
            is_dismissed: row.get::<_,i32>(7)? != 0,
            generated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn dismiss_insight(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE ai_insights SET is_dismissed = 1 WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// HELPERS
// ============================================================
fn update_cycle_totals(conn: &Connection, cycle_id: i64) -> SqlResult<()> {
    conn.execute(
        "UPDATE cycles SET
            total_income  = (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE cycle_id=?1 AND type='income' AND fund='regular'),
            total_expense = (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE cycle_id=?1 AND type='expense' AND fund='regular'),
            net_position  = (SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) FROM transactions WHERE cycle_id=?1 AND fund='regular')
         WHERE id=?1",
        rusqlite::params![cycle_id],
    )?;
    Ok(())
}

// ============================================================
// MAIN
// ============================================================
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(DbState(Mutex::new(None)));
             Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vitals,
            add_transaction,
            get_transactions,
            get_bucket_health,
            add_bucket,
            get_income_sources,
            add_income_source,
            get_profile,
            update_survival_floor,
            query_ai,
            get_net_worth_curve,
            get_milestones,
            get_unread_insights,
            dismiss_insight,
            close_cycle,
            open_new_cycle,
            get_cycle_history,
            get_floor_analysis,
            get_nudges,
            update_profile_stage,
            save_ai_message,
            get_ai_thread,
            get_ai_threads,
            create_ai_thread,
            delete_ai_thread,
            rename_ai_thread,
            add_savings_target,
            get_savings_targets,
            update_savings_target_amount,
            get_financial_identity,
            compare_cycles,
            update_transaction,
            delete_transaction,
            export_transactions_csv,
            export_transactions_json,
            backup_database,
            get_db_path,
            run_scenario,
            generate_weekly_letter,
            get_weekly_letters,
            get_mpc_trend,
            get_habit_compounds,
            generate_insight,
            get_ghost_buckets,
            get_bucket_archaeology,
            get_ledger_memory,
            add_ledger_memory,
            get_source_reliability,
            get_behavioral_patterns,
            update_bucket,
            delete_bucket,
            vault_status,
            create_vault_cmd,
            unlock_vault_cmd,
            unlock_vault_with_recovery_cmd,
            update_savings_target,
            delete_savings_target,
            set_curve_baseline,
            bulk_assign_category_to_bucket,
            set_cycle_intentions,
            get_cycle_intentions,
            create_planning_session,
            get_planning_sessions,
            delete_planning_session,
            add_planned_item,
            delete_planned_item,
            get_session_projection,
            duplicate_session_as_variant,
            compare_sessions,
            update_planned_item_date,
            materialize_planned_item,
            seal_reserve,
            get_sealed_reserves,
            unseal_reserve,
            get_emergency_fund_balance,
            get_emergency_transactions,
            add_emergency_expense,
            borrow_from_regular_to_emergency,
            add_income_with_split,
            get_session_projection_with_stress,
            save_session_as_template,
            get_intention_progress,
            get_session_templates,
            create_session_from_template,
            get_planning_calendar,
            check_loan_feasibility,
            take_loan,
            get_active_loans,
            get_loan_history,
            repay_loan_manual,
            jarvis_chat,
            get_smart_savings_suggestion,
            apply_smart_savings_allocation,
            get_multi_cycle_trend,
            add_savings_contribution,
            get_savings_contribution_log,
            add_savings_contribution,
            get_savings_contribution_log,
            delete_savings_contribution,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Cistern");
}#[tauri::command]
fn close_cycle(state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let cycle_id: i64 = conn
        .query_row("SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE cycles SET is_current = 0, end_date = ?1 WHERE id = ?2",
        rusqlite::params![today, cycle_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_new_cycle(label: String, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO cycles (label, start_date, is_current) VALUES (?1, ?2, 1)",
        rusqlite::params![label, today],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE buckets SET current_balance = alloc_value WHERE is_active = 1",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn get_cycle_history(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, label, start_date, end_date, is_current,
                COALESCE(total_income,0), COALESCE(total_expense,0), COALESCE(net_position,0),
                accuracy_score
         FROM cycles ORDER BY start_date DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "label": row.get::<_,String>(1)?,
            "start_date": row.get::<_,String>(2)?,
            "end_date": row.get::<_,Option<String>>(3)?,
            "is_current": row.get::<_,bool>(4)?,
            "total_income": row.get::<_,f64>(5)?,
            "total_expense": row.get::<_,f64>(6)?,
            "net_position": row.get::<_,f64>(7)?,
            "accuracy_score": row.get::<_,Option<f64>>(8)?
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
#[tauri::command]
fn get_floor_analysis(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let result = compute_floor_status(&conn);
    let computed_floor = result["floor"].as_i64().unwrap_or(1);
    let mpc = result["mpc"].as_f64().unwrap_or(0.0);
    conn.execute(
        "UPDATE user_profile SET current_floor=?1, mpc=?2 WHERE id=1",
        rusqlite::params![computed_floor, mpc],
    ).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
fn get_nudges(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut nudges: Vec<serde_json::Value> = Vec::new();
    let (income, expense, survival_floor): (f64, f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0),
                u.survival_floor_amount
         FROM transactions t, user_profile u
         WHERE t.cycle_id=(SELECT id FROM cycles WHERE is_current=1) AND u.id=1",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap_or((0.0, 0.0, 0.0));
    let balance: f64 = compute_available_balance(&conn);
    let mpc = if income > 0.0 { expense / income } else { 0.0 };
    if mpc > 0.9 && income > 0.0 {
        nudges.push(serde_json::json!({
            "severity": "high",
            "title": "Spending almost everything",
            "body": format!("You're on track to spend ₹{:.0} of ₹{:.0} income — leaving almost nothing. You stand to lose ₹{:.0} in savings this cycle.", expense, income, income - expense),
            "type": "mpc_warning"
        }));
    }
    if survival_floor > 0.0 && balance < survival_floor {
        nudges.push(serde_json::json!({
            "severity": "critical",
            "title": "Below survival floor",
            "body": format!("Your balance of ₹{:.0} is below your ₹{:.0}/month minimum. You could run out of funds before your next income.", balance, survival_floor),
            "type": "floor_breach"
        }));
    }
    let impulse_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE was_planned=0 AND type='expense'
         AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| row.get(0),
    ).unwrap_or(0);
    let impulse_total: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE was_planned=0 AND type='expense'
         AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| row.get(0),
    ).unwrap_or(0.0);
    if impulse_count >= 3 {
        nudges.push(serde_json::json!({
            "severity": "medium",
            "title": "Impulse pattern detected",
            "body": format!("{} unplanned expenses this cycle totalling ₹{:.0}. At this rate you'll lose ₹{:.0} to impulse spending this month.", impulse_count, impulse_total, impulse_total * 1.5),
            "type": "impulse_pattern"
        }));
    }
    // ---- Single-transaction anomaly detection ----
    let mut cat_stmt = conn.prepare(
        "SELECT id, category, amount FROM transactions
         WHERE type='expense' AND fund='regular' AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)
         ORDER BY id DESC LIMIT 5"
    ).map_err(|e| e.to_string())?;
    let recent: Vec<(i64, String, f64)> = cat_stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    for (tx_id, category, amount) in &recent {
        let (count, mean, sum_sq): (i64, f64, f64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(AVG(amount),0), COALESCE(SUM(amount*amount),0)
             FROM transactions
             WHERE type='expense' AND fund='regular' AND category=?1 AND id != ?2
             AND cycle_id != (SELECT id FROM cycles WHERE is_current=1)",
            rusqlite::params![category, tx_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).unwrap_or((0, 0.0, 0.0));

        if count >= 5 {
            let variance = (sum_sq / count as f64) - (mean * mean);
            let stddev = variance.max(0.0).sqrt();
            if stddev > 0.0 && *amount > mean + 2.0 * stddev {
                nudges.push(serde_json::json!({
                    "severity": "medium",
                    "title": format!("Unusual {} spend", category),
                    "body": format!("₹{:.0} on {} is well above your typical range (avg ₹{:.0}). Worth a second look.", amount, category, mean),
                    "type": "anomaly_transaction"
                }));
            }
        }
    }

    // ---- Pace anomaly detection ----
    let elapsed_pct = compute_cycle_elapsed_pct(&conn);

    let mut bucket_stmt = conn.prepare(
        "SELECT b.name, b.alloc_value,
                COALESCE((SELECT SUM(amount) FROM transactions
                          WHERE bucket_id=b.id AND type='expense' AND fund='regular'
                          AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)), 0)
         FROM buckets b WHERE b.is_active=1"
    ).map_err(|e| e.to_string())?;
    let bucket_rows: Vec<(String, f64, f64)> = bucket_stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    for (name, alloc, spent) in bucket_rows {
        if alloc <= 0.0 { continue; }
        let pct_used = spent / alloc;
        if pct_used - elapsed_pct > 0.30 {
            nudges.push(serde_json::json!({
                "severity": "medium",
                "title": format!("{} burning fast", name),
                "body": format!("{:.0}% of this cycle spent, but only {:.0}% through the cycle. At this pace, {} runs out early.", pct_used * 100.0, elapsed_pct * 100.0, name),
                "type": "anomaly_pace"
            }));
        }
    }
    // ---- Sunk cost detection ----
    let mut sunk_stmt = conn.prepare(
        "SELECT category, COUNT(DISTINCT cycle_id) as cycle_count, AVG(amount) as avg_amt,
                COALESCE(SUM((amount-sub.avg_amt)*(amount-sub.avg_amt)),0) / COUNT(*) as variance
         FROM transactions t,
              (SELECT category as cat, AVG(amount) as avg_amt FROM transactions
               WHERE type='expense' AND fund='regular' AND cycle_id != (SELECT id FROM cycles WHERE is_current=1)
               GROUP BY category) sub
         WHERE t.type='expense' AND t.fund='regular' AND t.category = sub.cat
         AND t.cycle_id != (SELECT id FROM cycles WHERE is_current=1)
         GROUP BY t.category HAVING cycle_count >= 2"
    ).map_err(|e| e.to_string())?;

    let recurring: Vec<(String, i64, f64, f64)> = sunk_stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    for (category, _cycle_count, avg_amt, variance) in recurring {
        if avg_amt <= 0.0 { continue; }
        let coeff_of_variation = variance.max(0.0).sqrt() / avg_amt;
        if coeff_of_variation > 0.15 { continue; } // not consistent enough to look subscription-like

        let (recent_count, aspiration_or_impulse_count): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN necessity_tier='aspiration' OR was_planned=0 THEN 1 ELSE 0 END)
             FROM transactions WHERE type='expense' AND fund='regular' AND category=?1
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            rusqlite::params![category], |r| Ok((r.get(0)?, r.get(1)?))
        ).unwrap_or((0, 0));

        if recent_count > 0 && aspiration_or_impulse_count * 2 >= recent_count {
            nudges.push(serde_json::json!({
                "severity": "medium",
                "title": format!("Still worth it? {}", category),
                "body": format!("This has been a consistent ~₹{:.0} spend across cycles, but recently it's showing up as low-priority or unplanned. Worth reconsidering if it's still earning its place.", avg_amt),
                "type": "sunk_cost"
            }));
        }
    }
    Ok(nudges)
}

#[tauri::command]
fn update_profile_stage(life_stage: String, survival_floor: f64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE user_profile SET life_stage=?1, survival_floor_amount=?2 WHERE id=1",
        rusqlite::params![life_stage, survival_floor],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn create_ai_thread(name: String, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_active TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_threads (name) VALUES (?1)",
        rusqlite::params![name],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_ai_threads(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_active TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    ).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, last_active FROM ai_threads ORDER BY last_active DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "name": row.get::<_,String>(1)?,
            "created_at": row.get::<_,String>(2)?,
            "last_active": row.get::<_,String>(3)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn save_ai_message(thread_id: i64, role: String, content: String, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )",
        [],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_messages (thread_id, role, content) VALUES (?1, ?2, ?3)",
        rusqlite::params![thread_id, role, content],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_threads SET last_active = datetime('now') WHERE id = ?1",
        rusqlite::params![thread_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_ai_thread(thread_id: i64, state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )",
        [],
    ).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT role, content, timestamp FROM ai_messages WHERE thread_id = ?1 ORDER BY id ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![thread_id], |row| {
        Ok(serde_json::json!({
            "role": row.get::<_,String>(0)?,
            "content": row.get::<_,String>(1)?,
            "timestamp": row.get::<_,String>(2)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn delete_ai_thread(thread_id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute("DELETE FROM ai_messages WHERE thread_id = ?1", rusqlite::params![thread_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_threads WHERE id = ?1", rusqlite::params![thread_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn rename_ai_thread(thread_id: i64, name: String, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE ai_threads SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, thread_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn add_savings_target(
    name: String,
    target_amount: f64,
    deadline: Option<String>,
    state: State<DbState>
) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO savings_targets (name, target_amount, deadline) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, target_amount, deadline],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_savings_targets(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, name, target_amount, current_amount, deadline, is_completed, created_at
         FROM savings_targets ORDER BY is_completed ASC, created_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let target: f64 = row.get(2)?;
        let current: f64 = row.get(3)?;
        let pct = if target > 0.0 { (current / target * 100.0).min(100.0) } else { 0.0 };
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "name": row.get::<_,String>(1)?,
            "target_amount": target,
            "current_amount": current,
            "deadline": row.get::<_,Option<String>>(4)?,
            "is_completed": row.get::<_,bool>(5)?,
            "created_at": row.get::<_,String>(6)?,
            "pct": pct,
            "remaining": target - current,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn update_savings_target_amount(
    id: i64,
    amount: f64,
    state: State<DbState>
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE savings_targets SET current_amount = current_amount + ?1,
         is_completed = CASE WHEN current_amount + ?1 >= target_amount THEN 1 ELSE 0 END
         WHERE id = ?2",
        rusqlite::params![amount, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn get_financial_identity(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    // Profile
    let (name, life_stage, survival_floor, current_floor): (String, String, f64, i64) = conn
        .query_row(
            "SELECT name, life_stage, survival_floor_amount, current_floor FROM user_profile WHERE id=1",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(|e| e.to_string())?;

    // Balance
    let balance: f64 = compute_available_balance(&conn);

    // Current cycle
    let (income, expense): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
         FROM transactions WHERE cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0.0, 0.0));

    // MPC
    let mpc = if income > 0.0 { expense / income } else { 0.0 };

    // Top spending category
    let top_category: String = conn.query_row(
        "SELECT category FROM transactions WHERE type='expense'
         AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)
         GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1",
        [], |row| row.get(0),
    ).unwrap_or("None".to_string());

    // Self investment ratio
    let self_investment: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM transactions
         WHERE type='expense' AND necessity_tier='investment'
         AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| row.get(0),
    ).unwrap_or(0.0);
    let self_investment_ratio = if expense > 0.0 { self_investment / expense } else { 0.0 };

    // Impulse ratio
    let impulse: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM transactions
         WHERE type='expense' AND was_planned=0
         AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| row.get(0),
    ).unwrap_or(0.0);
    let impulse_ratio = if expense > 0.0 { impulse / expense } else { 0.0 };

    // Total cycles completed
    let cycles_completed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cycles WHERE is_current=0",
        [], |row| row.get(0),
    ).unwrap_or(0);

    // Total transactions
    let total_tx: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions",
        [], |row| row.get(0),
    ).unwrap_or(0);

    // Runway
    let daily_floor = if survival_floor > 0.0 { survival_floor / 30.0 } else { 1.0 };
    let runway = if balance > 0.0 { balance / daily_floor } else { 0.0 };

    // Dominant necessity tier
    let dominant_tier: String = conn.query_row(
        "SELECT necessity_tier FROM transactions WHERE type='expense'
         GROUP BY necessity_tier ORDER BY SUM(amount) DESC LIMIT 1",
        [], |row| row.get(0),
    ).unwrap_or("comfort".to_string());

    // Income source count
    let source_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT source_id) FROM transactions WHERE type='income' AND source_id IS NOT NULL",
        [], |row| row.get(0),
    ).unwrap_or(0);

    Ok(serde_json::json!({
        "name": name,
        "life_stage": life_stage,
        "current_floor": current_floor,
        "floor_label": match current_floor { 1=>"Survival", 2=>"Stability", 3=>"Growth", _=>"Wealth" },
        "balance": balance,
        "runway_days": runway,
        "survival_floor": survival_floor,
        "income": income,
        "expense": expense,
        "mpc": mpc,
        "top_category": top_category,
        "self_investment_ratio": self_investment_ratio,
        "impulse_ratio": impulse_ratio,
        "cycles_completed": cycles_completed,
        "total_transactions": total_tx,
        "dominant_tier": dominant_tier,
        "source_count": source_count,
    }))
}
#[tauri::command]
fn compare_cycles(cycle_a: i64, cycle_b: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let get_cycle_stats = |cycle_id: i64| -> Result<serde_json::Value, rusqlite::Error> {
        let label: String = conn.query_row(
            "SELECT label FROM cycles WHERE id=?1", rusqlite::params![cycle_id], |r| r.get(0)
        )?;
        let (income, expense): (f64, f64) = conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
             FROM transactions WHERE cycle_id=?1",
            rusqlite::params![cycle_id], |r| Ok((r.get(0)?, r.get(1)?))
        )?;
        let mpc = if income > 0.0 { expense / income } else { 0.0 };
        let top_cat: String = conn.query_row(
            "SELECT category FROM transactions WHERE type='expense' AND cycle_id=?1
             GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1",
            rusqlite::params![cycle_id], |r| r.get(0)
        ).unwrap_or("None".to_string());
        let impulse: f64 = conn.query_row(
            "SELECT COALESCE(SUM(amount),0) FROM transactions
             WHERE type='expense' AND was_planned=0 AND cycle_id=?1",
            rusqlite::params![cycle_id], |r| r.get(0)
        ).unwrap_or(0.0);
        let tx_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transactions WHERE cycle_id=?1",
            rusqlite::params![cycle_id], |r| r.get(0)
        ).unwrap_or(0);
        Ok(serde_json::json!({
            "label": label,
            "income": income,
            "expense": expense,
            "net": income - expense,
            "mpc": mpc,
            "top_category": top_cat,
            "impulse": impulse,
            "impulse_ratio": if expense > 0.0 { impulse / expense } else { 0.0 },
            "tx_count": tx_count,
        }))
    };

    let a = get_cycle_stats(cycle_a).map_err(|e| e.to_string())?;
    let b = get_cycle_stats(cycle_b).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "a": a, "b": b }))
}
#[tauri::command]
fn update_transaction(
    id: i64,
    amount: f64,
    category: String,
    necessity_tier: String,
    was_planned: bool,
    description: Option<String>,
    state: State<DbState>
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE transactions SET amount=?1, category=?2, necessity_tier=?3,
         was_planned=?4, description=?5, updated_at=datetime('now') WHERE id=?6",
        rusqlite::params![amount, category, necessity_tier, was_planned as i32, description, id],
    ).map_err(|e| e.to_string())?;
    // Recompute cycle totals
    let cycle_id: i64 = conn.query_row(
        "SELECT cycle_id FROM transactions WHERE id=?1", rusqlite::params![id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_transaction(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let cycle_id: i64 = conn.query_row(
        "SELECT cycle_id FROM transactions WHERE id=?1", rusqlite::params![id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM transactions WHERE id=?1", rusqlite::params![id]
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn export_transactions_csv(path: String, state: State<DbState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.type, t.amount, t.date, t.category, 
                COALESCE(t.subcategory,''), t.necessity_tier,
                CASE WHEN t.was_planned=1 THEN 'planned' ELSE 'impulse' END,
                COALESCE(t.emotional_state,''),
                COALESCE(t.description,''),
                COALESCE(b.name,'') as bucket,
                COALESCE(s.name,'') as source,
                COALESCE(c.label,'') as cycle
         FROM transactions t
         LEFT JOIN buckets b ON t.bucket_id = b.id
         LEFT JOIN income_sources s ON t.source_id = s.id
         LEFT JOIN cycles c ON t.cycle_id = c.id
         ORDER BY t.date DESC, t.id DESC"
    ).map_err(|e| e.to_string())?;

    let mut csv = "id,type,amount,date,category,subcategory,necessity_tier,planned,emotional_state,description,bucket,source,cycle\n".to_string();

    let rows = stmt.query_map([], |row| {
        Ok(format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{}",
            row.get::<_,i64>(0)?,
            row.get::<_,String>(1)?,
            row.get::<_,f64>(2)?,
            row.get::<_,String>(3)?,
            row.get::<_,String>(4)?,
            row.get::<_,String>(5)?,
            row.get::<_,String>(6)?,
            row.get::<_,String>(7)?,
            row.get::<_,String>(8)?,
            row.get::<_,String>(9)?.replace(",", ";"),
            row.get::<_,String>(10)?,
            row.get::<_,String>(11)?,
            row.get::<_,String>(12)?,
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        csv.push_str(&row.map_err(|e| e.to_string())?);
        csv.push('\n');
    }

    std::fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn export_transactions_json(path: String, state: State<DbState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.type, t.amount, t.date, t.category,
                t.subcategory, t.necessity_tier, t.was_planned,
                t.emotional_state, t.description,
                b.name as bucket, s.name as source, c.label as cycle
         FROM transactions t
         LEFT JOIN buckets b ON t.bucket_id = b.id
         LEFT JOIN income_sources s ON t.source_id = s.id
         LEFT JOIN cycles c ON t.cycle_id = c.id
         ORDER BY t.date DESC, t.id DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "type": row.get::<_,String>(1)?,
            "amount": row.get::<_,f64>(2)?,
            "date": row.get::<_,String>(3)?,
            "category": row.get::<_,String>(4)?,
            "subcategory": row.get::<_,Option<String>>(5)?,
            "necessity_tier": row.get::<_,String>(6)?,
            "was_planned": row.get::<_,bool>(7)?,
            "emotional_state": row.get::<_,Option<String>>(8)?,
            "description": row.get::<_,Option<String>>(9)?,
            "bucket": row.get::<_,Option<String>>(10)?,
            "source": row.get::<_,Option<String>>(11)?,
            "cycle": row.get::<_,Option<String>>(12)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }

    let json = serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path)
}
#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cistern.db");
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn backup_database(backup_path: String, app: tauri::AppHandle) -> Result<String, String> {
    let db_path = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cistern.db");

    // Also copy WAL file if it exists
    let wal_path = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("cistern.db-wal");

    std::fs::copy(&db_path, &backup_path)
        .map_err(|e| format!("Backup failed: {}", e))?;

    // If WAL exists, checkpoint it first by opening and closing connection
    if wal_path.exists() {
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");
        }
        // Copy again after checkpoint to get complete data
        std::fs::copy(&db_path, &backup_path)
            .map_err(|e| format!("Backup failed after checkpoint: {}", e))?;
    }

    Ok(backup_path)
}
#[tauri::command]
fn run_scenario(
    cut_category: Option<String>,
    cut_percent: Option<f64>,
    extra_income: Option<f64>,
    extra_expense: Option<f64>,
    state: State<DbState>
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    // Current cycle actuals
    let (income, expense): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
         FROM transactions WHERE cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |r| Ok((r.get(0)?, r.get(1)?))
    ).unwrap_or((0.0, 0.0));

    let balance: f64 = compute_available_balance(&conn);

    let survival_floor: f64 = conn.query_row(
        "SELECT survival_floor_amount FROM user_profile WHERE id=1",
        [], |r| r.get(0)
    ).unwrap_or(0.0);

    // Category spend if cutting
    let category_spend: f64 = if let Some(ref cat) = cut_category {
        conn.query_row(
            "SELECT COALESCE(SUM(amount),0) FROM transactions
             WHERE type='expense' AND category=?1
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            rusqlite::params![cat], |r| r.get(0)
        ).unwrap_or(0.0)
    } else { 0.0 };

    // Apply scenario
    let cut_saving = if let Some(pct) = cut_percent {
        category_spend * (pct / 100.0)
    } else { 0.0 };

    let sim_expense = expense - cut_saving + extra_expense.unwrap_or(0.0);
    let sim_income = income + extra_income.unwrap_or(0.0);
    let sim_net = sim_income - sim_expense;
    let sim_balance = balance + extra_income.unwrap_or(0.0) - cut_saving - extra_expense.unwrap_or(0.0);

    let daily_floor = if survival_floor > 0.0 { survival_floor / 30.0 } else { 1.0 };
    let baseline_runway = if balance > 0.0 { balance / daily_floor } else { 0.0 };
    let sim_runway = if sim_balance > 0.0 { sim_balance / daily_floor } else { 0.0 };

    let baseline_mpc = if income > 0.0 { expense / income } else { 0.0 };
    let sim_mpc = if sim_income > 0.0 { sim_expense / sim_income } else { 0.0 };

    Ok(serde_json::json!({
        "baseline": {
            "income": income,
            "expense": expense,
            "net": income - expense,
            "balance": balance,
            "runway_days": baseline_runway,
            "mpc": baseline_mpc,
        },
        "simulated": {
            "income": sim_income,
            "expense": sim_expense,
            "net": sim_net,
            "balance": sim_balance,
            "runway_days": sim_runway,
            "mpc": sim_mpc,
        },
        "delta": {
            "expense": sim_expense - expense,
            "net": sim_net - (income - expense),
            "balance": sim_balance - balance,
            "runway_days": sim_runway - baseline_runway,
            "mpc": sim_mpc - baseline_mpc,
        },
        "category_spend": category_spend,
        "cut_saving": cut_saving,
    }))
}
#[tauri::command]
async fn generate_weekly_letter(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let context = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

        let (income, expense): (f64, f64) = conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
             FROM transactions WHERE cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            [], |r| Ok((r.get(0)?, r.get(1)?))
        ).unwrap_or((0.0, 0.0));

        let balance: f64 = compute_available_balance(&conn);

        let impulse_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transactions WHERE was_planned=0 AND type='expense'
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            [], |r| r.get(0)
        ).unwrap_or(0);

        let impulse_total: f64 = conn.query_row(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE was_planned=0 AND type='expense'
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            [], |r| r.get(0)
        ).unwrap_or(0.0);

        let top_category: String = conn.query_row(
            "SELECT category FROM transactions WHERE type='expense'
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)
             GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1",
            [], |r| r.get(0)
        ).unwrap_or("None".to_string());

        let recent_txs: String = {
            let mut stmt = conn.prepare(
                "SELECT type, amount, category, description FROM transactions
                 WHERE date >= date('now', '-7 days')
                 ORDER BY date DESC LIMIT 10"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| {
                Ok(format!("{} ₹{} on {} ({})",
                    r.get::<_,String>(0)?,
                    r.get::<_,f64>(1)?,
                    r.get::<_,String>(2)?,
                    r.get::<_,Option<String>>(3)?.unwrap_or_default()
                ))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect::<Vec<_>>().join(", ")
        };

        let mpc = if income > 0.0 { expense / income } else { 0.0 };

        format!(
            "Balance: ₹{:.0}, Income this cycle: ₹{:.0}, Spent: ₹{:.0}, MPC: {:.0}%, \
             Impulse transactions: {} totalling ₹{:.0}, Top category: {}, \
             Last 7 days transactions: {}",
            balance, income, expense, mpc * 100.0,
            impulse_count, impulse_total, top_category, recent_txs
        )
    };

    let client = reqwest::Client::new();
    let prompt = format!(
        "You are Cistern, a private financial AI. Write a short, personal, honest weekly financial letter \
         for Sricharan, a student. Be direct and specific — not generic. Reference actual numbers. \
         Notice patterns. Be honest if something looks concerning. Be encouraging if something looks good. \
         Do not be preachy. Write like a sharp, caring financial advisor who knows him personally. \
         3-4 short paragraphs maximum. No bullet points. Plain prose.\n\nFinancial data: {}",
        context
    );

    let body = serde_json::json!({
        "model": "qwen2.5:7b",
        "prompt": prompt,
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running: {}", e))?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let letter = json["response"].as_str().unwrap_or("No response").to_string();

    // Save to database
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
        conn.execute(
            "INSERT INTO ai_insights (type, title, body, cycle_id)
             VALUES ('weekly_letter', 'Weekly Financial Letter', ?1,
             (SELECT id FROM cycles WHERE is_current=1))",
            rusqlite::params![letter],
        ).map_err(|e| e.to_string())?;
    }

    Ok(letter)
}

#[tauri::command]
fn get_weekly_letters(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, title, body, generated_at FROM ai_insights
         WHERE type='weekly_letter' ORDER BY generated_at DESC LIMIT 10"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(serde_json::json!({
            "id": r.get::<_,i64>(0)?,
            "title": r.get::<_,String>(1)?,
            "body": r.get::<_,String>(2)?,
            "generated_at": r.get::<_,String>(3)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
#[tauri::command]
fn get_mpc_trend(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT c.label, c.start_date,
                COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) as income,
                COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) as expense,
                COUNT(CASE WHEN t.was_planned=0 AND t.type='expense' THEN 1 END) as impulse_count,
                COALESCE(SUM(CASE WHEN t.was_planned=0 AND t.type='expense' THEN t.amount ELSE 0 END),0) as impulse_total
         FROM cycles c
         LEFT JOIN transactions t ON t.cycle_id = c.id
         GROUP BY c.id
         ORDER BY c.start_date ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let income: f64 = row.get(2)?;
        let expense: f64 = row.get(3)?;
        let mpc = if income > 0.0 { expense / income } else { 0.0 };
        let impulse_total: f64 = row.get(5)?;
        let impulse_ratio = if expense > 0.0 { impulse_total / expense } else { 0.0 };
        Ok(serde_json::json!({
            "label": row.get::<_,String>(0)?,
            "date": row.get::<_,String>(1)?,
            "income": income,
            "expense": expense,
            "net": income - expense,
            "mpc": mpc,
            "mpc_pct": (mpc * 100.0).round(),
            "impulse_count": row.get::<_,i64>(4)?,
            "impulse_total": impulse_total,
            "impulse_ratio": impulse_ratio,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
#[tauri::command]
fn get_habit_compounds(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    // Find categories that appear in multiple cycles or multiple times
    let mut stmt = conn.prepare(
        "SELECT category,
                COUNT(*) as tx_count,
                SUM(amount) as total_spent,
                AVG(amount) as avg_amount,
                MIN(amount) as min_amount,
                MAX(amount) as max_amount,
                COUNT(DISTINCT cycle_id) as cycles_present
         FROM transactions
         WHERE type='expense'
         GROUP BY category
         HAVING COUNT(*) >= 2
         ORDER BY SUM(amount) DESC"
    ).map_err(|e| e.to_string())?;

    let total_cycles: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cycles", [], |r| r.get(0)
    ).unwrap_or(1);

    let rows = stmt.query_map([], |row| {
        let tx_count: i64 = row.get(1)?;
        let total_spent: f64 = row.get(2)?;
        let avg_amount: f64 = row.get(3)?;
        let cycles_present: i64 = row.get(6)?;

        // Estimate monthly frequency
        let monthly_freq = tx_count as f64 / total_cycles.max(1) as f64;
        let annual_cost = avg_amount * monthly_freq * 12.0;
        let monthly_cost = avg_amount * monthly_freq;

        Ok(serde_json::json!({
            "category": row.get::<_,String>(0)?,
            "tx_count": tx_count,
            "total_spent": total_spent,
            "avg_amount": avg_amount,
            "min_amount": row.get::<_,f64>(4)?,
            "max_amount": row.get::<_,f64>(5)?,
            "cycles_present": cycles_present,
            "monthly_freq": monthly_freq,
            "monthly_cost": monthly_cost,
            "annual_cost": annual_cost,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
#[tauri::command]
async fn generate_insight(state: tauri::State<'_, DbState>) -> Result<serde_json::Value, String> {
    let context = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

        let (income, expense): (f64, f64) = conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
             FROM transactions WHERE cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            [], |r| Ok((r.get(0)?, r.get(1)?))
        ).unwrap_or((0.0, 0.0));

        let balance: f64 = compute_available_balance(&conn);

        let impulse_total: f64 = conn.query_row(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE was_planned=0
             AND type='expense' AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
            [], |r| r.get(0)
        ).unwrap_or(0.0);

        let top_cat: String = conn.query_row(
            "SELECT category FROM transactions WHERE type='expense'
             AND cycle_id=(SELECT id FROM cycles WHERE is_current=1)
             GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1",
            [], |r| r.get(0)
        ).unwrap_or("None".to_string());

        let survival_floor: f64 = conn.query_row(
            "SELECT survival_floor_amount FROM user_profile WHERE id=1",
            [], |r| r.get(0)
        ).unwrap_or(0.0);

        format!(
            "Balance: ₹{:.0}, Income: ₹{:.0}, Expense: ₹{:.0}, \
             Impulse spend: ₹{:.0}, Top category: {}, Survival floor: ₹{:.0}",
            balance, income, expense, impulse_total, top_cat, survival_floor
        )
    };

    let client = reqwest::Client::new();
    let prompt = format!(
        "You are Cistern, a financial AI. Based on this data, generate ONE specific, \
         actionable financial insight for Sricharan (student). \
         Be direct and concrete. Under 2 sentences. No filler. \
         Respond ONLY with a JSON object with two fields: \
         'title' (5 words max) and 'body' (the insight, under 40 words). \
         No markdown, no backticks, just raw JSON.\n\nData: {}",
        context
    );

    let body = serde_json::json!({
        "model": "qwen2.5:7b",
        "prompt": prompt,
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running: {}", e))?;

    let json: serde_json::Value = response.json().await
        .map_err(|e| e.to_string())?;

    let raw = json["response"].as_str().unwrap_or("{}");

    // Parse the AI's JSON response
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .unwrap_or(serde_json::json!({
            "title": "Financial insight",
            "body": raw
        }));

    // Save to database
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
        let title = parsed["title"].as_str().unwrap_or("Insight");
        let body_text = parsed["body"].as_str().unwrap_or(raw);
        conn.execute(
            "INSERT INTO ai_insights (type, title, body, cycle_id)
             VALUES ('nudge', ?1, ?2, (SELECT id FROM cycles WHERE is_current=1))",
            rusqlite::params![title, body_text],
        ).map_err(|e| e.to_string())?;
    }

    Ok(parsed)
}
#[tauri::command]
fn get_ghost_buckets(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    // Find categories with significant spend but no bucket assigned
    let mut stmt = conn.prepare(
        "SELECT category,
                COUNT(*) as tx_count,
                SUM(amount) as total_spent,
                AVG(amount) as avg_amount
         FROM transactions
         WHERE type='expense' AND bucket_id IS NULL
         GROUP BY category
         HAVING SUM(amount) > 100
         ORDER BY SUM(amount) DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "category": row.get::<_,String>(0)?,
            "tx_count": row.get::<_,i64>(1)?,
            "total_spent": row.get::<_,f64>(2)?,
            "avg_amount": row.get::<_,f64>(3)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn get_bucket_archaeology(bucket_id: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let (name, alloc, necessity): (String, f64, String) = conn.query_row(
        "SELECT name, alloc_value, necessity_tier FROM buckets WHERE id=?1",
        rusqlite::params![bucket_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT c.label, c.start_date, c.end_date,
                COALESCE(SUM(t.amount),0) as spent,
                COUNT(t.id) as tx_count,
                b.alloc_value as allocated
         FROM cycles c
         LEFT JOIN transactions t ON t.cycle_id=c.id AND t.bucket_id=?1 AND t.type='expense'
         LEFT JOIN buckets b ON b.id=?1
         GROUP BY c.id
         ORDER BY c.start_date ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![bucket_id], |row| {
        let allocated: f64 = row.get(5)?;
        let spent: f64 = row.get(3)?;
        Ok(serde_json::json!({
            "cycle": row.get::<_,String>(0)?,
            "start_date": row.get::<_,String>(1)?,
            "end_date": row.get::<_,Option<String>>(2)?,
            "spent": spent,
            "tx_count": row.get::<_,i64>(4)?,
            "allocated": allocated,
            "surplus": allocated - spent,
            "pct_used": if allocated > 0.0 { (spent / allocated * 100.0).round() } else { 0.0 },
        }))
    }).map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for row in rows { history.push(row.map_err(|e| e.to_string())?); }

    Ok(serde_json::json!({
        "id": bucket_id,
        "name": name,
        "alloc_value": alloc,
        "necessity_tier": necessity,
        "history": history,
    }))
}

#[tauri::command]
fn get_ledger_memory(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, type, category, title, description, metric_value,
                life_stage, floor_at_time, occurred_at, is_pinned
         FROM milestones ORDER BY occurred_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "type": row.get::<_,String>(1)?,
            "category": row.get::<_,String>(2)?,
            "title": row.get::<_,String>(3)?,
            "description": row.get::<_,Option<String>>(4)?,
            "metric_value": row.get::<_,Option<f64>>(5)?,
            "life_stage": row.get::<_,Option<String>>(6)?,
            "floor_at_time": row.get::<_,Option<i64>>(7)?,
            "occurred_at": row.get::<_,String>(8)?,
            "is_pinned": row.get::<_,bool>(9)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn add_ledger_memory(
    title: String,
    description: Option<String>,
    category: String,
    metric_value: Option<f64>,
    state: State<DbState>
) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let (life_stage, floor): (String, i64) = conn.query_row(
        "SELECT life_stage, current_floor FROM user_profile WHERE id=1",
        [], |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO milestones (type, category, title, description, metric_value, life_stage, floor_at_time)
         VALUES ('manual', ?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![category, title, description, metric_value, life_stage, floor],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}
#[tauri::command]
fn get_source_reliability(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.source_type, s.expected_amount, s.expected_day,
                COUNT(t.id) as actual_count,
                COALESCE(AVG(t.amount),0) as avg_actual,
                COALESCE(SUM(t.amount),0) as total_received,
                COALESCE(MIN(t.amount),0) as min_received,
                COALESCE(MAX(t.amount),0) as max_received,
                COUNT(DISTINCT t.cycle_id) as cycles_appeared
         FROM income_sources s
         LEFT JOIN transactions t ON t.source_id = s.id AND t.type='income'
         WHERE s.is_active = 1
         GROUP BY s.id
         ORDER BY total_received DESC"
    ).map_err(|e| e.to_string())?;

    let total_cycles: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cycles", [], |r| r.get(0)
    ).unwrap_or(1);

    let rows = stmt.query_map([], |row| {
        let expected: Option<f64> = row.get(3)?;
        let avg_actual: f64 = row.get(6)?;
        let cycles_appeared: i64 = row.get(10)?;
        let actual_count: i64 = row.get(5)?;

        // Reliability = how often it showed up vs total cycles
        let arrival_rate = cycles_appeared as f64 / total_cycles.max(1) as f64;

        // Amount consistency = how close to expected
        let amount_consistency = if let Some(exp) = expected {
            if exp > 0.0 { 1.0 - ((avg_actual - exp).abs() / exp).min(1.0) } else { 1.0 }
        } else { 1.0 };

        let reliability_score = (arrival_rate * 0.6 + amount_consistency * 0.4).min(1.0);

        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "name": row.get::<_,String>(1)?,
            "source_type": row.get::<_,String>(2)?,
            "expected_amount": expected,
            "actual_count": actual_count,
            "avg_actual": avg_actual,
            "total_received": row.get::<_,f64>(7)?,
            "min_received": row.get::<_,f64>(8)?,
            "max_received": row.get::<_,f64>(9)?,
            "cycles_appeared": cycles_appeared,
            "total_cycles": total_cycles,
            "arrival_rate": arrival_rate,
            "amount_consistency": amount_consistency,
            "reliability_score": reliability_score,
            "reliability_label": if reliability_score > 0.8 { "High" }
                else if reliability_score > 0.5 { "Medium" } else { "Low" },
        }))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn get_behavioral_patterns(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    // Day of week spending pattern
    let mut dow_stmt = conn.prepare(
        "SELECT CAST(strftime('%w', date) AS INTEGER) as dow,
                COUNT(*) as tx_count,
                COALESCE(AVG(amount),0) as avg_amount,
                COALESCE(SUM(amount),0) as total_amount
         FROM transactions WHERE type='expense'
         GROUP BY dow ORDER BY dow"
    ).map_err(|e| e.to_string())?;

    let dow_rows = dow_stmt.query_map([], |row| {
        let dow: i64 = row.get(0)?;
        let day_name = match dow {
            0 => "Sunday", 1 => "Monday", 2 => "Tuesday",
            3 => "Wednesday", 4 => "Thursday", 5 => "Friday",
            _ => "Saturday"
        };
        Ok(serde_json::json!({
            "day": day_name,
            "dow": dow,
            "tx_count": row.get::<_,i64>(1)?,
            "avg_amount": row.get::<_,f64>(2)?,
            "total_amount": row.get::<_,f64>(3)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut dow_data: Vec<serde_json::Value> = Vec::new();
    for row in dow_rows { dow_data.push(row.map_err(|e| e.to_string())?); }

    // Find highest spending day
    let peak_day = dow_data.iter()
        .max_by(|a, b| a["total_amount"].as_f64().unwrap_or(0.0)
            .partial_cmp(&b["total_amount"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal))
        .and_then(|d| d["day"].as_str())
        .unwrap_or("Unknown")
        .to_string();

    // Impulse vs planned ratio by category
    let mut imp_stmt = conn.prepare(
        "SELECT category,
                COUNT(CASE WHEN was_planned=0 THEN 1 END) as impulse_count,
                COUNT(CASE WHEN was_planned=1 THEN 1 END) as planned_count,
                COALESCE(SUM(CASE WHEN was_planned=0 THEN amount ELSE 0 END),0) as impulse_total
         FROM transactions WHERE type='expense'
         GROUP BY category HAVING COUNT(*) >= 2
         ORDER BY impulse_total DESC LIMIT 5"
    ).map_err(|e| e.to_string())?;

    let imp_rows = imp_stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "category": row.get::<_,String>(0)?,
            "impulse_count": row.get::<_,i64>(1)?,
            "planned_count": row.get::<_,i64>(2)?,
            "impulse_total": row.get::<_,f64>(3)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut impulse_data: Vec<serde_json::Value> = Vec::new();
    for row in imp_rows { impulse_data.push(row.map_err(|e| e.to_string())?); }

    // Overall stats
    let (total_planned, total_impulse): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN was_planned=1 THEN amount ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN was_planned=0 THEN amount ELSE 0 END),0)
         FROM transactions WHERE type='expense'",
        [], |r| Ok((r.get(0)?, r.get(1)?))
    ).unwrap_or((0.0, 0.0));

    Ok(serde_json::json!({
        "day_of_week": dow_data,
        "peak_day": peak_day,
        "impulse_by_category": impulse_data,
        "total_planned": total_planned,
        "total_impulse": total_impulse,
        "impulse_ratio": if total_planned + total_impulse > 0.0 {
            total_impulse / (total_planned + total_impulse)
        } else { 0.0 },
    }))
}
#[tauri::command]
fn update_bucket(
    id: i64,
    name: String,
    alloc_value: f64,
    necessity_tier: String,
    liquidity: String,
    state: State<DbState>
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE buckets SET name=?1, alloc_value=?2, necessity_tier=?3, liquidity=?4 WHERE id=?5",
        rusqlite::params![name, alloc_value, necessity_tier, liquidity, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_bucket(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE buckets SET is_active=0 WHERE id=?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn vault_status(app: tauri::AppHandle) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(crypto::vault_exists(&app_data_dir))
}

#[tauri::command]
fn create_vault_cmd(passphrase: String, app: tauri::AppHandle, state: State<DbState>) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let (conn, recovery_key, migrated) = crypto::create_vault(&app_data_dir, &passphrase)?;
    if migrated {
        println!("Existing database was migrated to encrypted format. Original preserved as cistern_plaintext.bak");
    } else {
        finalize_db(&conn).map_err(|e| e.to_string())?;
    }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(recovery_key)
}

#[tauri::command]
fn unlock_vault_cmd(passphrase: String, app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let conn = crypto::unlock_with_passphrase(&app_data_dir, &passphrase)?;
    finalize_db(&conn).map_err(|e| e.to_string())?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(())
}

#[tauri::command]
fn unlock_vault_with_recovery_cmd(recovery_key: String, app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let conn = crypto::unlock_with_recovery(&app_data_dir, &recovery_key)?;
    finalize_db(&conn).map_err(|e| e.to_string())?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(())
}
#[tauri::command]
fn update_savings_target(
    id: i64,
    name: String,
    target_amount: f64,
    deadline: Option<String>,
    state: State<DbState>
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE savings_targets SET name=?1, target_amount=?2, deadline=?3 WHERE id=?4",
        rusqlite::params![name, target_amount, deadline, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_savings_target(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "DELETE FROM savings_targets WHERE id=?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn set_curve_baseline(state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    ).map_err(|e| e.to_string())?;

    let balance: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) FROM transactions",
        [], |r| r.get(0)
    ).unwrap_or(0.0);
    let max_id: i64 = conn.query_row(
        "SELECT COALESCE(MAX(id),0) FROM transactions", [], |r| r.get(0)
    ).unwrap_or(0);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    for (k, v) in [
        ("curve_baseline_id", max_id.to_string()),
        ("curve_baseline_balance", balance.to_string()),
        ("curve_baseline_date", today),
    ] {
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            rusqlite::params![k, v],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn bulk_assign_category_to_bucket(category: String, bucket_id: i64, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE transactions SET bucket_id = ?1
         WHERE category = ?2 AND bucket_id IS NULL AND type = 'expense'",
        rusqlite::params![bucket_id, category],
    ).map_err(|e| e.to_string())?;
    Ok(conn.changes() as i64)
}
#[tauri::command]
fn set_cycle_intentions(intentions: std::collections::HashMap<i64, f64>, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&intentions).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE cycles SET intended_budget = ?1 WHERE id = ?2",
        rusqlite::params![json, cycle_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_cycle_intentions(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let intended: Option<String> = conn.query_row(
        "SELECT intended_budget FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = intended
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    Ok(parsed)
}
#[tauri::command]
fn create_planning_session(name: String, locked_amount: f64, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO planning_sessions (name, locked_amount) VALUES (?1, ?2)",
        rusqlite::params![name, locked_amount],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_planning_sessions(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, name, locked_amount, is_active, created_at FROM planning_sessions
         WHERE is_active = 1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "name": row.get::<_,String>(1)?,
            "locked_amount": row.get::<_,f64>(2)?,
            "is_active": row.get::<_,bool>(3)?,
            "created_at": row.get::<_,String>(4)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn delete_planning_session(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute("DELETE FROM planned_items WHERE session_id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM planning_sessions WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_planned_item(
    session_id: i64,
    item_type: String,
    label: String,
    amount: f64,
    planned_date: String,
    emergency_fund_pct: Option<f64>,
    linked_target_id: Option<i64>,
    priority: Option<i64>,
    state: State<DbState>
) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO planned_items
         (session_id, item_type, label, amount, planned_date, emergency_fund_pct, linked_target_id, priority)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![session_id, item_type, label, amount, planned_date,
                          emergency_fund_pct, linked_target_id, priority.unwrap_or(1)],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn delete_planned_item(id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute("DELETE FROM planned_items WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn compute_projection(conn: &Connection, session_id: i64) -> Result<serde_json::Value, String> {
    let (name, locked_amount): (String, f64) = conn.query_row(
        "SELECT name, locked_amount FROM planning_sessions WHERE id=?1",
        rusqlite::params![session_id], |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|e| e.to_string())?;

    let current_balance: f64 = compute_available_balance(&conn);

    let starting_balance = current_balance - locked_amount;

    let mut stmt = conn.prepare(
        "SELECT id, item_type, label, amount, planned_date, emergency_fund_pct, linked_target_id, priority
         FROM planned_items WHERE session_id=?1 ORDER BY planned_date ASC, id ASC"
    ).map_err(|e| e.to_string())?;

    struct Item { id: i64, item_type: String, label: String, amount: f64, date: String,
                  ef_pct: Option<f64>, linked_target: Option<i64>, priority: i64 }

    let items: Vec<Item> = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(Item {
            id: row.get(0)?, item_type: row.get(1)?, label: row.get(2)?, amount: row.get(3)?,
            date: row.get(4)?, ef_pct: row.get(5)?, linked_target: row.get(6)?, priority: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    fn simulate(items: &[&Item], starting_balance: f64) -> (f64, f64) {
        let mut running = starting_balance;
        let mut min_balance = starting_balance;
        for item in items {
            if item.item_type == "income" {
                let net = if let Some(pct) = item.ef_pct { item.amount * (1.0 - pct / 100.0) } else { item.amount };
                running += net;
            } else {
                running -= item.amount;
            }
            if running < min_balance { min_balance = running; }
        }
        (running, min_balance)
    }

    let all_refs: Vec<&Item> = items.iter().collect();
    let (final_balance, min_balance) = simulate(&all_refs, starting_balance);
    let breach_count = {
        let mut running = starting_balance;
        let mut count = 0;
        for item in &items {
            if item.item_type == "income" {
                let net = if let Some(pct) = item.ef_pct { item.amount * (1.0 - pct / 100.0) } else { item.amount };
                running += net;
            } else {
                running -= item.amount;
            }
            if running < 0.0 { count += 1; }
        }
        count
    };

    let mut running = starting_balance;
    let mut timeline = Vec::new();
    let mut total_emergency_skimmed = 0.0;

    for item in &items {
        let mut net_amount = item.amount;
        let mut emergency_skim = 0.0;
        if item.item_type == "income" {
            if let Some(pct) = item.ef_pct {
                emergency_skim = item.amount * (pct / 100.0);
                net_amount = item.amount - emergency_skim;
                total_emergency_skimmed += emergency_skim;
            }
            running += net_amount;
        } else {
            running -= item.amount;
        }
        timeline.push(serde_json::json!({
            "id": item.id, "type": item.item_type, "label": item.label, "amount": item.amount,
            "date": item.date, "emergency_skim": emergency_skim,
            "net_effect": if item.item_type == "income" { net_amount } else { -item.amount },
            "running_balance": running, "is_breach": running < 0.0,
            "linked_target_id": item.linked_target, "priority": item.priority,
        }));
    }

    // Priority-based conflict resolution: if breaching, greedily suggest cutting
    // the lowest-priority (highest number), largest expenses first until it clears.
    let mut suggested_cuts: Vec<serde_json::Value> = Vec::new();
    if min_balance < 0.0 {
        let mut expense_candidates: Vec<&Item> = items.iter().filter(|i| i.item_type == "expense").collect();
        expense_candidates.sort_by(|a, b| b.priority.cmp(&a.priority).then(b.amount.partial_cmp(&a.amount).unwrap()));
        let mut excluded_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
        for candidate in expense_candidates {
            excluded_ids.insert(candidate.id);
            suggested_cuts.push(serde_json::json!({ "id": candidate.id, "label": candidate.label, "amount": candidate.amount }));
            let remaining: Vec<&Item> = items.iter().filter(|i| !excluded_ids.contains(&i.id)).collect();
            let (_, new_min) = simulate(&remaining, starting_balance);
            if new_min >= 0.0 { break; }
        }
    }

    Ok(serde_json::json!({
        "session_id": session_id,
        "session_name": name,
        "locked_amount": locked_amount,
        "current_balance": current_balance,
        "starting_balance": starting_balance,
        "final_balance": final_balance,
        "min_balance": min_balance,
        "breach_count": breach_count,
        "total_emergency_skimmed": total_emergency_skimmed,
        "timeline": timeline,
        "suggested_cuts": suggested_cuts,
    }))
}

#[tauri::command]
fn get_session_projection(session_id: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    compute_projection(&conn, session_id)
}

#[tauri::command]
fn compare_sessions(session_id_a: i64, session_id_b: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let a = compute_projection(&conn, session_id_a)?;
    let b = compute_projection(&conn, session_id_b)?;
    Ok(serde_json::json!({ "a": a, "b": b }))
}
#[tauri::command]
fn duplicate_session_as_variant(session_id: i64, new_name: String, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let locked_amount: f64 = conn.query_row(
        "SELECT locked_amount FROM planning_sessions WHERE id=?1", rusqlite::params![session_id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO planning_sessions (name, locked_amount, parent_session_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![new_name, locked_amount, session_id],
    ).map_err(|e| e.to_string())?;
    let new_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO planned_items (session_id, item_type, label, amount, planned_date, emergency_fund_pct, linked_target_id, priority)
         SELECT ?1, item_type, label, amount, planned_date, emergency_fund_pct, linked_target_id, priority
         FROM planned_items WHERE session_id=?2",
        rusqlite::params![new_id, session_id],
    ).map_err(|e| e.to_string())?;

    Ok(new_id)
}

#[tauri::command]
fn update_planned_item_date(id: i64, planned_date: String, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE planned_items SET planned_date=?1 WHERE id=?2",
        rusqlite::params![planned_date, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn materialize_planned_item(
    item_id: i64,
    bucket_id: Option<i64>,
    source_id: Option<i64>,
    category: String,
    necessity_tier: String,
    state: State<DbState>
) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let (item_type, label, amount, planned_date, ef_pct, linked_target): (String, String, f64, String, Option<f64>, Option<i64>) = conn.query_row(
        "SELECT item_type, label, amount, planned_date, emergency_fund_pct, linked_target_id FROM planned_items WHERE id=?1",
        rusqlite::params![item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
    ).map_err(|e| e.to_string())?;

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    let logged_amount = if item_type == "income" && ef_pct.is_some() {
        amount * (1.0 - ef_pct.unwrap() / 100.0)
    } else { amount };

    conn.execute(
        "INSERT INTO transactions
         (type, amount, date, source_id, bucket_id, category, subcategory,
          necessity_tier, was_planned, entry_method, cycle_id, description)
         VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,1,'manual',?8,?9)",
        rusqlite::params![item_type, logged_amount, planned_date, source_id, bucket_id,
                          category, necessity_tier, cycle_id, format!("From plan: {}", label)],
    ).map_err(|e| e.to_string())?;
    let tx_id = conn.last_insert_rowid();
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    if item_type == "income" {
        if let (Some(pct), Some(target_id)) = (ef_pct, linked_target) {
            let skim = amount * (pct / 100.0);
            conn.execute(
                "UPDATE savings_targets SET current_amount = current_amount + ?1,
                 is_completed = CASE WHEN current_amount + ?1 >= target_amount THEN 1 ELSE 0 END
                 WHERE id = ?2",
                rusqlite::params![skim, target_id],
            ).map_err(|e| e.to_string())?;
        }
    }

    conn.execute("UPDATE planned_items SET is_materialized=1 WHERE id=?1", rusqlite::params![item_id])
        .map_err(|e| e.to_string())?;

    Ok(tx_id)
}
#[tauri::command]
fn seal_reserve(label: String, amount: f64, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let available: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
         FROM transactions WHERE fund='regular'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let already_sealed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM sealed_reserves WHERE is_released=0", [], |r| r.get(0)
    ).unwrap_or(0.0);

    if amount > (available - already_sealed) {
        return Err(format!(
            "Only {:.2} is actually free to seal — sealing {:.2} would exceed your real available balance.",
            available - already_sealed, amount
        ));
    }

    conn.execute(
        "INSERT INTO sealed_reserves (label, amount) VALUES (?1, ?2)",
        rusqlite::params![label, amount],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_sealed_reserves(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, label, amount, is_released, sealed_at, released_at
         FROM sealed_reserves ORDER BY sealed_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "label": row.get::<_,String>(1)?,
            "amount": row.get::<_,f64>(2)?,
            "is_released": row.get::<_,bool>(3)?,
            "sealed_at": row.get::<_,String>(4)?,
            "released_at": row.get::<_,Option<String>>(5)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn unseal_reserve(id: i64, passphrase: String, app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crypto::unlock_with_passphrase(&app_data_dir, &passphrase)
        .map_err(|_| "Incorrect password — reserve stays sealed.".to_string())?;

    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "UPDATE sealed_reserves SET is_released=1, released_at=datetime('now') WHERE id=?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_emergency_fund_balance(state: State<DbState>) -> Result<f64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let balance: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
         FROM transactions WHERE fund='emergency'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    Ok(balance)
}

#[tauri::command]
fn get_emergency_transactions(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, type, amount, date, category, description
         FROM transactions WHERE fund='emergency' ORDER BY date DESC, id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_,i64>(0)?,
            "type": row.get::<_,String>(1)?,
            "amount": row.get::<_,f64>(2)?,
            "date": row.get::<_,String>(3)?,
            "category": row.get::<_,String>(4)?,
            "description": row.get::<_,Option<String>>(5)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn add_emergency_expense(
    amount: f64, category: String, description: Option<String>,
    date: String, passphrase: String, app: tauri::AppHandle, state: State<DbState>
) -> Result<i64, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crypto::unlock_with_passphrase(&app_data_dir, &passphrase)
        .map_err(|_| "Incorrect password — emergency fund stays untouched.".to_string())?;

    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let ef_balance: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
         FROM transactions WHERE fund='emergency'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    if amount > ef_balance {
        return Err(format!(
            "Emergency fund only holds {:.2} — this expense ({:.2}) exceeds it. Consider borrowing from regular surplus first.",
            ef_balance, amount
        ));
    }

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('expense', ?1, ?2, ?3, 'survival', 1, 'manual', ?4, ?5, 'emergency')",
        rusqlite::params![amount, date, category, cycle_id, description],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn borrow_from_regular_to_emergency(amount: f64, date: String, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let regular_balance: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
         FROM transactions WHERE fund='regular'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let sealed_total: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM sealed_reserves WHERE is_released=0", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let true_surplus = regular_balance - sealed_total;

    if amount > true_surplus {
        return Err(format!(
            "Only {:.2} is genuinely free in your regular surplus — not enough to cover {:.2} without touching sealed or already-committed money.",
            true_surplus, amount
        ));
    }

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('expense', ?1, ?2, 'Internal transfer', 'comfort', 1, 'manual', ?3, 'Transferred to Emergency Fund', 'regular')",
        rusqlite::params![amount, date, cycle_id],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('income', ?1, ?2, 'Internal transfer', 'comfort', 1, 'manual', ?3, 'Borrowed from regular surplus', 'emergency')",
        rusqlite::params![amount, date, cycle_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn add_income_with_split(
    amount: f64,
    date: String,
    category: String,
    description: Option<String>,
    emergency_flat: Option<f64>,
    emergency_pct: Option<f64>,
    state: State<DbState>
) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    // Flat amount takes priority if both are somehow given; percentage is a convenience, not a requirement.
    let emergency_amount = if let Some(flat) = emergency_flat {
        flat
    } else if let Some(pct) = emergency_pct {
        amount * (pct / 100.0)
    } else {
        0.0
    };

    if emergency_amount > amount {
        return Err(format!(
            "Can't route {:.2} to Emergency Fund from an income of only {:.2}.",
            emergency_amount, amount
        ));
    }

    let regular_amount = amount - emergency_amount;

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('income', ?1, ?2, ?3, 'comfort', 1, 'manual', ?4, ?5, 'regular')",
        rusqlite::params![regular_amount, date, category, cycle_id, description],
    ).map_err(|e| e.to_string())?;
    let regular_id = conn.last_insert_rowid();

    if emergency_amount > 0.0 {
        conn.execute(
            "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
             VALUES ('income', ?1, ?2, ?3, 'comfort', 1, 'manual', ?4, ?5, 'emergency')",
            rusqlite::params![emergency_amount, date, category, cycle_id, "Routed to Emergency Fund"],
        ).map_err(|e| e.to_string())?;
    }

    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;
    auto_repay_loans(&conn, cycle_id)?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;
    Ok(regular_id)
}
#[tauri::command]
fn get_session_projection_with_stress(session_id: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let base = compute_projection(&conn, session_id)?;

    // Pull each planned income item's linked source reliability, if any exists with a matching name.
    let mut stmt = conn.prepare(
        "SELECT id, label, amount FROM planned_items WHERE session_id=?1 AND item_type='income'"
    ).map_err(|e| e.to_string())?;
    let income_items: Vec<(i64, String, f64)> = stmt.query_map(rusqlite::params![session_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    let mut stressed_income_notes = Vec::new();
    for (id, label, amount) in &income_items {
        let reliability: Option<f64> = conn.query_row(
            "SELECT reliability_score FROM income_sources WHERE name=?1 LIMIT 1",
            rusqlite::params![label], |r| r.get(0)
        ).ok();
        if let Some(score) = reliability {
            let stressed_amount = amount * score;
            stressed_income_notes.push(serde_json::json!({
                "item_id": id, "label": label, "reliability_score": score,
                "expected": amount, "stressed_estimate": stressed_amount,
                "shortfall": amount - stressed_amount,
            }));
        }
    }

    // Opportunity cost: illustrative only, conservative flat annual rate, prorated to plan length in days.
    let locked_amount = base["locked_amount"].as_f64().unwrap_or(0.0);
    let days = conn.query_row(
        "SELECT COALESCE(JULIANDAY(MAX(planned_date)) - JULIANDAY('now'), 0) FROM planned_items WHERE session_id=?1",
        rusqlite::params![session_id], |r| r.get::<_, f64>(0)
    ).unwrap_or(0.0).max(0.0);
    let illustrative_annual_rate = 0.06; // conservative, illustrative only — never investment advice
    let opportunity_cost = locked_amount * illustrative_annual_rate * (days / 365.0);

    let mut result = base;
    result["stressed_income"] = serde_json::json!(stressed_income_notes);
    result["opportunity_cost_illustrative"] = serde_json::json!(opportunity_cost);
    result["opportunity_cost_note"] = serde_json::json!(
        "Illustrative only, at a conservative 6% annual rate — not a recommendation or projection of any real return."
    );
    Ok(result)
}
#[tauri::command]
fn save_session_as_template(session_id: i64, template_name: String, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    conn.execute(
        "INSERT INTO planning_sessions (name, locked_amount) VALUES (?1, 0)",
        rusqlite::params![format!("[Template] {}", template_name)],
    ).map_err(|e| e.to_string())?;
    let template_id = conn.last_insert_rowid();

    // Copy item structure only — labels, types, relative day-offsets — not the original dates or amounts verbatim.
    conn.execute(
        "INSERT INTO planned_items (session_id, item_type, label, amount, planned_date, emergency_fund_pct, priority)
         SELECT ?1, item_type, label, amount, planned_date, emergency_fund_pct, priority
         FROM planned_items WHERE session_id=?2",
        rusqlite::params![template_id, session_id],
    ).map_err(|e| e.to_string())?;

    Ok(template_id)
}

fn compute_available_balance(conn: &Connection) -> f64 {
    let ledger_balance: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
         FROM transactions WHERE fund='regular'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let sealed_total: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM sealed_reserves WHERE is_released=0", [], |r| r.get(0)
    ).unwrap_or(0.0);
    ledger_balance - sealed_total
}
#[tauri::command]
fn get_intention_progress(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let intended_json: Option<String> = conn.query_row(
        "SELECT intended_budget FROM cycles WHERE is_current=1", [], |r| r.get(0)
    ).unwrap_or(None);

    let mut results = Vec::new();
    if let Some(json_str) = intended_json {
        if let Ok(intentions) = serde_json::from_str::<std::collections::HashMap<String, f64>>(&json_str) {
            for (bucket_id_str, intended) in &intentions {
                if let Ok(bucket_id) = bucket_id_str.parse::<i64>() {
                    let name: String = conn.query_row(
                        "SELECT name FROM buckets WHERE id=?1", rusqlite::params![bucket_id], |r| r.get(0)
                    ).unwrap_or("Unknown".to_string());
                    let actual: f64 = conn.query_row(
                        "SELECT COALESCE(SUM(amount),0) FROM transactions
                         WHERE bucket_id=?1 AND cycle_id=(SELECT id FROM cycles WHERE is_current=1) AND type='expense'",
                        rusqlite::params![bucket_id], |r| r.get(0)
                    ).unwrap_or(0.0);
                    results.push(serde_json::json!({
                        "bucket_name": name, "intended": intended, "actual": actual,
                        "remaining": intended - actual, "pct_used": if *intended > 0.0 { (actual / intended * 100.0).round() } else { 0.0 }
                    }));
                }
            }
        }
    }
    Ok(results)
}
#[tauri::command]
fn get_session_templates(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, name FROM planning_sessions WHERE name LIKE '[Template]%'"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(serde_json::json!({ "id": r.get::<_,i64>(0)?, "name": r.get::<_,String>(1)? }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn create_session_from_template(template_id: i64, new_name: String, locked_amount: f64, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    conn.execute(
        "INSERT INTO planning_sessions (name, locked_amount) VALUES (?1, ?2)",
        rusqlite::params![new_name, locked_amount],
    ).map_err(|e| e.to_string())?;
    let new_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO planned_items (session_id, item_type, label, amount, planned_date, emergency_fund_pct, priority)
         SELECT ?1, item_type, label, amount, date('now', '+' || (julianday(planned_date) - julianday((SELECT MIN(planned_date) FROM planned_items WHERE session_id=?2))) || ' days'),
                emergency_fund_pct, priority
         FROM planned_items WHERE session_id=?2",
        rusqlite::params![new_id, template_id],
    ).map_err(|e| e.to_string())?;
    Ok(new_id)
}

#[tauri::command]
fn get_planning_calendar(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT pi.planned_date, pi.label, pi.amount, pi.item_type, ps.name
         FROM planned_items pi JOIN planning_sessions ps ON pi.session_id = ps.id
         WHERE ps.name NOT LIKE '[Template]%'
         ORDER BY pi.planned_date ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(serde_json::json!({
            "date": r.get::<_,String>(0)?, "label": r.get::<_,String>(1)?,
            "amount": r.get::<_,f64>(2)?, "type": r.get::<_,String>(3)?, "session": r.get::<_,String>(4)?
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
fn check_loan_feasibility_core(conn: &Connection, principal: f64, repayment_per_cycle: f64) -> serde_json::Value {
    let true_surplus = compute_available_balance(conn);
    let survival_floor: f64 = conn.query_row(
        "SELECT survival_floor_amount FROM user_profile WHERE id=1", [], |r| r.get(0)
    ).unwrap_or(0.0);

    let (avg_income, avg_expense): (f64, f64) = conn.query_row(
        "SELECT COALESCE(AVG(total_income),0), COALESCE(AVG(total_expense),0)
         FROM cycles WHERE is_current=0",
        [], |r| Ok((r.get(0)?, r.get(1)?))
    ).unwrap_or((0.0, 0.0));

    let (avg_income, avg_expense) = if avg_income == 0.0 {
        conn.query_row(
            "SELECT COALESCE(total_income,0), COALESCE(total_expense,0) FROM cycles WHERE is_current=1",
            [], |r| Ok((r.get::<_,f64>(0)?, r.get::<_,f64>(1)?))
        ).unwrap_or((0.0, 0.0))
    } else { (avg_income, avg_expense) };

    let net_per_cycle_before_loan = avg_income - avg_expense;
    let cycles_to_repay = if repayment_per_cycle > 0.0 { (principal / repayment_per_cycle).ceil() as i64 } else { 999 };

    let mut projected_balance = true_surplus + principal; // principal credits immediately on origination
    let mut min_balance = projected_balance;
    let mut breach_cycle: Option<i64> = None;

    for cycle in 1..=cycles_to_repay.min(36) {
        projected_balance += net_per_cycle_before_loan - repayment_per_cycle;
        if projected_balance < min_balance { min_balance = projected_balance; }
        if projected_balance < survival_floor && breach_cycle.is_none() {
            breach_cycle = Some(cycle);
        }
    }

    let feasible = breach_cycle.is_none();

    // If infeasible, compute alternative terms: max sustainable repayment_per_cycle at this principal,
    // and max sustainable principal at this repayment_per_cycle.
    let mut suggested_repayment = repayment_per_cycle;
    if !feasible && net_per_cycle_before_loan > 0.0 {
        suggested_repayment = (net_per_cycle_before_loan - (survival_floor - true_surplus - principal).max(0.0) / cycles_to_repay.max(1) as f64).max(0.0);
    }
    let suggested_cycles = if suggested_repayment > 0.0 { (principal / suggested_repayment).ceil() } else { 0.0 };

    serde_json::json!({
        "feasible": feasible,
        "true_surplus": true_surplus,
        "survival_floor": survival_floor,
        "avg_income_per_cycle": avg_income,
        "avg_expense_per_cycle": avg_expense,
        "net_per_cycle_before_loan": net_per_cycle_before_loan,
        "cycles_to_repay": cycles_to_repay,
        "min_projected_balance": min_balance,
        "breach_cycle": breach_cycle,
        "suggested_repayment_per_cycle": suggested_repayment,
        "suggested_cycles": suggested_cycles,
    })
}

#[tauri::command]
fn check_loan_feasibility(principal: f64, repayment_per_cycle: f64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    Ok(check_loan_feasibility_core(&conn, principal, repayment_per_cycle))
}

#[tauri::command]
fn take_loan(label: String, principal: f64, repayment_per_cycle: f64, state: State<DbState>) -> Result<i64, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('income', ?1, date('now'), 'Loan advance', 'comfort', 1, 'manual', ?2, ?3, 'regular')",
        rusqlite::params![principal, cycle_id, format!("Loan taken: {}", label)],
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO loans (label, principal, repayment_per_cycle) VALUES (?1, ?2, ?3)",
        rusqlite::params![label, principal, repayment_per_cycle],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_active_loans(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, label, principal, repayment_per_cycle, total_repaid, status, taken_date
         FROM loans WHERE status='active' ORDER BY taken_date DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        let principal: f64 = r.get(2)?;
        let repaid: f64 = r.get(4)?;
        Ok(serde_json::json!({
            "id": r.get::<_,i64>(0)?, "label": r.get::<_,String>(1)?, "principal": principal,
            "repayment_per_cycle": r.get::<_,f64>(3)?, "total_repaid": repaid,
            "remaining": principal - repaid, "pct_repaid": if principal > 0.0 { (repaid/principal*100.0).round() } else { 0.0 },
            "status": r.get::<_,String>(5)?, "taken_date": r.get::<_,String>(6)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn get_loan_history(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, label, principal, total_repaid, status, taken_date FROM loans WHERE status != 'active' ORDER BY taken_date DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(serde_json::json!({
            "id": r.get::<_,i64>(0)?, "label": r.get::<_,String>(1)?, "principal": r.get::<_,f64>(2)?,
            "total_repaid": r.get::<_,f64>(3)?, "status": r.get::<_,String>(4)?, "taken_date": r.get::<_,String>(5)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}

#[tauri::command]
fn repay_loan_manual(loan_id: i64, amount: f64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    let label: String = conn.query_row(
        "SELECT label FROM loans WHERE id=?1", rusqlite::params![loan_id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('expense', ?1, date('now'), 'Loan repayment', 'comfort', 1, 'manual', ?2, ?3, 'regular')",
        rusqlite::params![amount, cycle_id, format!("Repaying: {}", label)],
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE loans SET total_repaid = total_repaid + ?1,
         status = CASE WHEN total_repaid + ?1 >= principal THEN 'repaid' ELSE 'active' END
         WHERE id=?2",
        rusqlite::params![amount, loan_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn auto_repay_loans(conn: &Connection, cycle_id: i64) -> Result<f64, String> {
    let mut total_repaid_now = 0.0;
    let mut stmt = conn.prepare(
        "SELECT id, label, principal, repayment_per_cycle, total_repaid FROM loans WHERE status='active'"
    ).map_err(|e| e.to_string())?;
    let loans: Vec<(i64, String, f64, f64, f64)> = stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    for (id, label, principal, per_cycle, repaid) in loans {
        let remaining = principal - repaid;
        let this_payment = per_cycle.min(remaining);
        if this_payment <= 0.0 { continue; }

        conn.execute(
            "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
             VALUES ('expense', ?1, date('now'), 'Loan repayment', 'comfort', 1, 'manual', ?2, ?3, 'regular')",
            rusqlite::params![this_payment, cycle_id, format!("Auto-repaying: {}", label)],
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE loans SET total_repaid = total_repaid + ?1,
             status = CASE WHEN total_repaid + ?1 >= principal THEN 'repaid' ELSE 'active' END
             WHERE id=?2",
            rusqlite::params![this_payment, id],
        ).map_err(|e| e.to_string())?;
        total_repaid_now += this_payment;
    }
    Ok(total_repaid_now)
}
fn compute_floor_status(conn: &Connection) -> serde_json::Value {
    let (survival_floor, _current_floor): (f64, i64) = conn.query_row(
        "SELECT survival_floor_amount, current_floor FROM user_profile WHERE id = 1",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0.0, 1));
    let balance = compute_available_balance(conn);
    let (income, expense): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0),
                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)
         FROM transactions WHERE cycle_id=(SELECT id FROM cycles WHERE is_current=1)",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0.0, 0.0));
    let mpc = if income > 0.0 { expense / income } else { 0.0 };
    let daily_floor = if survival_floor > 0.0 { survival_floor / 30.0 } else { 1.0 };
    let runway = if balance > 0.0 { balance / daily_floor } else { 0.0 };
    let computed_floor = if balance <= 0.0 { 1i64 }
        else if balance < survival_floor { 1 }
        else if balance < survival_floor * 2.0 { 2 }
        else if balance < survival_floor * 4.0 || mpc >= 0.7 { 3 }
        else { 4 };
    let elapsed_pct = compute_cycle_elapsed_pct(conn);
    let projected_expense = if elapsed_pct > 0.05 { expense / elapsed_pct } else { expense };
    let projected_ending_balance = balance - (projected_expense - expense);
    serde_json::json!({
        "floor": computed_floor,
        "floor_label": match computed_floor { 1=>"Survival", 2=>"Stability", 3=>"Growth", _=>"Wealth" },
        "balance": balance, "survival_floor": survival_floor, "runway_days": runway,
        "mpc": mpc, "income": income, "expense": expense,
        "elapsed_pct": elapsed_pct, "projected_cycle_expense": projected_expense, "projected_ending_balance": projected_ending_balance,
    })
}
#[derive(Serialize, Deserialize, Debug, Clone)]
struct ChatMsg {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<serde_json::Value>,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
struct HistoryItem {
    role: String,
    content: String,
}

fn jarvis_tool_definitions() -> serde_json::Value {
    serde_json::json!([
        {"type":"function","function":{"name":"get_balance","description":"Get the user's current real spendable balance, excluding sealed reserves.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"get_floor_status","description":"Get the user's financial floor tier (Survival/Stability/Growth/Wealth), runway in days, and current MPC.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"check_loan_feasibility","description":"Check whether a hypothetical loan is financially sustainable before the user takes it.","parameters":{"type":"object","properties":{"principal":{"type":"number","description":"Loan amount requested"},"repayment_per_cycle":{"type":"number","description":"Proposed repayment per cycle"}},"required":["principal","repayment_per_cycle"]}}},
        {"type":"function","function":{"name":"get_bucket_health","description":"Get spending status of all the user's budget buckets this cycle.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"get_savings_targets","description":"Get the user's savings goals and progress toward each.","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"check_affordability","description":"Check whether the user can afford a specific rupee amount right now, and what happens to their balance and runway if they spend it. ALWAYS use this for any 'can I afford' question — never calculate the resulting balance yourself.","parameters":{"type":"object","properties":{"amount":{"type":"number","description":"The rupee amount being considered for spending"}},"required":["amount"]}}}
    ])
}

fn execute_jarvis_tool(conn: &Connection, name: &str, args: &serde_json::Value) -> serde_json::Value {
    match name {
        "get_balance" => serde_json::json!({ "balance": compute_available_balance(conn) }),
        "get_floor_status" => compute_floor_status(conn),
        "check_loan_feasibility" => {
            let principal = args["principal"].as_f64().unwrap_or(0.0);
            let repayment = args["repayment_per_cycle"].as_f64().unwrap_or(0.0);
            check_loan_feasibility_core(conn, principal, repayment)
        },
        "get_bucket_health" => {
            let mut stmt = match conn.prepare(
                "SELECT name, alloc_value, current_balance FROM buckets WHERE is_active=1"
            ) { Ok(s) => s, Err(_) => return serde_json::json!({"error": "query failed"}) };
            let rows = stmt.query_map([], |r| {
                Ok(serde_json::json!({"name": r.get::<_,String>(0)?, "allocated": r.get::<_,f64>(1)?, "remaining": r.get::<_,f64>(2)?}))
            });
            let mut results = Vec::new();
            if let Ok(rows) = rows { for row in rows { if let Ok(v) = row { results.push(v); } } }
            serde_json::json!(results)
        },
        "get_savings_targets" => {
            let mut stmt = match conn.prepare(
                "SELECT name, target_amount, current_amount FROM savings_targets WHERE is_completed=0"
            ) { Ok(s) => s, Err(_) => return serde_json::json!({"error": "query failed"}) };
            let rows = stmt.query_map([], |r| {
                Ok(serde_json::json!({"name": r.get::<_,String>(0)?, "target": r.get::<_,f64>(1)?, "current": r.get::<_,f64>(2)?}))
            });
            let mut results = Vec::new();
            if let Ok(rows) = rows { for row in rows { if let Ok(v) = row { results.push(v); } } }
            serde_json::json!(results)
        },
        "check_affordability" => {
            let amount = args["amount"].as_f64().unwrap_or(0.0);
            let balance = compute_available_balance(conn);
            let survival_floor: f64 = conn.query_row(
                "SELECT survival_floor_amount FROM user_profile WHERE id=1", [], |r| r.get(0)
            ).unwrap_or(0.0);
            let resulting_balance = balance - amount;
            let daily_floor = if survival_floor > 0.0 { survival_floor / 30.0 } else { 1.0 };
            let current_runway = if balance > 0.0 { balance / daily_floor } else { 0.0 };
            let resulting_runway = if resulting_balance > 0.0 { resulting_balance / daily_floor } else { 0.0 };
            serde_json::json!({
                "current_balance": balance,
                "amount_considered": amount,
                "resulting_balance": resulting_balance,
                "survival_floor": survival_floor,
                "current_runway_days": current_runway,
                "resulting_runway_days": resulting_runway,
                "stays_above_survival_floor": resulting_balance >= survival_floor,
                "goes_negative": resulting_balance < 0.0,
            })
        },
        _ => serde_json::json!({ "error": "unknown tool" }),
    }
}

#[tauri::command]
async fn jarvis_chat(message: String, history: Vec<HistoryItem>, state: State<'_, DbState>) -> Result<String, String> {
    let client = reqwest::Client::new();

    let mut messages = vec![
        ChatMsg {
            role: "system".to_string(),
            content: "You are Cistern, a private offline financial AI for a student named Sricharan. \
          You NEVER calculate numbers yourself — not even simple subtraction. A CURRENT FINANCIAL SNAPSHOT \
          message appears near the end of every conversation — that is always the correct, current data. \
          Never state a rupee figure that isn't either in that snapshot or returned by a tool call in this \
          exact turn — never reuse a number you or the person mentioned earlier in the conversation without \
          re-verifying it against the snapshot or a tool first. For 'can I afford X' questions, ALWAYS call \
          check_affordability with the exact amount. Your yes/no verdict MUST directly match the tool's \
          stays_above_survival_floor field: if false, your answer starts with 'No'. Being able to afford \
          something today and it being financially safe are different questions — always answer the safety \
          question. In Indian rupee notation, '30/-' or '₹30' both mean thirty rupees total — never a \
          per-unit price or a quantity. Be concise, honest, direct. Use INR (₹).".to_string(),
            tool_calls: None,
        },
    ];

    let recent: Vec<&HistoryItem> = history.iter().rev().take(12).collect();
    for h in recent.into_iter().rev() {
        let role = if h.role == "user" { "user" } else { "assistant" };
        messages.push(ChatMsg { role: role.to_string(), content: h.content.clone(), tool_calls: None });
    }

    // Ground every single turn in fresh, real numbers — never let the model rely on
    // remembering a figure from earlier in the conversation, since small local models
    // are unreliable at carrying exact numbers across several turns.
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("Vault is locked")?;
        let snapshot = compute_floor_status(&conn);
        let snapshot_text = format!(
            "CURRENT FINANCIAL SNAPSHOT (authoritative, use these exact numbers for anything you say — \
             do not reuse or recalculate a number from earlier in this conversation):\n\
             Balance: ₹{:.2}\nSurvival floor: ₹{:.2}\nFloor tier: {}\nRunway: {:.1} days\nMPC this cycle: {:.0}%",
            snapshot["balance"].as_f64().unwrap_or(0.0),
            snapshot["survival_floor"].as_f64().unwrap_or(0.0),
            snapshot["floor_label"].as_str().unwrap_or("Unknown"),
            snapshot["runway_days"].as_f64().unwrap_or(0.0),
            snapshot["mpc"].as_f64().unwrap_or(0.0) * 100.0,
        );
        messages.push(ChatMsg { role: "system".to_string(), content: snapshot_text, tool_calls: None });
    }

    let normalized_message = normalize_rupee_notation(&message);
    messages.push(ChatMsg { role: "user".to_string(), content: normalized_message, tool_calls: None });

    let first_body = serde_json::json!({
        "model": "qwen2.5:7b",
        "messages": messages,
        "tools": jarvis_tool_definitions(),
        "stream": false
    });

    let first_response = client.post("http://localhost:11434/api/chat")
        .json(&first_body).send().await
        .map_err(|e| format!("Ollama not running: {}", e))?;
    let first_json: serde_json::Value = first_response.json().await.map_err(|e| e.to_string())?;

    let tool_calls = first_json["message"]["tool_calls"].as_array().cloned().unwrap_or_default();

    if tool_calls.is_empty() {
        return Ok(first_json["message"]["content"].as_str().unwrap_or("No response").to_string());
    }

    messages.push(ChatMsg {
        role: "assistant".to_string(), content: "".to_string(),
        tool_calls: Some(serde_json::json!(tool_calls)),
    });

    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_ref().ok_or("Vault is locked")?;
        for call in &tool_calls {
            let tool_name = call["function"]["name"].as_str().unwrap_or("");
            let tool_args = &call["function"]["arguments"];
            let result = execute_jarvis_tool(conn, tool_name, tool_args);
            messages.push(ChatMsg {
                role: "tool".to_string(),
                content: result.to_string(),
                tool_calls: None,
            });
        }
    }

    let final_body = serde_json::json!({ "model": "qwen2.5:7b", "messages": messages, "stream": false });
    let final_response = client.post("http://localhost:11434/api/chat")
        .json(&final_body).send().await
        .map_err(|e| e.to_string())?;
    let final_json: serde_json::Value = final_response.json().await.map_err(|e| e.to_string())?;
    Ok(final_json["message"]["content"].as_str().unwrap_or("No response").to_string())
}
fn normalize_rupee_notation(text: &str) -> String {
    let re = regex::Regex::new(r"(\d+(?:\.\d+)?)\s*/-").unwrap();
    re.replace_all(text, "₹$1 (total amount)").to_string()
}
fn compute_smart_savings_suggestion(conn: &Connection) -> serde_json::Value {
    let balance = compute_available_balance(conn);
    let survival_floor: f64 = conn.query_row(
        "SELECT survival_floor_amount FROM user_profile WHERE id=1", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let surplus = (balance - survival_floor).max(0.0);

    if surplus <= 0.0 {
        return serde_json::json!({ "surplus": 0.0, "allocations": [] });
    }

    let mut stmt = match conn.prepare(
        "SELECT id, name, target_amount, current_amount, deadline FROM savings_targets WHERE is_completed=0"
    ) { Ok(s) => s, Err(_) => return serde_json::json!({ "surplus": surplus, "allocations": [] }) };

    struct Target { id: i64, name: String, remaining: f64, urgency: f64 }
    let rows = stmt.query_map([], |r| {
        let target_amount: f64 = r.get(2)?;
        let current_amount: f64 = r.get(3)?;
        let deadline: Option<String> = r.get(4)?;
        let remaining = (target_amount - current_amount).max(0.0);
        let urgency = if let Some(d) = deadline {
            let days_left: f64 = conn.query_row(
                "SELECT MAX(JULIANDAY(?1) - JULIANDAY('now'), 1)", rusqlite::params![d], |r| r.get(0)
            ).unwrap_or(365.0);
            1.0 / days_left
        } else { 1.0 / 365.0 };
        Ok(Target { id: r.get(0)?, name: r.get(1)?, remaining, urgency })
    });

    let mut targets: Vec<Target> = match rows {
        Ok(rows) => rows.filter_map(|r| r.ok()).filter(|t| t.remaining > 0.0).collect(),
        Err(_) => Vec::new(),
    };

    if targets.is_empty() {
        return serde_json::json!({ "surplus": surplus, "allocations": [] });
    }

    let mut remaining_surplus = surplus;
    let mut final_allocations: Vec<(i64, String, f64)> = Vec::new();

    // Iteratively cap any target at its remaining need and redistribute leftover among the rest.
    loop {
        let total_weight: f64 = targets.iter().map(|t| t.remaining * t.urgency).sum();
        if total_weight <= 0.0 || remaining_surplus <= 0.0 { break; }

        let mut any_capped = false;
        let mut next_targets = Vec::new();

        for t in &targets {
            let weight = t.remaining * t.urgency;
            let share = remaining_surplus * (weight / total_weight);
            if share >= t.remaining {
                final_allocations.push((t.id, t.name.clone(), t.remaining));
                remaining_surplus -= t.remaining;
                any_capped = true;
            } else {
                next_targets.push(Target { id: t.id, name: t.name.clone(), remaining: t.remaining, urgency: t.urgency });
            }
        }
        targets = next_targets;
        if !any_capped {
            for t in &targets {
                let weight = t.remaining * t.urgency;
                let share = remaining_surplus * (weight / total_weight);
                final_allocations.push((t.id, t.name.clone(), share));
            }
            break;
        }
        if targets.is_empty() { break; }
    }

    let allocations: Vec<serde_json::Value> = final_allocations.iter().map(|(id, name, amount)| {
        serde_json::json!({ "target_id": id, "target_name": name, "suggested_amount": amount })
    }).collect();

    serde_json::json!({ "surplus": surplus, "allocations": allocations })
}

#[tauri::command]
fn get_smart_savings_suggestion(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    Ok(compute_smart_savings_suggestion(&conn))
}

#[tauri::command]
fn apply_smart_savings_allocation(allocations: Vec<(i64, f64)>, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    for (target_id, amount) in allocations {
        conn.execute(
            "UPDATE savings_targets SET current_amount = current_amount + ?1,
             is_completed = CASE WHEN current_amount + ?1 >= target_amount THEN 1 ELSE 0 END
             WHERE id = ?2",
            rusqlite::params![amount, target_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn compute_cycle_elapsed_pct(conn: &Connection) -> f64 {
    let avg_cycle_days: f64 = conn.query_row(
        "SELECT COALESCE(AVG(JULIANDAY(end_date) - JULIANDAY(start_date)), 30) FROM cycles WHERE is_current=0",
        [], |r| r.get(0)
    ).unwrap_or(30.0);
    conn.query_row(
        "SELECT MIN(1.0, (JULIANDAY('now') - JULIANDAY(start_date)) / ?1) FROM cycles WHERE is_current=1",
        rusqlite::params![avg_cycle_days.max(1.0)], |r| r.get(0)
    ).unwrap_or(0.0)
}
#[tauri::command]
fn get_multi_cycle_trend(state: State<DbState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let closed_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cycles WHERE is_current=0", [], |r| r.get(0)
    ).unwrap_or(0);
    if closed_count < 3 {
        return Ok(serde_json::json!({ "insufficient_data": true, "closed_cycles": closed_count }));
    }

    let mut stmt = conn.prepare(
        "SELECT net_position FROM cycles WHERE is_current=0 ORDER BY start_date DESC LIMIT 3"
    ).map_err(|e| e.to_string())?;
    let recent: Vec<f64> = stmt.query_map([], |r| r.get::<_,f64>(0))
        .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    let avg_net_per_cycle = recent.iter().sum::<f64>() / recent.len() as f64;

    let current_net_worth: f64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) FROM transactions",
        [], |r| r.get(0)
    ).unwrap_or(0.0);

    let mut projections = Vec::new();
    let mut running = current_net_worth;
    for i in 1..=3 {
        running += avg_net_per_cycle;
        projections.push(serde_json::json!({ "cycles_ahead": i, "projected_net_worth": running }));
    }

    Ok(serde_json::json!({
        "insufficient_data": false,
        "avg_net_per_cycle": avg_net_per_cycle,
        "trend_direction": if avg_net_per_cycle > 0.0 { "up" } else if avg_net_per_cycle < 0.0 { "down" } else { "flat" },
        "projections": projections,
    }))
}
#[tauri::command]
fn add_savings_contribution(target_id: i64, amount: f64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let target_name: String = conn.query_row(
        "SELECT name FROM savings_targets WHERE id=?1", rusqlite::params![target_id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('expense', ?1, date('now'), 'Savings contribution', 'investment', 1, 'manual', ?2, ?3, 'regular')",
        rusqlite::params![amount, cycle_id, format!("Toward: {}", target_name)],
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO savings_contributions (target_id, amount) VALUES (?1, ?2)",
        rusqlite::params![target_id, amount],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE savings_targets SET current_amount = current_amount + ?1,
         is_completed = CASE WHEN current_amount + ?1 >= target_amount THEN 1 ELSE 0 END
         WHERE id = ?2",
        rusqlite::params![amount, target_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_savings_contribution_log(target_id: i64, state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;
    let mut stmt = conn.prepare(
        "SELECT id, amount, date FROM savings_contributions WHERE target_id=?1 ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![target_id], |r| {
        Ok(serde_json::json!({ "id": r.get::<_,i64>(0)?, "amount": r.get::<_,f64>(1)?, "date": r.get::<_,String>(2)? }))
    }).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows { results.push(row.map_err(|e| e.to_string())?); }
    Ok(results)
}
#[tauri::command]
fn delete_savings_contribution(contribution_id: i64, state: State<DbState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Vault is locked")?;

    let (target_id, amount): (i64, f64) = conn.query_row(
        "SELECT target_id, amount FROM savings_contributions WHERE id=?1",
        rusqlite::params![contribution_id], |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|e| e.to_string())?;
    let target_name: String = conn.query_row(
        "SELECT name FROM savings_targets WHERE id=?1", rusqlite::params![target_id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM cycles WHERE is_current = 1 LIMIT 1", [], |r| r.get(0)
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO transactions (type, amount, date, category, necessity_tier, was_planned, entry_method, cycle_id, description, fund)
         VALUES ('income', ?1, date('now'), 'Savings withdrawal', 'comfort', 1, 'manual', ?2, ?3, 'regular')",
        rusqlite::params![amount, cycle_id, format!("Withdrawn from: {}", target_name)],
    ).map_err(|e| e.to_string())?;
    update_cycle_totals(&conn, cycle_id).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE savings_targets SET current_amount = current_amount - ?1, is_completed=0 WHERE id=?2",
        rusqlite::params![amount, target_id],
    ).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM savings_contributions WHERE id=?1", rusqlite::params![contribution_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}