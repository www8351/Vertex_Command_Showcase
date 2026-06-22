-- 0004_role_default_user.sql
-- SECURITY: previously `users.role` defaulted to 'admin', so every new signup
-- became an admin and bypassed all requireAdmin gates. Default is now 'user'.
-- The application schema (shared/schema.ts) has been updated to match.

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- ─────────────────────────────────────────────────────────────────────────────
-- MANUAL REMEDIATION (do NOT auto-run). Existing rows are unchanged by the
-- ALTER above — accounts created under the old default are still 'admin'.
--
-- 1) Audit who is currently admin:
-- SELECT id, email, role, created_at FROM users WHERE role = 'admin' ORDER BY created_at;
--
-- 2) After deciding which ids are legitimate admins, demote the rest. Replace
--    <ids> with the comma-separated legitimate admin ids (e.g. 1,3):
-- UPDATE users SET role = 'user' WHERE role = 'admin' AND id NOT IN (<ids>);
-- ─────────────────────────────────────────────────────────────────────────────
