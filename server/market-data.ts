import { db } from "./db";
import { marketDataCache } from "@shared/schema";
import { eq, and, gte, lte, asc, sql } from "drizzle-orm";

let tableReady = false;

export async function ensureMarketDataTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS market_data_cache (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(32) NOT NULL,
        "interval" VARCHAR(8) NOT NULL,
        "timestamp" TIMESTAMP NOT NULL,
        open DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        close DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION DEFAULT 0,
        fetched_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_market_data_unique_candle
        ON market_data_cache (symbol, "interval", "timestamp");
    `);
    tableReady = true;
    console.log("[MarketData] Table market_data_cache ready");
  } catch (e: any) {
    console.error("[MarketData] Failed to ensure table:", e.message);
  }
}

export interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SYMBOL_MAP: Record<string, { apiSymbol: string; source: "yahoo" | "coingecko" }> = {
  "BTC": { apiSymbol: "BTC-USD", source: "yahoo" },
  "BTCUSD": { apiSymbol: "BTC-USD", source: "yahoo" },
  "BTCUSDT": { apiSymbol: "BTC-USD", source: "yahoo" },
  "ETH": { apiSymbol: "ETH-USD", source: "yahoo" },
  "ETHUSD": { apiSymbol: "ETH-USD", source: "yahoo" },
  "ETHUSDT": { apiSymbol: "ETH-USD", source: "yahoo" },
  "ES": { apiSymbol: "ES=F", source: "yahoo" },
  "NQ": { apiSymbol: "NQ=F", source: "yahoo" },
  "MES": { apiSymbol: "ES=F", source: "yahoo" },
  "MNQ": { apiSymbol: "NQ=F", source: "yahoo" },
  "YM": { apiSymbol: "YM=F", source: "yahoo" },
  "MYM": { apiSymbol: "YM=F", source: "yahoo" },
  "RTY": { apiSymbol: "RTY=F", source: "yahoo" },
  "M2K": { apiSymbol: "RTY=F", source: "yahoo" },
  "CL": { apiSymbol: "CL=F", source: "yahoo" },
  "MCL": { apiSymbol: "CL=F", source: "yahoo" },
  "GC": { apiSymbol: "GC=F", source: "yahoo" },
  "MGC": { apiSymbol: "GC=F", source: "yahoo" },
  "SI": { apiSymbol: "SI=F", source: "yahoo" },
  "NQ100": { apiSymbol: "NQ=F", source: "yahoo" },
  "SPX": { apiSymbol: "^GSPC", source: "yahoo" },
  "SPY": { apiSymbol: "SPY", source: "yahoo" },
  "QQQ": { apiSymbol: "QQQ", source: "yahoo" },
  "AAPL": { apiSymbol: "AAPL", source: "yahoo" },
  "MSFT": { apiSymbol: "MSFT", source: "yahoo" },
  "TSLA": { apiSymbol: "TSLA", source: "yahoo" },
  "AMZN": { apiSymbol: "AMZN", source: "yahoo" },
  "GOOGL": { apiSymbol: "GOOGL", source: "yahoo" },
  "META": { apiSymbol: "META", source: "yahoo" },
  "NVDA": { apiSymbol: "NVDA", source: "yahoo" },
};

function normalizeFuturesSymbol(raw: string): string {
  const upper = raw.toUpperCase().trim();

  const futuresMatch = upper.match(/^(M?(?:ES|NQ|YM|RTY|CL|GC|SI|2K))[FGHJKMNQUVXZ]\d{1,2}$/);
  if (futuresMatch) {
    return futuresMatch[1].replace("M2K", "M2K");
  }

  return upper;
}

export function resolveSymbol(rawSymbol: string): { apiSymbol: string; source: "yahoo" | "coingecko"; normalized: string } | null {
  const normalized = normalizeFuturesSymbol(rawSymbol);

  const mapped = SYMBOL_MAP[normalized];
  if (mapped) {
    return { ...mapped, normalized };
  }

  if (/^[A-Z]{1,5}$/.test(normalized)) {
    return { apiSymbol: normalized, source: "yahoo", normalized };
  }

  return null;
}

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1wk": "1wk",
};

async function fetchFromYahoo(
  apiSymbol: string,
  startTs: number,
  endTs: number,
  interval: string
): Promise<OHLCVCandle[]> {
  const yahooInterval = INTERVAL_MAP[interval] || "1h";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(apiSymbol)}?period1=${startTs}&period2=${endTs}&interval=${yahooInterval}&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status} for ${apiSymbol}`);
  }

  const data = await res.json() as any;
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No data returned from Yahoo Finance for ${apiSymbol}`);
  }

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  const candles: OHLCVCandle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const v = quote.volume?.[i];

    if (o != null && h != null && l != null && c != null) {
      candles.push({
        time: timestamps[i],
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v || 0,
      });
    }
  }

  return candles;
}

async function fetchFromCoinGecko(
  coinId: string,
  startTs: number,
  endTs: number
): Promise<OHLCVCandle[]> {
  const days = Math.ceil((endTs - startTs) / 86400);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${Math.max(1, days)}`;

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`CoinGecko returned ${res.status}`);
  }

  const data = await res.json() as number[][];
  return data
    .filter((d) => d[0] / 1000 >= startTs && d[0] / 1000 <= endTs)
    .map((d) => ({
      time: Math.floor(d[0] / 1000),
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
      volume: 0,
    }));
}

async function getCachedData(
  symbol: string,
  interval: string,
  startDate: Date,
  endDate: Date
): Promise<OHLCVCandle[]> {
  const rows = await db
    .select()
    .from(marketDataCache)
    .where(
      and(
        eq(marketDataCache.symbol, symbol),
        eq(marketDataCache.interval, interval),
        gte(marketDataCache.timestamp, startDate),
        lte(marketDataCache.timestamp, endDate)
      )
    )
    .orderBy(asc(marketDataCache.timestamp));

  return rows.map((r) => ({
    time: Math.floor(new Date(r.timestamp).getTime() / 1000),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume || 0,
  }));
}

async function cacheCandles(
  symbol: string,
  interval: string,
  candles: OHLCVCandle[]
): Promise<void> {
  if (candles.length === 0) return;

  const batchSize = 100;
  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);
    const values = batch.map((c) => ({
      symbol,
      interval,
      timestamp: new Date(c.time * 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    try {
      await db.insert(marketDataCache).values(values).onConflictDoNothing();
    } catch (batchErr: any) {
      console.warn(`[MarketData] Batch insert failed for ${symbol} (${batch.length} candles), retrying individually:`, batchErr.message);
      for (const val of values) {
        try {
          await db.insert(marketDataCache).values(val).onConflictDoNothing();
        } catch (singleErr: any) {
          console.warn(`[MarketData] Single candle insert failed for ${symbol} at ${val.timestamp.toISOString()}:`, singleErr.message);
        }
      }
    }
  }
}

export async function getMarketData(
  rawSymbol: string,
  startTime: Date,
  endTime: Date,
  interval: string = "1h"
): Promise<{ candles: OHLCVCandle[]; resolvedSymbol: string; source: string }> {
  const resolved = resolveSymbol(rawSymbol);
  if (!resolved) {
    throw new Error(`Unknown symbol: ${rawSymbol}`);
  }

  const cacheKey = resolved.apiSymbol;

  const paddingMs = 24 * 60 * 60 * 1000;
  const paddedStart = new Date(startTime.getTime() - paddingMs);
  const paddedEnd = new Date(endTime.getTime() + paddingMs);

  const cached = await getCachedData(cacheKey, interval, paddedStart, paddedEnd);
  if (cached.length >= 5) {
    return { candles: cached, resolvedSymbol: resolved.apiSymbol, source: resolved.source };
  }

  const startTs = Math.floor(paddedStart.getTime() / 1000);
  const endTs = Math.floor(paddedEnd.getTime() / 1000);

  let candles: OHLCVCandle[] = [];

  try {
    if (resolved.source === "yahoo") {
      candles = await fetchFromYahoo(resolved.apiSymbol, startTs, endTs, interval);
    } else {
      const coinId = resolved.apiSymbol === "BTC-USD" ? "bitcoin" : resolved.apiSymbol === "ETH-USD" ? "ethereum" : "bitcoin";
      candles = await fetchFromCoinGecko(coinId, startTs, endTs);
    }
  } catch (err: any) {
    if (resolved.source === "coingecko") {
      try {
        candles = await fetchFromYahoo(resolved.apiSymbol, startTs, endTs, interval);
      } catch {
        throw new Error(`Failed to fetch market data for ${rawSymbol}: ${err.message}`);
      }
    } else {
      throw new Error(`Failed to fetch market data for ${rawSymbol}: ${err.message}`);
    }
  }

  if (candles.length > 0) {
    cacheCandles(cacheKey, interval, candles).catch((e) =>
      console.error("[MarketData] Cache write failed:", e.message)
    );
  }

  return { candles, resolvedSymbol: resolved.apiSymbol, source: resolved.source };
}
