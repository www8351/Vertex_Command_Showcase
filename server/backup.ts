import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { pushSystemError } from "./system-health-stream";

const BACKUP_DIR = path.resolve("backups");

const CRITICAL_TABLES = [
  "users",
  "accounts",
  "imported_trades",
  "subscriptions",
  "plans",
  "integration_connections",
  "integration_accounts",
  "referral_codes",
  "referrals",
];

interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
  status: "success" | "failed";
}

interface BackupStatus {
  lastBackup: BackupInfo | null;
  nextScheduled: string | null;
  retentionDays: number;
  scheduleHour: number;
  schedulerActive: boolean;
}

let lastBackupResult: BackupInfo | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;

function getRetentionDays(): number {
  const env = process.env.BACKUP_RETENTION_DAYS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 365) return parsed;
  }
  return 7;
}

function getScheduleHour(): number {
  const env = process.env.BACKUP_SCHEDULE_HOUR;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) return parsed;
  }
  return 3;
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function initLastBackupFromDisk() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("backup_") && f.endsWith(".sql.gz"));
  if (files.length === 0) return;

  let newest: { filename: string; mtime: Date; size: number } | null = null;
  for (const file of files) {
    const stats = fs.statSync(path.join(BACKUP_DIR, file));
    if (!newest || stats.mtime > newest.mtime) {
      newest = { filename: file, mtime: stats.mtime, size: stats.size };
    }
  }

  if (newest) {
    lastBackupResult = {
      filename: newest.filename,
      size: newest.size,
      createdAt: newest.mtime.toISOString(),
      status: "success",
    };
  }
}

export function runBackup(): Promise<BackupInfo> {
  return new Promise((resolve, reject) => {
    ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${timestamp}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, filename);

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return reject(new Error("DATABASE_URL not set"));
    }

    const tableArgs: string[] = [];
    for (const table of CRITICAL_TABLES) {
      tableArgs.push("-t", table);
    }

    const pgDump = spawn("pg_dump", [...tableArgs, dbUrl], { stdio: ["pipe", "pipe", "pipe"] });
    const gzip = spawn("gzip", [], { stdio: ["pipe", "pipe", "pipe"] });
    const outStream = fs.createWriteStream(filePath);

    pgDump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(outStream);

    let pgError = "";
    let settled = false;
    let pgExitCode: number | null = null;
    let gzExitCode: number | null = null;
    let fileFinished = false;

    pgDump.stderr.on("data", (d) => { pgError += d.toString(); });
    gzip.stderr.on("data", () => {});

    const backupTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      pgDump.kill();
      gzip.kill();
      cleanup(filePath);
      reject(new Error("Backup timed out after 120 seconds"));
    }, 120000);

    function tryResolve() {
      if (settled) return;
      if (pgExitCode === null || gzExitCode === null || !fileFinished) return;

      clearTimeout(backupTimeout);
      settled = true;

      if (pgExitCode !== 0) {
        cleanup(filePath);
        const info: BackupInfo = { filename, size: 0, createdAt: new Date().toISOString(), status: "failed" };
        lastBackupResult = info;
        return reject(new Error(`pg_dump exited with code ${pgExitCode}: ${pgError}`));
      }

      if (gzExitCode !== 0) {
        cleanup(filePath);
        const info: BackupInfo = { filename, size: 0, createdAt: new Date().toISOString(), status: "failed" };
        lastBackupResult = info;
        return reject(new Error(`gzip exited with code ${gzExitCode}`));
      }

      try {
        const stats = fs.statSync(filePath);
        const info: BackupInfo = {
          filename,
          size: stats.size,
          createdAt: new Date().toISOString(),
          status: "success",
        };
        lastBackupResult = info;
        console.log(`[backup] Backup completed: ${filename} (${formatSize(stats.size)}) — ${CRITICAL_TABLES.length} tables`);
        resolve(info);
      } catch (err: any) {
        cleanup(filePath);
        reject(err);
      }
    }

    outStream.on("finish", () => { fileFinished = true; tryResolve(); });

    pgDump.on("error", (err) => {
      if (settled) return;
      clearTimeout(backupTimeout);
      settled = true;
      gzip.kill();
      cleanup(filePath);
      reject(new Error(`pg_dump error: ${err.message}`));
    });

    gzip.on("error", (err) => {
      if (settled) return;
      clearTimeout(backupTimeout);
      settled = true;
      pgDump.kill();
      cleanup(filePath);
      reject(new Error(`gzip error: ${err.message}`));
    });

    pgDump.on("close", (code) => { pgExitCode = code ?? 1; tryResolve(); });
    gzip.on("close", (code) => { gzExitCode = code ?? 1; tryResolve(); });
  });
}

function cleanup(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function cleanupOldBackups(): number {
  ensureBackupDir();
  const days = getRetentionDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;

  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("backup_") && f.endsWith(".sql.gz"));

  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      removed++;
      console.log(`[backup] Cleaned up old backup: ${file}`);
    }
  }

  return removed;
}

export function listBackups(): BackupInfo[] {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("backup_") && f.endsWith(".sql.gz"));

  return files
    .map(filename => {
      const stats = fs.statSync(path.join(BACKUP_DIR, filename));
      return {
        filename,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        status: "success" as const,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getBackupStatus(): BackupStatus {
  return {
    lastBackup: lastBackupResult,
    nextScheduled: schedulerActive ? getNextScheduledTime() : null,
    retentionDays: getRetentionDays(),
    scheduleHour: getScheduleHour(),
    schedulerActive,
  };
}

function getNextScheduledTime(): string {
  const hour = getScheduleHour();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

async function scheduledBackupJob() {
  const now = new Date();
  const hour = getScheduleHour();
  if (now.getHours() === hour && now.getMinutes() === 0) {
    console.log("[backup] Running scheduled backup...");
    try {
      await runBackup();
      cleanupOldBackups();
    } catch (err: any) {
      console.error("[backup] Scheduled backup failed:", err.message);
      pushSystemError("error", "backup", `Scheduled backup failed: ${err.message}`);
    }
  }
}

export function startBackupScheduler() {
  if (schedulerTimer) return;

  initLastBackupFromDisk();
  cleanupOldBackups();
  schedulerTimer = setInterval(scheduledBackupJob, 60 * 1000);
  schedulerActive = true;
  const hour = getScheduleHour();
  const retention = getRetentionDays();
  console.log(`[backup] Scheduler started — daily backups at ${hour}:00, retention ${retention} days`);
}

export function stopBackupScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerActive = false;
  console.log("[backup] Scheduler stopped");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
