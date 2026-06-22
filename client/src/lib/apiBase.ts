// API base URL resolution for split frontend/backend deployment.
// Empty in local dev (same-origin via Vite middleware); full backend origin
// in the Vercel build via VITE_API_URL (e.g. https://vertex-api.onrender.com).
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Prefix a relative API path with the configured base. Absolute URLs pass through.
export const apiUrl = (path: string): string =>
  path.startsWith("http") ? path : `${API_BASE}${path}`;
