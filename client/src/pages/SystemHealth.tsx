import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/apiBase";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { motion } from "framer-motion";
import {
  Activity, Wifi, Database, Cpu, Shield, Zap, Server,
  Gauge, AlertTriangle, CheckCircle2,
  Search, RefreshCw, CreditCard, Bot, HeartPulse, Radio,
  type LucideIcon
} from "lucide-react";

interface ErrorEntry {
  id: number;
  timestamp: number;
  severity: "error" | "warning" | "info";
  source: string;
  message: string;
}

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

interface IntegrationEntry {
  connected: boolean;
  latencyMs: number | null;
  status: "connected" | "warning" | "disconnected";
}

interface EnginePulse {
  copyTrading: {
    active: boolean;
    activeGroups: number;
    groupIds: number[];
    positionsTracked: number;
    ordersInFlight: number;
    consecutiveErrors: number;
  };
  ruleEngine: { active: boolean; accountsManaged: number };
  prioritiesEngine: { active: boolean; accountsManaged: number };
}

interface HealthData {
  healthScore: number;
  healthStatus: string;
  categories: ChecklistCategory[];
  engineInfo: { activeGroups: number; groupIds: number[] };
  integrations: {
    tradovate: IntegrationEntry;
    topstepx: IntegrationEntry;
    stripe: IntegrationEntry;
    openai: IntegrationEntry;
  };
  enginePulse: EnginePulse;
  uptime: number;
  timestamp: number;
}

function useSystemHealthStream(enabled: boolean) {
  const [isConnected, setIsConnected] = useState(false);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(apiUrl("/api/v1/system/health/stream"), { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      failCountRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "connected":
            setIsConnected(true);
            break;
          case "health":
            setHealthData(data);
            break;
          case "errorBatch":
          case "errors":
            setErrors(prev => {
              const combined = [...prev, ...data.errors];
              return combined.slice(-200);
            });
            break;
        }
      } catch {}
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
      failCountRef.current++;
      const backoff = Math.min(5000 * Math.pow(2, failCountRef.current - 1), 60000);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, backoff);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect, enabled]);

  return { isConnected, healthData, errors };
}

function StatusDot({ status }: { status: string }) {
  const config: Record<string, string> = {
    green: "bg-green-500 shadow-green-500/50",
    yellow: "bg-amber-500 shadow-amber-500/50 animate-pulse",
    red: "bg-red-500 shadow-red-500/50 animate-pulse",
    unknown: "bg-neutral-500 shadow-neutral-500/50",
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shadow-sm ${config[status] || config.unknown}`}
      data-testid={`status-dot-${status}`}
    />
  );
}

const STATUS_LABELS: Record<string, { en: string; he: string }> = {
  green: { en: "Connected", he: "מחובר" },
  yellow: { en: "Warning", he: "אזהרה" },
  red: { en: "Disconnected", he: "מנותק" },
  unknown: { en: "Unknown", he: "לא ידוע" },
};

function HealthScoreHero({ score, status, t }: { score: number; status: string; t: (key: string) => string }) {
  const color = status === "healthy" ? "text-green-400" : status === "degraded" ? "text-amber-400" : "text-red-400";
  const bgGlow = status === "healthy" ? "from-green-500/10" : status === "degraded" ? "from-amber-500/10" : "from-red-500/10";
  const barColor = status === "healthy" ? "bg-green-500" : status === "degraded" ? "bg-amber-500" : "bg-red-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`rounded-2xl border border-neutral-800 bg-gradient-to-br ${bgGlow} to-transparent p-6`}
      data-testid="health-score-hero"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-neutral-800/50 border border-neutral-700">
            <HeartPulse className={`w-7 h-7 ${color}`} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-neutral-100" data-testid="text-health-title">{t("systemHealth.healthScore")}</h2>
            <p className="text-xs text-neutral-500">{t("systemHealth.healthScoreDesc")}</p>
          </div>
        </div>
        <div className="text-end">
          <div className={`text-5xl font-bold tabular-nums ${color}`} data-testid="text-health-score">{score}</div>
          <div className={`text-sm font-semibold ${color}`} data-testid="text-health-status">
            {t(`systemHealth.status.${status}`)}
          </div>
        </div>
      </div>
      <div className="w-full bg-neutral-800 rounded-full h-3">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(score, 100)}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-3 rounded-full ${barColor}`}
          data-testid="health-score-bar"
        />
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-neutral-600">
        <span>0</span>
        <span className="text-red-500">{t("systemHealth.critical")} &le;50</span>
        <span className="text-amber-500">{t("systemHealth.degraded")} &le;80</span>
        <span className="text-green-500">{t("systemHealth.healthy")} &gt;80</span>
        <span>100</span>
      </div>
    </motion.div>
  );
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  data_pipeline: Wifi,
  execution_connections: Radio,
  execution_engine: Zap,
  risk_shield: Shield,
  infrastructure: Server,
};

const CATEGORY_COLORS: Record<string, string> = {
  data_pipeline: "text-blue-400 bg-blue-500/10",
  execution_connections: "text-purple-400 bg-purple-500/10",
  execution_engine: "text-orange-400 bg-orange-500/10",
  risk_shield: "text-red-400 bg-red-500/10",
  infrastructure: "text-emerald-400 bg-emerald-500/10",
};

function CategoryCard({ category, index, lang }: { category: ChecklistCategory; index: number; lang: string }) {
  const Icon = CATEGORY_ICONS[category.id] || Activity;
  const colorClass = CATEGORY_COLORS[category.id] || "text-neutral-400 bg-neutral-500/10";
  const [iconColor, iconBg] = colorClass.split(" ");
  const categoryName = lang === "he" ? category.nameHe : category.name;

  const greenCount = category.items.filter(i => i.status === "green").length;
  const totalCount = category.items.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden"
      data-testid={`card-category-${category.id}`}
    >
      <div className="p-4 border-b border-neutral-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <span className="text-sm font-semibold text-neutral-200">{categoryName}</span>
        </div>
        <span className="text-xs text-neutral-500">{greenCount}/{totalCount}</span>
      </div>
      <div className="divide-y divide-neutral-800/50">
        {category.items.map(item => (
          <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-2" data-testid={`item-${item.id}`}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <StatusDot status={item.status} />
              <div className="min-w-0">
                <span className="text-xs text-neutral-300 truncate block">{item.name}</span>
                {item.detail && (
                  <span className="text-[10px] text-neutral-600 truncate block">{item.detail}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {item.currentLatencyMs != null && (
                <span className={`text-xs font-mono ${
                  item.currentLatencyMs <= item.maxThresholdMs * 0.6 ? "text-green-400" :
                  item.currentLatencyMs <= item.maxThresholdMs ? "text-amber-400" : "text-red-400"
                }`}>
                  {item.currentLatencyMs}ms
                </span>
              )}
              {item.value != null && item.currentLatencyMs == null && (
                <span className="text-xs font-mono text-neutral-400">{item.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function ExternalServiceCard({ name, integration, icon: Icon, index, t }: {
  name: string; integration: IntegrationEntry; icon: LucideIcon; index: number; t: (key: string) => string;
}) {
  const statusDot = integration.status === "connected" ? "green" : integration.status === "warning" ? "yellow" : "red";
  const borderClass = integration.status === "disconnected" ? "border-red-900/50 bg-red-950/20" :
    integration.status === "warning" ? "border-amber-900/50 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/50";
  const iconBg = integration.status === "connected" ? "bg-green-500/10" :
    integration.status === "warning" ? "bg-amber-500/10" : "bg-red-500/10";
  const iconColor = integration.status === "connected" ? "text-green-400" :
    integration.status === "warning" ? "text-amber-400" : "text-red-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`rounded-xl border p-4 ${borderClass}`}
      data-testid={`card-external-${name.toLowerCase().replace(/\s/g, "-")}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <span className="text-sm font-medium text-neutral-200">{name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={statusDot} />
          <span className={`text-[10px] ${iconColor}`}>
            {t(`systemHealth.integrationStatus.${integration.status}`)}
          </span>
        </div>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-neutral-500">{t("systemHealth.latency")}</span>
        <span className={`font-mono ${
          integration.latencyMs == null ? "text-neutral-600" :
          integration.latencyMs < 200 ? "text-green-400" : integration.latencyMs < 500 ? "text-amber-400" : "text-red-400"
        }`}>
          {integration.latencyMs != null ? `${integration.latencyMs}ms` : "N/A"}
        </span>
      </div>
    </motion.div>
  );
}

function PerformanceMetricsPanel({ categories, t }: { categories: ChecklistCategory[]; t: (key: string) => string }) {
  const infra = categories.find(c => c.id === "infrastructure");
  if (!infra) return null;

  const dbItem = infra.items.find(i => i.id === "db_query_latency");
  const memItem = infra.items.find(i => i.id === "memory_usage");
  const rateItem = infra.items.find(i => i.id === "api_rate_limit");
  const dataWsItem = infra.items.find(i => i.id === "data_ws_connections");
  const execWsItem = infra.items.find(i => i.id === "exec_ws_connections");
  const sseItem = infra.items.find(i => i.id === "sse_clients");

  const metrics = [
    { label: t("systemHealth.perf.dbLatency"), value: dbItem?.currentLatencyMs != null ? `${dbItem.currentLatencyMs}ms` : "N/A", status: dbItem?.status || "unknown", icon: Database },
    { label: t("systemHealth.perf.memory"), value: memItem?.detail || "N/A", status: memItem?.status || "unknown", icon: Cpu },
    { label: t("systemHealth.perf.rateLimit"), value: rateItem?.detail || "N/A", status: rateItem?.status || "unknown", icon: Gauge },
    { label: t("systemHealth.perf.dataWs"), value: String(dataWsItem?.value ?? "N/A"), status: dataWsItem?.status || "unknown", icon: Wifi },
    { label: t("systemHealth.perf.execWs"), value: String(execWsItem?.value ?? "N/A"), status: execWsItem?.status || "unknown", icon: Radio },
    { label: t("systemHealth.perf.sseClients"), value: String(sseItem?.value ?? "N/A"), status: sseItem?.status || "unknown", icon: Activity },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3" data-testid="text-section-performance">
        {t("systemHealth.performanceMetrics")}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-center"
            data-testid={`perf-metric-${i}`}
          >
            <div className="flex items-center justify-center mb-2">
              <m.icon className={`w-4 h-4 ${
                m.status === "green" ? "text-green-400" :
                m.status === "yellow" ? "text-amber-400" :
                m.status === "red" ? "text-red-400" : "text-neutral-500"
              }`} />
            </div>
            <div className="text-[10px] text-neutral-500 mb-1">{m.label}</div>
            <div className="text-xs font-mono text-neutral-200 truncate" title={m.value}>{m.value}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function EnginePulseSection({ enginePulse, t }: { enginePulse: EnginePulse; t: (key: string) => string }) {
  const engines = [
    {
      id: "copy-trading",
      icon: Zap,
      name: t("systemHealth.engines.copyTrading"),
      active: enginePulse.copyTrading.active,
      detail: `${enginePulse.copyTrading.activeGroups} ${t("systemHealth.engines.activeGroups")} · ${enginePulse.copyTrading.positionsTracked} ${t("systemHealth.engines.positionsTracked")} · ${enginePulse.copyTrading.consecutiveErrors} ${t("systemHealth.engines.errors")}`,
      color: "text-orange-400 bg-orange-500/10",
    },
    {
      id: "rule-engine",
      icon: Shield,
      name: t("systemHealth.engines.ruleEngine"),
      active: enginePulse.ruleEngine.active,
      detail: `${enginePulse.ruleEngine.accountsManaged} ${t("systemHealth.engines.accountsManaged")}`,
      color: "text-red-400 bg-red-500/10",
    },
    {
      id: "priorities",
      icon: Gauge,
      name: t("systemHealth.engines.prioritiesEngine"),
      active: enginePulse.prioritiesEngine.active,
      detail: `${enginePulse.prioritiesEngine.accountsManaged} ${t("systemHealth.engines.accountsManaged")}`,
      color: "text-blue-400 bg-blue-500/10",
    },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3" data-testid="text-section-engines">
        {t("systemHealth.enginesPulse")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {engines.map((engine, i) => {
          const [iconColor, iconBg] = engine.color.split(" ");
          return (
            <motion.div
              key={engine.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
              data-testid={`card-engine-${engine.id}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
                    <engine.icon className={`w-4 h-4 ${iconColor}`} />
                  </div>
                  <span className="text-sm font-medium text-neutral-200">{engine.name}</span>
                </div>
                <StatusDot status={engine.active ? "green" : "red"} />
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed">{engine.detail}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ErrorFeedPanel({ errors, t }: { errors: ErrorEntry[]; t: (key: string) => string }) {
  const [filter, setFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [errors]);

  const filtered = useMemo(() => {
    return errors.filter(e => {
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      if (filter && !e.message.toLowerCase().includes(filter.toLowerCase()) && !e.source.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [errors, filter, severityFilter]);

  const severityColors: Record<string, string> = {
    error: "text-red-400 bg-red-500/10 border-red-500/20",
    warning: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    info: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-2xl border border-neutral-800 bg-neutral-900/30 overflow-hidden"
      data-testid="error-feed-panel"
    >
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-neutral-200">{t("systemHealth.errorFeed")}</h3>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
            <input
              type="text"
              placeholder={t("systemHealth.filterLogs")}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 pl-8 pr-3 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="input-error-filter"
            />
          </div>
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="select-severity-filter"
          >
            <option value="all">{t("systemHealth.filterAll")}</option>
            <option value="error">{t("systemHealth.filterErrors")}</option>
            <option value="warning">{t("systemHealth.filterWarnings")}</option>
            <option value="info">{t("systemHealth.filterInfo")}</option>
          </select>
        </div>
      </div>
      <div ref={scrollRef} className="h-80 overflow-y-auto font-mono text-xs p-3 space-y-1" data-testid="error-feed-list">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600">
            <CheckCircle2 className="w-4 h-4 me-2" />
            {t("systemHealth.noErrors")}
          </div>
        ) : (
          filtered.map(entry => (
            <div
              key={entry.id}
              className={`flex items-start gap-2 px-2 py-1.5 rounded border ${severityColors[entry.severity] || severityColors.info}`}
              data-testid={`error-entry-${entry.id}`}
            >
              <span className="text-neutral-600 flex-shrink-0 whitespace-nowrap">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`px-1.5 py-0 rounded text-[10px] font-semibold uppercase flex-shrink-0 ${
                entry.severity === "error" ? "bg-red-500/20 text-red-400" :
                entry.severity === "warning" ? "bg-amber-500/20 text-amber-400" :
                "bg-blue-500/20 text-blue-400"
              }`}>
                {entry.severity}
              </span>
              <span className="text-neutral-500 flex-shrink-0">[{entry.source}]</span>
              <span className="text-neutral-300 break-all">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </motion.div>
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

export default function SystemHealth() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const lang = i18n.language.split("-")[0];
  const isAdmin = user?.role === "admin";
  const { isConnected, healthData, errors } = useSystemHealthStream(!!isAdmin);

  if (!isAdmin) {
    return (
      <div className="h-full bg-[#0a0a0a] flex items-center justify-center" dir={dir}>
        <div className="text-center space-y-4">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold text-neutral-200" data-testid="text-access-denied">{t("systemHealth.accessDenied")}</h1>
          <p className="text-sm text-neutral-500">{t("systemHealth.adminOnly")}</p>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-neutral-100" data-testid="text-page-title">{t("systemHealth.title")}</h1>
              <p className="text-sm text-neutral-500">{t("systemHealth.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              isConnected ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
            }`} data-testid="status-sse-connection">
              <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              {isConnected ? t("systemHealth.live") : t("systemHealth.disconnected")}
            </div>
            {healthData && (
              <span className="text-xs text-neutral-600" data-testid="text-uptime">
                {t("systemHealth.uptime")}: {formatUptime(healthData.uptime)}
              </span>
            )}
          </div>
        </motion.div>

        {!healthData ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            <HealthScoreHero score={healthData.healthScore} status={healthData.healthStatus} t={t} />

            <div>
              <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3" data-testid="text-section-integrations">
                {t("systemHealth.integrationsLatency")}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <ExternalServiceCard name="Tradovate" integration={healthData.integrations.tradovate} icon={Activity} index={0} t={t} />
                <ExternalServiceCard name="TopstepX" integration={healthData.integrations.topstepx} icon={Radio} index={1} t={t} />
                <ExternalServiceCard name="Stripe API" integration={healthData.integrations.stripe} icon={CreditCard} index={2} t={t} />
                <ExternalServiceCard name="OpenAI API" integration={healthData.integrations.openai} icon={Bot} index={3} t={t} />
              </div>
            </div>

            <EnginePulseSection enginePulse={healthData.enginePulse} t={t} />

            <PerformanceMetricsPanel categories={healthData.categories} t={t} />

            <div>
              <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3" data-testid="text-section-categories">
                {t("systemHealth.systemChecklist")}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {healthData.categories.map((category, i) => (
                  <CategoryCard key={category.id} category={category} index={i} lang={lang} />
                ))}
              </div>
            </div>

            <ErrorFeedPanel errors={errors} t={t} />
          </>
        )}
      </div>
    </div>
  );
}
