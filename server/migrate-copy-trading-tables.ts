import { db } from "./db";
import { sql } from "drizzle-orm";

export async function migrateCopyTradingTables(): Promise<void> {
  console.log("[Migration] Ensuring copy trading connection tables exist...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS copy_trading_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      encrypted_credentials TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_success_at TIMESTAMP,
      last_error_at TIMESTAMP,
      last_error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS copy_trading_connection_accounts (
      id SERIAL PRIMARY KEY,
      connection_id INTEGER NOT NULL,
      external_account_id TEXT NOT NULL,
      external_account_name TEXT,
      platform TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS master_connection_id INTEGER`);
  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS follower_connection_id INTEGER`);

  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS master_price REAL`);

  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS daily_loss_limit REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS restricted_symbols TEXT[]`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS news_embargo_minutes INTEGER`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS news_embargo_events JSONB`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS webhook_token TEXT`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS heartbeat_timeout_sec INTEGER`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS default_order_type TEXT DEFAULT 'Market'`);
  await db.execute(sql`ALTER TABLE copy_trading_groups ADD COLUMN IF NOT EXISTS default_time_in_force TEXT DEFAULT 'Day'`);

  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS min_position_size INTEGER`);
  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS fixed_lot_size REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS rounding_logic TEXT DEFAULT 'nearest'`);
  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS order_type TEXT`);
  await db.execute(sql`ALTER TABLE copy_trading_followers ADD COLUMN IF NOT EXISTS time_in_force TEXT`);

  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Market'`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS time_in_force TEXT DEFAULT 'Day'`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS limit_price REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS stop_price REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS trail_offset REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS normalized_error TEXT`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS slippage_ticks REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS slippage_dollars REAL`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS risk_check_result JSONB`);
  await db.execute(sql`ALTER TABLE copy_trading_orders ADD COLUMN IF NOT EXISTS is_orphaned BOOLEAN DEFAULT false`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS copy_daily_loss (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL,
      follower_id INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      total_loss REAL NOT NULL DEFAULT 0,
      UNIQUE(group_id, follower_id, trade_date)
    )
  `);

  console.log("[Migration] Copy trading connection tables ready");
}
