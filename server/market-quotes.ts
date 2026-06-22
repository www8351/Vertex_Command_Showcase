/**
 * Market Quotes Service — Yahoo Finance backed
 *
 * Provides current price + day change for a small set of futures symbols
 * used by the dashboard ticker cards.
 *
 * Constraints honored:
 *  - Backend-only fetching (no client-side calls to Yahoo)
 *  - In-memory cache with hard 60s TTL on upstream calls
 *  - Retry with exponential backoff (3 attempts)
 *  - Graceful degradation: on upstream failure serve last known cached value
 *  - Background refresher keeps cache warm; HTTP handlers never block on cold start
 */

import { resolveSymbol } from "./market-data";

export interface Quote {
  symbol: string;        // dashboard symbol (e.g. "NQ")
  apiSymbol: string;     // upstream symbol (e.g. "NQ=F")
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  marketState: string;   // REGULAR / CLOSED / PRE / POST
  fetchedAt: number;     // ms epoch when this entry was fetched
  stale: boolean;        // true if served past TTL because upstream failed
}

const CACHE_TTL_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000; // log loudly if older than this
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 400;

const DEFAULT_SYMBOLS = ["NQ", "ES", "GC", "CL", "YM", "BTC"] as const;

const cache = new Map<string, Quote>();
const inflight = new Map<string, Promise<Quote | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooQuoteOnce(apiSymbol: string): Promise<Omit<Quote, "symbol" | "stale">> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    apiSymbol
  )}?interval=1m&range=1d&includePrePost=false`;

  const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status}`);
  }

  const data = (await res.json()) as any;
  const result = data?.chart?.result?.[0];
  if (!result) {
    const desc = data?.chart?.error?.description || "no chart result";
    throw new Error(`Yahoo empty payload: ${desc}`);
  }

  const meta = result.meta || {};
  const price: number | undefined =
    typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : undefined;
  const previousClose: number | undefined =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : undefined;

  if (price == null || previousClose == null) {
    throw new Error("Yahoo missing price/previousClose in meta");
  }

  const change = price - previousClose;
  const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

  return {
    apiSymbol,
    price,
    previousClose,
    change,
    changePercent,
    currency: meta.currency || "USD",
    marketState: meta.marketState || "UNKNOWN",
    fetchedAt: Date.now(),
  };
}

async function fetchWithRetry(apiSymbol: string): Promise<Omit<Quote, "symbol" | "stale">> {
  let lastErr: any;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchYahooQuoteOnce(apiSymbol);
    } catch (err: any) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 200;
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

/**
 * Refresh a single symbol. Coalesces concurrent calls for the same symbol.
 * On failure: leaves the existing cache entry intact (does NOT throw to caller).
 */
async function refreshSymbol(dashboardSymbol: string): Promise<Quote | null> {
  const upper = dashboardSymbol.toUpperCase();
  const existing = inflight.get(upper);
  if (existing) return existing;

  const resolved = resolveSymbol(upper);
  if (!resolved) {
    return null;
  }

  const task = (async (): Promise<Quote | null> => {
    try {
      const fresh = await fetchWithRetry(resolved.apiSymbol);
      const quote: Quote = { symbol: upper, stale: false, ...fresh };
      cache.set(upper, quote);
      return quote;
    } catch (err: any) {
      const cached = cache.get(upper);
      const age = cached ? Date.now() - cached.fetchedAt : Infinity;
      if (cached && age > STALE_AFTER_MS) {
        console.warn(
          `[MarketQuotes] Upstream failure for ${upper} (${resolved.apiSymbol}); serving stale cache aged ${Math.round(age / 1000)}s: ${err.message}`
        );
      } else {
        console.warn(
          `[MarketQuotes] Upstream failure for ${upper} (${resolved.apiSymbol}): ${err.message}`
        );
      }
      if (cached) {
        return { ...cached, stale: true };
      }
      return null;
    } finally {
      inflight.delete(upper);
    }
  })();

  inflight.set(upper, task);
  return task;
}

/**
 * Get a quote, using cache when fresh; otherwise refresh in background while
 * returning the stale value (or awaiting the first fetch if no cache exists).
 */
export async function getQuote(dashboardSymbol: string): Promise<Quote | null> {
  const upper = dashboardSymbol.toUpperCase();
  const cached = cache.get(upper);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  if (cached) {
    // Serve stale immediately, refresh in background (non-blocking)
    refreshSymbol(upper).catch(() => {});
    return cached;
  }

  // Cold cache — must wait for first fetch
  return refreshSymbol(upper);
}

export async function getQuotes(dashboardSymbols: string[]): Promise<Quote[]> {
  const results = await Promise.all(dashboardSymbols.map((s) => getQuote(s)));
  return results.filter((q): q is Quote => q !== null);
}

let backgroundTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the warm-cache background refresher. Safe to call multiple times.
 */
export function startMarketQuotesRefresher(symbols: readonly string[] = DEFAULT_SYMBOLS): void {
  if (backgroundTimer) return;

  const tick = () => {
    for (const sym of symbols) {
      refreshSymbol(sym).catch(() => {});
    }
  };

  // Kick off immediately so cache warms on boot
  tick();
  backgroundTimer = setInterval(tick, CACHE_TTL_MS);
  // Don't keep the process alive solely for this timer
  if (typeof backgroundTimer === "object" && backgroundTimer && "unref" in backgroundTimer) {
    (backgroundTimer as any).unref?.();
  }
  console.log(
    `[MarketQuotes] Background refresher started (every ${CACHE_TTL_MS / 1000}s) for: ${symbols.join(", ")}`
  );
}

export function stopMarketQuotesRefresher(): void {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
}
