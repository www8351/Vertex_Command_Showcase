import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import {
  RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Clock, Activity,
  Wifi, Database, Cpu, Shield, Zap, Server,
  CircleDot, TrendingUp, Gauge,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiBase";

interface ChecklistItem {
  id: string;
  name: string;
  status: "green" | "yellow" | "red" | "unknown";
  connected: boolean;
  currentLatencyMs: number | null;
  averageLatencyMs: number | null;
  maxThresholdMs: number;
  detail?: string;
  value?: string | number;
}

interface ChecklistCategory {
  id: string;
  name: string;
  nameHe: string;
  items: ChecklistItem[];
}

interface LatencyData {
  healthScore: number;
  healthStatus: "healthy" | "degraded" | "critical";
  categories: ChecklistCategory[];
  engineInfo: { activeGroups: number; groupIds: number[] };
  timestamp: string;
  uptime: number;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  data_pipeline: Wifi,
  execution_engine: Zap,
  risk_shield: Shield,
  infrastructure: Server,
};

const CATEGORY_COLORS: Record<string, string> = {
  data_pipeline: "text-blue-500 bg-blue-500/10",
  execution_engine: "text-orange-500 bg-orange-500/10",
  risk_shield: "text-red-500 bg-red-500/10",
  infrastructure: "text-emerald-500 bg-emerald-500/10",
};

function StatusDot({ status }: { status: string }) {
  const config: Record<string, string> = {
    green: "bg-green-500 shadow-green-500/50",
    yellow: "bg-amber-500 shadow-amber-500/50 animate-pulse",
    red: "bg-red-500 shadow-red-500/50 animate-pulse",
    unknown: "bg-gray-400 shadow-gray-400/50",
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shadow-sm ${config[status] || config.unknown}`}
      data-testid={`status-dot-${status}`}
    />
  );
}

function HealthScoreGauge({ score, status }: { score: number; status: string }) {
  const color = status === "healthy" ? "text-green-500" : status === "degraded" ? "text-amber-500" : "text-red-500";
  const bgColor = status === "healthy" ? "bg-green-500/10 border-green-500/20" : status === "degraded" ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";
  const barColor = status === "healthy" ? "bg-green-500" : status === "degraded" ? "bg-amber-500" : "bg-red-500";
  const label = status === "healthy" ? "Healthy" : status === "degraded" ? "Degraded" : "Critical";

  return (
    <div className={`rounded-xl p-6 border ${bgColor}`} data-testid="health-score-gauge">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${bgColor}`}>
            <Gauge className={`w-6 h-6 ${color}`} />
          </div>
          <div>
            <h2 className="text-lg font-bold" data-testid="text-health-title">System Health Score</h2>
            <p className="text-xs text-muted-foreground">Weighted average across all components</p>
          </div>
        </div>
        <div className="text-end">
          <div className={`text-4xl font-bold ${color}`} data-testid="text-health-score">{score}</div>
          <div className={`text-xs font-medium ${color}`} data-testid="text-health-status">{label}</div>
        </div>
      </div>
      <div className="w-full bg-secondary/50 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(score, 100)}%` }} data-testid="health-score-bar" />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
        <span>0</span>
        <span className="text-red-400">Critical ≤50</span>
        <span className="text-amber-400">Degraded ≤80</span>
        <span className="text-green-400">Healthy &gt;80</span>
        <span>100</span>
      </div>
    </div>
  );
}

function formatLatency(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 100) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

function LatencyValue({ value, threshold }: { value: number | null; threshold: number }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = value <= threshold * 0.6 ? "text-green-500" : value <= threshold ? "text-amber-500" : "text-red-500";
  return <span className={`text-xs font-mono font-semibold ${color}`}>{formatLatency(value)}</span>;
}

function ChecklistItemRow({ item }: { item: ChecklistItem }) {
  const showLatency = item.maxThresholdMs > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors" data-testid={`checklist-item-${item.id}`}>
      <StatusDot status={item.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" data-testid={`text-item-name-${item.id}`}>{item.name}</span>
          {!item.connected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">Disconnected</span>
          )}
        </div>
        {item.detail && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate" data-testid={`text-item-detail-${item.id}`}>{item.detail}</p>
        )}
      </div>
      {showLatency && (
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground">Current</p>
            <LatencyValue value={item.currentLatencyMs} threshold={item.maxThresholdMs} />
          </div>
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground">Avg</p>
            <LatencyValue value={item.averageLatencyMs} threshold={item.maxThresholdMs} />
          </div>
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground">Max</p>
            <span className="text-xs font-mono text-muted-foreground">{formatLatency(item.maxThresholdMs)}</span>
          </div>
        </div>
      )}
      {!showLatency && item.value !== undefined && (
        <div className="text-end shrink-0">
          <span className="text-sm font-semibold" data-testid={`text-item-value-${item.id}`}>{item.value}</span>
        </div>
      )}
    </div>
  );
}

function CategoryCard({ category }: { category: ChecklistCategory }) {
  const Icon = CATEGORY_ICONS[category.id] || Activity;
  const colorClass = CATEGORY_COLORS[category.id] || "text-gray-500 bg-gray-500/10";
  const greenCount = category.items.filter(i => i.status === "green").length;
  const yellowCount = category.items.filter(i => i.status === "yellow").length;
  const redCount = category.items.filter(i => i.status === "red").length;
  const unknownCount = category.items.filter(i => i.status === "unknown").length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid={`category-${category.id}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/20">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{category.name}</h3>
          <p className="text-[11px] text-muted-foreground">{category.nameHe}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium shrink-0">
          {greenCount > 0 && <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="w-3 h-3" />{greenCount}</span>}
          {yellowCount > 0 && <span className="flex items-center gap-1 text-amber-500"><AlertTriangle className="w-3 h-3" />{yellowCount}</span>}
          {redCount > 0 && <span className="flex items-center gap-1 text-red-500"><XCircle className="w-3 h-3" />{redCount}</span>}
          {unknownCount > 0 && <span className="flex items-center gap-1 text-gray-400"><CircleDot className="w-3 h-3" />{unknownCount}</span>}
        </div>
      </div>
      <div>
        {category.items.map(item => (
          <ChecklistItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function LatencyMonitor() {
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery<LatencyData>({
    queryKey: ["/api/v1/system/latency"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/system/latency"), { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) throw new Error("ACCESS_DENIED");
        throw new Error("Failed to fetch latency data");
      }
      return res.json();
    },
    refetchInterval: 5000,
    retry: (failureCount, err) => {
      if (err instanceof Error && err.message === "ACCESS_DENIED") return false;
      return failureCount < 2;
    },
  });

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "";
  const isAccessDenied = isError && error instanceof Error && error.message === "ACCESS_DENIED";

  if (isAccessDenied) {
    return (
      <div className="h-full bg-background flex items-center justify-center p-6" dir={dir}>
        <div className="text-center space-y-4">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-bold" data-testid="text-access-denied">Access Denied</h2>
          <p className="text-sm text-muted-foreground">This page is restricted to Admin and Desk users.</p>
        </div>
      </div>
    );
  }

  if (isError && !isAccessDenied) {
    return (
      <div className="h-full bg-background flex items-center justify-center p-6" dir={dir}>
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold" data-testid="text-load-error">Unable to Load Metrics</h2>
          <p className="text-sm text-muted-foreground">Failed to fetch latency data. Please try again.</p>
          <Button onClick={() => refetch()} variant="outline" data-testid="button-retry">
            <RefreshCw className="w-4 h-4 me-2" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background text-foreground font-sans" dir={dir}>
      <div className="flex flex-col h-full">
        <header className="h-14 flex items-center justify-between rtl:flex-row-reverse px-4 lg:px-6 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-purple-600 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-sm sm:text-base font-semibold" data-testid="text-page-title">Latency Monitor</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-[11px] text-muted-foreground hidden sm:inline" data-testid="text-last-updated">
                <Clock className="w-3 h-3 inline me-1" />
                Last: {lastUpdated}
              </span>
            )}
            {data && (
              <span className="text-[11px] text-muted-foreground hidden sm:inline" data-testid="text-uptime">
                <TrendingUp className="w-3 h-3 inline me-1" />
                Uptime: {formatUptime(data.uptime)}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-[11px] text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="hidden sm:inline">Auto-refresh 5s</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="h-8 text-xs"
              data-testid="button-refresh-latency"
            >
              <RefreshCw className={`w-3.5 h-3.5 me-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 lg:p-6">
          {isLoading && !data ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : data ? (
            <div className="max-w-5xl mx-auto space-y-6">
              <HealthScoreGauge score={data.healthScore} status={data.healthStatus} />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-card border border-border rounded-lg p-3 text-center" data-testid="stat-active-groups">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Groups</p>
                  <p className="text-xl font-bold mt-1">{data.engineInfo.activeGroups}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 text-center" data-testid="stat-total-components">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Components</p>
                  <p className="text-xl font-bold mt-1">{data.categories.reduce((s, c) => s + c.items.length, 0)}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 text-center" data-testid="stat-green-count">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Healthy</p>
                  <p className="text-xl font-bold text-green-500 mt-1">{data.categories.reduce((s, c) => s + c.items.filter(i => i.status === "green").length, 0)}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-3 text-center" data-testid="stat-alert-count">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Alerts</p>
                  <p className="text-xl font-bold text-amber-500 mt-1">{data.categories.reduce((s, c) => s + c.items.filter(i => i.status === "yellow" || i.status === "red").length, 0)}</p>
                </div>
              </div>

              <div className="space-y-4">
                {data.categories.map(category => (
                  <CategoryCard key={category.id} category={category} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
