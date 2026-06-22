import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl } from "./apiBase";

let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(apiUrl("/api/v1/csrf-token"), { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    }
  } catch {}
  return null;
}

export async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => { csrfFetchPromise = null; });
  }
  return csrfFetchPromise;
}

export function clearCsrfToken() {
  csrfToken = null;
  csrfFetchPromise = null;
}

async function refreshCsrfToken(): Promise<string | null> {
  csrfToken = null;
  csrfFetchPromise = null;
  return fetchCsrfToken();
}

export type PlanLimitInfo = { feature: string; requiredPlan: string };
type PlanLimitListener = (info: PlanLimitInfo) => void;
const planLimitListeners: PlanLimitListener[] = [];
export function onPlanLimit(listener: PlanLimitListener) {
  planLimitListeners.push(listener);
  return () => {
    const idx = planLimitListeners.indexOf(listener);
    if (idx >= 0) planLimitListeners.splice(idx, 1);
  };
}
function emitPlanLimit(info: PlanLimitInfo) {
  planLimitListeners.forEach(l => l(info));
}

type DemoBlockListener = (msg: string) => void;
const demoBlockListeners: DemoBlockListener[] = [];
export function onDemoBlock(listener: DemoBlockListener) {
  demoBlockListeners.push(listener);
  return () => {
    const idx = demoBlockListeners.indexOf(listener);
    if (idx >= 0) demoBlockListeners.splice(idx, 1);
  };
}
function emitDemoBlock(msg: string) {
  demoBlockListeners.forEach(l => l(msg));
}

async function throwIfResNotOk(res: Response, emitModal = false) {
  if (!res.ok) {
    if (res.status === 403) {
      try {
        const cloned = res.clone();
        const body = await cloned.json();
        if (body?.message === 'demo_readonly') {
          emitDemoBlock(body.error || 'חשבון דמו — לא ניתן לבצע שינויים.');
          throw new Error(`demo_readonly:${body.error || 'מצב צפייה בלבד'}`);
        }
        if (body?.code === 'plan_limit') {
          if (emitModal) {
            emitPlanLimit({ feature: body.feature, requiredPlan: body.requiredPlan });
          }
          throw new Error(`plan_limit:${body.feature}:${body.requiredPlan}`);
        }
      } catch (e) {
        if (e instanceof Error && (e.message.startsWith('plan_limit:') || e.message.startsWith('demo_readonly:'))) throw e;
      }
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export type BrokerFetchResult<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
  apiError?: string;
  message?: string;
};

export async function safeBrokerFetch<T = any>(
  url: string,
  body: Record<string, any>,
): Promise<BrokerFetchResult<T>> {
  let res: Response;
  try {
    const token = await getCsrfToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["x-csrf-token"] = token;
    res = await fetch(apiUrl(url), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    return { ok: false, status: 0, data: null, code: "network_error", message: "Network error" };
  }

  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, status: res.status, data: null, code: "parse_error", message: `Server returned non-JSON (HTTP ${res.status})` };
  }

  if (!res.ok || !parsed.success) {
    return {
      ok: false,
      status: res.status,
      data: null,
      code: parsed.code || "connection_error",
      apiError: parsed.apiError,
      message: parsed.message || "Connection error",
    };
  }

  return { ok: true, status: res.status, data: parsed as T };
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";

  const upperMethod = method.toUpperCase();
  const isMutation = upperMethod !== "GET" && upperMethod !== "HEAD" && upperMethod !== "OPTIONS";
  if (isMutation) {
    const token = await getCsrfToken();
    if (token) headers["x-csrf-token"] = token;
  }

  let res = await fetch(apiUrl(url), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 403 && isMutation) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      if (body?.message === "CSRF token missing or invalid") {
        const newToken = await refreshCsrfToken();
        if (newToken) {
          headers["x-csrf-token"] = newToken;
          res = await fetch(apiUrl(url), {
            method,
            headers,
            body: data ? JSON.stringify(data) : undefined,
            credentials: "include",
          });
        }
      }
    } catch {}
  }

  await throwIfResNotOk(res, true);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(apiUrl(queryKey.join("/") as string), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, false);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
