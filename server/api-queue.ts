interface RateLimitError extends Error {
  status: number;
  statusCode?: number;
  retryAfterMs?: number;
}

function createRateLimitError(message: string, retryAfterMs?: number): RateLimitError {
  const err = new Error(message) as RateLimitError;
  err.status = 429;
  err.retryAfterMs = retryAfterMs;
  return err;
}

function isRateLimitShaped(err: unknown): err is RateLimitError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e.status === 429 || e.statusCode === 429) return true;
  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("throttl");
  }
  return false;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "retryAfterMs" in err) {
    const val = (err as Record<string, unknown>).retryAfterMs;
    return typeof val === "number" ? val : undefined;
  }
  return undefined;
}

type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
  provider: string;
};

interface ProviderConfig {
  maxRequestsPerSecond: number;
  maxConcurrent: number;
}

interface ProviderStats {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  throttled: number;
  totalRetries: number;
  lastRequestAt: number | null;
}

const KNOWN_PROVIDERS = ["tradovate", "topstepx"] as const;
type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

const DEFAULT_CONFIGS: Record<KnownProvider, ProviderConfig> = {
  tradovate: { maxRequestsPerSecond: 5, maxConcurrent: 3 },
  topstepx: { maxRequestsPerSecond: 2, maxConcurrent: 2 },
};

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const STATS_CAP = 1_000_000;
const TIMESTAMP_CLEANUP_INTERVAL_MS = 60_000;

function isKnownProvider(provider: string): provider is KnownProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}

class ApiQueue {
  private queues = new Map<string, QueuedTask<unknown>[]>();
  private activeCount = new Map<string, number>();
  private requestTimestamps = new Map<string, number[]>();
  private configs = new Map<string, ProviderConfig>();
  private stats = new Map<string, ProviderStats>();
  private processing = new Map<string, boolean>();

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    for (const provider of KNOWN_PROVIDERS) {
      this.configs.set(provider, { ...DEFAULT_CONFIGS[provider] });
      this.initProvider(provider);
    }
    this.cleanupTimer = setInterval(() => this.periodicCleanup(), TIMESTAMP_CLEANUP_INTERVAL_MS);
  }

  private periodicCleanup() {
    const now = Date.now();
    this.requestTimestamps.forEach((timestamps, provider) => {
      const recent = timestamps.filter(t => t > now - 2000);
      if (recent.length === 0) {
        this.requestTimestamps.delete(provider);
      } else {
        this.requestTimestamps.set(provider, recent);
      }
    });
    this.stats.forEach((stats) => {
      if (stats.completed > STATS_CAP) stats.completed = stats.completed % STATS_CAP;
      if (stats.failed > STATS_CAP) stats.failed = stats.failed % STATS_CAP;
      if (stats.throttled > STATS_CAP) stats.throttled = stats.throttled % STATS_CAP;
      if (stats.totalRetries > STATS_CAP) stats.totalRetries = stats.totalRetries % STATS_CAP;
    });
  }

  private initProvider(provider: string) {
    if (!this.queues.has(provider)) this.queues.set(provider, []);
    if (!this.activeCount.has(provider)) this.activeCount.set(provider, 0);
    if (!this.requestTimestamps.has(provider)) this.requestTimestamps.set(provider, []);
    if (!this.stats.has(provider)) {
      this.stats.set(provider, {
        queued: 0, active: 0, completed: 0, failed: 0,
        throttled: 0, totalRetries: 0, lastRequestAt: null,
      });
    }
    if (!this.processing.has(provider)) this.processing.set(provider, false);
  }

  getConfig(provider: string): ProviderConfig {
    return this.configs.get(provider) || (isKnownProvider(provider) ? DEFAULT_CONFIGS[provider] : { maxRequestsPerSecond: 5, maxConcurrent: 3 });
  }

  updateConfig(provider: string, config: Partial<ProviderConfig>): boolean {
    if (!isKnownProvider(provider)) return false;
    const current = this.getConfig(provider);
    this.configs.set(provider, { ...current, ...config });
    this.initProvider(provider);
    console.log(`[ApiQueue] Updated config for ${provider}:`, this.configs.get(provider));
    return true;
  }

  enqueue<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    this.initProvider(provider);
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = { fn, resolve, reject, enqueuedAt: Date.now(), provider };
      (this.queues.get(provider)! as QueuedTask<T>[]).push(task);
      const stats = this.stats.get(provider)!;
      stats.queued++;
      this.processQueue(provider);
    });
  }

  private async processQueue(provider: string) {
    if (this.processing.get(provider)) return;
    this.processing.set(provider, true);

    try {
      while (true) {
        const queue = this.queues.get(provider)!;
        if (queue.length === 0) break;

        const config = this.getConfig(provider);
        const active = this.activeCount.get(provider)!;
        if (active >= config.maxConcurrent) break;

        const waitMs = this.getRateLimitWait(provider);
        if (waitMs > 0) {
          const stats = this.stats.get(provider)!;
          stats.throttled++;
          if (stats.throttled % 500 === 1) {
            console.log(`[ApiQueue] ${provider}: rate limited, waiting ${waitMs}ms (${queue.length} in queue, throttled ${stats.throttled}x)`);
          }
          await this.sleep(waitMs);
          continue;
        }

        const task = queue.shift()!;
        const stats = this.stats.get(provider)!;
        stats.queued = Math.max(0, stats.queued - 1);
        stats.active++;
        this.activeCount.set(provider, active + 1);
        this.recordRequest(provider);

        this.executeTask(provider, task);
      }
    } finally {
      this.processing.set(provider, false);
    }
  }

  private async executeTask<T>(provider: string, task: QueuedTask<T>, attempt = 0) {
    try {
      const result = await task.fn();
      const stats = this.stats.get(provider)!;
      stats.active = Math.max(0, stats.active - 1);
      stats.completed++;
      stats.lastRequestAt = Date.now();
      this.activeCount.set(provider, Math.max(0, (this.activeCount.get(provider) || 1) - 1));
      task.resolve(result);
    } catch (err: unknown) {
      const isRateLimit = isRateLimitShaped(err);
      const stats = this.stats.get(provider)!;

      if (isRateLimit && attempt < MAX_RETRIES) {
        stats.throttled++;
        stats.totalRetries++;
        const retryAfter = getRetryAfterMs(err);
        const backoff = retryAfter || (BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500);
        if (stats.throttled % 500 === 1) {
          console.log(`[ApiQueue] ${provider}: rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES}), backing off ${Math.round(backoff)}ms (throttled ${stats.throttled}x)`);
        }
        await this.sleep(backoff);

        const waitMs = this.getRateLimitWait(provider);
        if (waitMs > 0) await this.sleep(waitMs);

        this.recordRequest(provider);
        return this.executeTask(provider, task, attempt + 1);
      }

      stats.active = Math.max(0, stats.active - 1);
      stats.failed++;
      stats.lastRequestAt = Date.now();
      this.activeCount.set(provider, Math.max(0, (this.activeCount.get(provider) || 1) - 1));
      task.reject(err);
    } finally {
      if (this.queues.get(provider)?.length) {
        this.processQueue(provider);
      }
    }
  }

  private getRateLimitWait(provider: string): number {
    const config = this.getConfig(provider);
    const timestamps = this.requestTimestamps.get(provider) || [];
    const now = Date.now();
    const windowStart = now - 1000;
    const recentRequests = timestamps.filter(t => t > windowStart);
    this.requestTimestamps.set(provider, recentRequests);

    if (recentRequests.length >= config.maxRequestsPerSecond) {
      const oldest = recentRequests[0];
      return oldest + 1000 - now + 10;
    }
    return 0;
  }

  private recordRequest(provider: string) {
    const timestamps = this.requestTimestamps.get(provider) || [];
    timestamps.push(Date.now());
    this.requestTimestamps.set(provider, timestamps);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  enqueueFetch(provider: string, input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> {
    return this.enqueue(provider, async () => {
      const res = await fetch(input, init);
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const retryMs = retryAfter ? (parseInt(retryAfter, 10) || 1) * 1000 : undefined;
        throw createRateLimitError(`Rate limited (429) by ${provider}`, retryMs);
      }
      return res;
    });
  }

  getKnownProviders(): readonly string[] {
    return KNOWN_PROVIDERS;
  }

  getStatus(): Record<string, { config: ProviderConfig; stats: ProviderStats }> {
    const result: Record<string, { config: ProviderConfig; stats: ProviderStats }> = {};
    const allProviders = new Set([...this.configs.keys(), ...this.stats.keys()]);
    for (const provider of allProviders) {
      result[provider] = {
        config: this.getConfig(provider),
        stats: this.stats.get(provider) || {
          queued: 0, active: 0, completed: 0, failed: 0,
          throttled: 0, totalRetries: 0, lastRequestAt: null,
        },
      };
    }
    return result;
  }

  getMapSizes(): { queues: number; timestamps: number; stats: number; configs: number } {
    return {
      queues: this.queues.size,
      timestamps: this.requestTimestamps.size,
      stats: this.stats.size,
      configs: this.configs.size,
    };
  }

  getProviderStatus(provider: string): { config: ProviderConfig; stats: ProviderStats } | null {
    if (!this.configs.has(provider) && !this.stats.has(provider)) return null;
    return {
      config: this.getConfig(provider),
      stats: this.stats.get(provider) || {
        queued: 0, active: 0, completed: 0, failed: 0,
        throttled: 0, totalRetries: 0, lastRequestAt: null,
      },
    };
  }
}

export const apiQueue = new ApiQueue();
