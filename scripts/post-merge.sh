#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
npm install --no-audit < /dev/null

echo "[post-merge] Running database migrations..."
npm run db:push < /dev/null 2>&1 || echo "[post-merge] db:push skipped or not configured"

echo "[post-merge] Ensuring all database columns and tables exist..."
npx tsx -e "
import { db } from './server/db';
import { sql } from 'drizzle-orm';
async function run() {
  // Users table columns
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0\`);
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP\`);
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false\`);
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT\`);
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false\`);
  await db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT\`);

  // Account columns
  await db.execute(sql\`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trailing_stop_type TEXT DEFAULT 'intraday'\`);
  await db.execute(sql\`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_peak_update_date TEXT\`);
  await db.execute(sql\`ALTER TABLE firms ADD COLUMN IF NOT EXISTS trailing_stop_type TEXT DEFAULT 'intraday'\`);
  await db.execute(sql\`ALTER TABLE firm_tiers ADD COLUMN IF NOT EXISTS trailing_stop_type TEXT DEFAULT 'intraday'\`);

  // Journal columns
  await db.execute(sql\`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS auto_tags TEXT[]\`);

  // Security & referral tables
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS security_events (id SERIAL PRIMARY KEY, event_type TEXT NOT NULL, severity TEXT NOT NULL, user_id INTEGER, ip_address TEXT, details JSONB, created_at TIMESTAMP DEFAULT NOW())\`);
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS referral_codes (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW())\`);
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_user_id INTEGER NOT NULL, referred_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'registered', reward_type TEXT, reward_amount REAL DEFAULT 0, reward_applied BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW(), converted_at TIMESTAMP)\`);

  // Journal tables
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS trading_goals (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, monthly_pnl_target REAL, yearly_pnl_target REAL, updated_at TIMESTAMP DEFAULT NOW())\`);
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS journal_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, data JSONB, is_read BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP DEFAULT NOW())\`);
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS journal_alert_settings (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, max_daily_loss REAL, max_consecutive_losses INTEGER DEFAULT 3, win_rate_drop_threshold REAL DEFAULT 10, enabled BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMP DEFAULT NOW())\`);
  await db.execute(sql\`CREATE TABLE IF NOT EXISTS shared_reports (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, share_token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, report_type TEXT NOT NULL DEFAULT 'performance', date_from TEXT, date_to TEXT, include_fields JSONB, snapshot_data JSONB, is_active BOOLEAN NOT NULL DEFAULT true, view_count INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())\`);

  console.log('All database columns and tables ensured');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
" 2>&1 || echo "[post-merge] database migration skipped"

echo "[post-merge] Seeding demo users..."
npx tsx scripts/seed-demo-users.ts 2>&1 || echo "[post-merge] Demo user seeding skipped"

echo "[post-merge] Setup complete."
