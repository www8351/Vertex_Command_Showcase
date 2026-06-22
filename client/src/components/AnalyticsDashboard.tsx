import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, ReferenceLine,
} from "recharts";
import {
  Activity, TrendingUp, TrendingDown, Target, Zap, Timer, Trophy,
  BarChart3, AlertTriangle, Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { subDays, subMonths, startOfDay } from "date-fns";
import { apiUrl } from "@/lib/apiBase";

const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];
const UP_COLOR = "#4ade80";
const DOWN_COLOR = "#f87171";

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 11,
  color: "hsl(var(--foreground))",
};

interface TradeMetrics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number | null;
  profitFactorInfinite: boolean;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  largestWin: number;
  largestLoss: number;
  avgRMultiple: number | null;
  rMultipleDistribution: { range: string; count: number }[];
  mae: { avgMae: number | null; maxMae: number | null; maeBySide: Record<string, { avgMae: number; maxMae: number; count: number }> };
  mfe: { avgMfe: number | null; maxMfe: number | null };
  equityCurve: { tradeIndex: number; timestamp: string | null; cumulativePnl: number; pnl: number }[];
  dailyStats: { tradingDays: number; avgDailyPnl: number; avgTradesPerDay: number; bestDay: number; worstDay: number };
  streaks: { maxWinStreak: number; maxLossStreak: number; currentStreak: number; currentStreakType: string };
  durationStats: { avgDurationMinutes: number | null; medianDurationMinutes: number | null; minDurationMinutes: number | null; maxDurationMinutes: number | null };
  symbolBreakdown: { symbol: string; totalTrades: number; netPnl: number; winRate: number; avgPnl: number }[];
  hourlyDistribution: { hour: number; totalTrades: number; netPnl: number; winRate: number }[];
}

interface RiskSummary {
  totalInterventions: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  avgExecutionMs: number | null;
  totalPositionsClosed: number;
  totalOrdersCancelled: number;
  timeline: { timestamp: string | null; type: string | null; accountName: string | null; riskPercent: number | null; status: string | null }[];
}

interface CopyPerformance {
  totalOrders: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgSlippageTicks: number | null;
  avgSlippageDollars: number | null;
  fillRate: number;
  latencyDistribution: { range: string; count: number }[];
}

type DateRange = "7d" | "30d" | "90d" | "1y" | "all";

function getDateParams(range: DateRange): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const map: Record<string, Date> = {
    "7d": subDays(now, 7),
    "30d": subDays(now, 30),
    "90d": subDays(now, 90),
    "1y": subMonths(now, 12),
  };
  return { from: startOfDay(map[range]).toISOString() };
}

async function fetchAnalytics<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(apiUrl(`/api/v1/analytics/${endpoint}${qs ? "?" + qs : ""}`), { credentials: "include" });
  if (!res.ok) {
    if (res.status === 502 || res.status === 504) throw new Error("Analytics service unavailable");
    throw new Error(`Analytics error: ${res.status}`);
  }
  return res.json();
}

function KpiCard({ label, value, sub, icon: Icon, color = "text-foreground" }: {
  label: string; value: string | number; sub?: string; icon: any; color?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <p className={`text-xl font-bold font-mono ${color}`} dir="ltr">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-1" dir="ltr">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ServiceUnavailable() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <AlertTriangle className="w-8 h-8 mb-3 text-amber-500" />
      <p className="text-sm font-medium">שירות האנליטיקס אינו זמין</p>
      <p className="text-xs mt-1">Analytics service is not running</p>
    </div>
  );
}

export function AnalyticsDashboard() {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [source, setSource] = useState<"imported" | "journal">("imported");

  const dateParams = useMemo(() => getDateParams(dateRange), [dateRange]);

  const { data: metrics, isLoading: metricsLoading, isError: metricsError } = useQuery<TradeMetrics>({
    queryKey: ["analytics-trade-metrics", dateRange, source],
    queryFn: () => fetchAnalytics<TradeMetrics>("trade-metrics", { ...dateParams, source }),
    staleTime: 60_000,
    retry: 1,
  });

  const { data: riskData, isLoading: riskLoading, isError: riskError } = useQuery<RiskSummary>({
    queryKey: ["analytics-risk-summary", dateRange],
    queryFn: () => fetchAnalytics<RiskSummary>("risk-summary", dateParams),
    staleTime: 60_000,
    retry: 1,
  });

  const { data: copyData, isLoading: copyLoading, isError: copyError } = useQuery<CopyPerformance>({
    queryKey: ["analytics-copy-performance", dateRange],
    queryFn: () => fetchAnalytics<CopyPerformance>("copy-performance", dateParams),
    staleTime: 60_000,
    retry: 1,
  });

  const dateRanges: { key: DateRange; label: string }[] = [
    { key: "7d", label: "7 ימים" },
    { key: "30d", label: "30 ימים" },
    { key: "90d", label: "90 ימים" },
    { key: "1y", label: "שנה" },
    { key: "all", label: "הכל" },
  ];

  if (metricsError) return <ServiceUnavailable />;

  return (
    <div className="space-y-6" data-testid="section-analytics-dashboard">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" />
          {t("nav.analytics", "אנליטיקס מתקדם")}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-secondary/50 rounded-lg p-0.5">
            {dateRanges.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${dateRange === key ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`button-range-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex bg-secondary/50 rounded-lg p-0.5">
            <button
              onClick={() => setSource("imported")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${source === "imported" ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-source-imported"
            >
              עסקאות
            </button>
            <button
              onClick={() => setSource("journal")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${source === "journal" ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-source-journal"
            >
              יומן
            </button>
          </div>
        </div>
      </div>

      {metricsLoading ? <LoadingSkeleton /> : metrics && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="סה״כ עסקאות" value={metrics.totalTrades} icon={BarChart3} color="text-indigo-500" />
            <KpiCard
              label="אחוז הצלחה"
              value={`${(metrics.winRate * 100).toFixed(1)}%`}
              sub={`${metrics.winCount}W / ${metrics.lossCount}L`}
              icon={Target}
              color={metrics.winRate >= 0.5 ? "text-emerald-500" : "text-red-500"}
            />
            <KpiCard
              label="P&L נטו"
              value={`$${metrics.netPnl.toLocaleString()}`}
              icon={metrics.netPnl >= 0 ? TrendingUp : TrendingDown}
              color={metrics.netPnl >= 0 ? "text-emerald-500" : "text-red-500"}
            />
            <KpiCard
              label="Profit Factor"
              value={metrics.profitFactorInfinite ? "∞" : metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"}
              icon={Trophy}
              color={metrics.profitFactor != null && metrics.profitFactor >= 1.5 ? "text-emerald-500" : metrics.profitFactor != null && metrics.profitFactor >= 1 ? "text-amber-500" : "text-red-500"}
            />
            <KpiCard
              label="Expectancy"
              value={`$${metrics.expectancy.toFixed(2)}`}
              icon={Zap}
              color={metrics.expectancy >= 0 ? "text-emerald-500" : "text-red-500"}
            />
            <KpiCard
              label="R ממוצע"
              value={metrics.avgRMultiple != null ? `${metrics.avgRMultiple.toFixed(2)}R` : "—"}
              icon={Target}
              color={metrics.avgRMultiple != null && metrics.avgRMultiple > 0 ? "text-emerald-500" : "text-red-500"}
            />
          </div>

          {metrics.equityCurve.length > 0 && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-500" /> עקומת הון (Equity Curve)
                </h3>
                <div className="h-[280px]" data-testid="chart-equity-curve">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics.equityCurve}>
                      <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={metrics.netPnl >= 0 ? UP_COLOR : DOWN_COLOR} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={metrics.netPnl >= 0 ? UP_COLOR : DOWN_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                      <XAxis
                        dataKey="tradeIndex"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${v.toLocaleString()}`}
                        width={70}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
                        labelFormatter={(idx) => `עסקה #${idx}`}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                      <Area
                        type="monotone"
                        dataKey="cumulativePnl"
                        stroke={metrics.netPnl >= 0 ? UP_COLOR : DOWN_COLOR}
                        fill="url(#equityGrad)"
                        strokeWidth={2}
                        dot={false}
                        name="P&L מצטבר"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metrics.rMultipleDistribution.length > 0 && (
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-violet-500" /> התפלגות R-Multiple
                  </h3>
                  <div className="h-[220px]" data-testid="chart-r-multiple">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.rMultipleDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                        <XAxis dataKey="range" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="count" name="עסקאות" radius={[4, 4, 0, 0]}>
                          {metrics.rMultipleDistribution.map((entry, i) => (
                            <Cell key={i} fill={entry.range.startsWith("-") || entry.range.startsWith("<") ? DOWN_COLOR : UP_COLOR} opacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {metrics.hourlyDistribution.length > 0 && (
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Timer className="w-4 h-4 text-cyan-500" /> התפלגות לפי שעה
                  </h3>
                  <div className="h-[220px]" data-testid="chart-hourly">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.hourlyDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(h) => `${h}:00`} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(h) => `${h}:00`} />
                        <Bar dataKey="netPnl" name="P&L" radius={[4, 4, 0, 0]}>
                          {metrics.hourlyDistribution.map((entry, i) => (
                            <Cell key={i} fill={entry.netPnl >= 0 ? UP_COLOR : DOWN_COLOR} opacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">MAE / MFE</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Maximum Adverse Excursion</p>
                    <p className="text-lg font-bold font-mono text-red-500" dir="ltr" data-testid="text-mae">
                      {metrics.mae.avgMae != null ? `${metrics.mae.avgMae.toFixed(2)}%` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground" dir="ltr">
                      Max: {metrics.mae.maxMae != null ? `${metrics.mae.maxMae.toFixed(2)}%` : "—"}
                    </p>
                    {Object.entries(metrics.mae.maeBySide).map(([side, data]) => (
                      <div key={side} className="text-[10px] text-muted-foreground" dir="ltr">
                        {side.toUpperCase()}: {data.avgMae.toFixed(2)}% avg ({data.count} trades)
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Maximum Favorable Excursion</p>
                    <p className="text-lg font-bold font-mono text-emerald-500" dir="ltr" data-testid="text-mfe">
                      {metrics.mfe.avgMfe != null ? `${metrics.mfe.avgMfe.toFixed(2)}%` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground" dir="ltr">
                      Max: {metrics.mfe.maxMfe != null ? `${metrics.mfe.maxMfe.toFixed(2)}%` : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">סטטיסטיקות יומיות</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">ימי מסחר</p>
                    <p className="text-lg font-bold font-mono" dir="ltr">{metrics.dailyStats.tradingDays}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">P&L יומי ממוצע</p>
                    <p className={`text-lg font-bold font-mono ${metrics.dailyStats.avgDailyPnl >= 0 ? "text-emerald-500" : "text-red-500"}`} dir="ltr">
                      ${metrics.dailyStats.avgDailyPnl.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">יום הכי טוב</p>
                    <p className="text-sm font-bold font-mono text-emerald-500" dir="ltr">${metrics.dailyStats.bestDay.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">יום הכי גרוע</p>
                    <p className="text-sm font-bold font-mono text-red-500" dir="ltr">${metrics.dailyStats.worstDay.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">רצף ניצחונות</p>
                      <p className="text-sm font-bold font-mono text-emerald-500" dir="ltr">{metrics.streaks.maxWinStreak}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">רצף הפסדים</p>
                      <p className="text-sm font-bold font-mono text-red-500" dir="ltr">{metrics.streaks.maxLossStreak}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">רצף נוכחי</p>
                      <p className={`text-sm font-bold font-mono ${metrics.streaks.currentStreakType === "win" ? "text-emerald-500" : metrics.streaks.currentStreakType === "loss" ? "text-red-500" : "text-muted-foreground"}`} dir="ltr">
                        {metrics.streaks.currentStreak} {metrics.streaks.currentStreakType === "win" ? "W" : metrics.streaks.currentStreakType === "loss" ? "L" : ""}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {metrics.symbolBreakdown.length > 0 && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">ביצועים לפי מכשיר</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-symbol-breakdown">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-right py-2 px-2 font-semibold">מכשיר</th>
                        <th className="text-center py-2 px-2 font-semibold">עסקאות</th>
                        <th className="text-center py-2 px-2 font-semibold">Win Rate</th>
                        <th className="text-left py-2 px-2 font-semibold">P&L נטו</th>
                        <th className="text-left py-2 px-2 font-semibold">P&L ממוצע</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.symbolBreakdown.slice(0, 15).map((sym) => (
                        <tr key={sym.symbol} className="border-b border-border/50 hover:bg-secondary/30">
                          <td className="py-2 px-2 font-mono font-medium" dir="ltr">{sym.symbol}</td>
                          <td className="py-2 px-2 text-center">{sym.totalTrades}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={sym.winRate >= 0.5 ? "text-emerald-500" : "text-red-500"}>
                              {(sym.winRate * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className={`py-2 px-2 text-left font-mono ${sym.netPnl >= 0 ? "text-emerald-500" : "text-red-500"}`} dir="ltr">
                            ${sym.netPnl.toLocaleString()}
                          </td>
                          <td className={`py-2 px-2 text-left font-mono ${sym.avgPnl >= 0 ? "text-emerald-500" : "text-red-500"}`} dir="ltr">
                            ${sym.avgPnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {riskLoading && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground ms-2">טוען נתוני סיכון...</span>
            </div>
          </CardContent>
        </Card>
      )}
      {riskError && (
        <Card className="bg-card border-border border-amber-500/30">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 inline-block me-1" /> שגיאה בטעינת נתוני סיכון
          </CardContent>
        </Card>
      )}
      {!riskLoading && !riskError && riskData && riskData.totalInterventions > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> סיכום התערבויות סיכון
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">סה״כ התערבויות</p>
                <p className="text-lg font-bold font-mono text-amber-500" dir="ltr">{riskData.totalInterventions}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">פוזיציות שנסגרו</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{riskData.totalPositionsClosed}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">פקודות שבוטלו</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{riskData.totalOrdersCancelled}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">זמן ביצוע ממוצע</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{riskData.avgExecutionMs != null ? `${riskData.avgExecutionMs}ms` : "—"}</p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(riskData.byType).map(([type, count]) => (
                <span key={type} className="px-2 py-1 rounded-md bg-secondary/50 text-xs font-mono" dir="ltr">
                  {type}: {count}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {copyLoading && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground ms-2">טוען נתוני קופי...</span>
            </div>
          </CardContent>
        </Card>
      )}
      {copyError && (
        <Card className="bg-card border-border border-cyan-500/30">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 inline-block me-1" /> שגיאה בטעינת נתוני קופי טריידינג
          </CardContent>
        </Card>
      )}
      {!copyLoading && !copyError && copyData && copyData.totalOrders > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-500" /> ביצועי קופי טריידינג
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">סה״כ פקודות</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{copyData.totalOrders}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Latency ממוצע</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{copyData.avgLatencyMs != null ? `${copyData.avgLatencyMs}ms` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">P95 Latency</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{copyData.p95LatencyMs != null ? `${copyData.p95LatencyMs}ms` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Slippage ממוצע</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{copyData.avgSlippageTicks != null ? `${copyData.avgSlippageTicks} ticks` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Fill Rate</p>
                <p className="text-lg font-bold font-mono text-emerald-500" dir="ltr">{(copyData.fillRate * 100).toFixed(1)}%</p>
              </div>
            </div>
            {copyData.latencyDistribution.length > 0 && (
              <div className="h-[180px]" data-testid="chart-latency">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={copyData.latencyDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis dataKey="range" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="פקודות" fill="#06b6d4" radius={[4, 4, 0, 0]} opacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {metrics && metrics.durationStats.avgDurationMinutes != null && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Timer className="w-4 h-4 text-orange-500" /> משך עסקאות
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">ממוצע</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{formatDuration(metrics.durationStats.avgDurationMinutes)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">חציון</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{formatDuration(metrics.durationStats.medianDurationMinutes)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">מינימום</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{formatDuration(metrics.durationStats.minDurationMinutes)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">מקסימום</p>
                <p className="text-lg font-bold font-mono" dir="ltr">{formatDuration(metrics.durationStats.maxDurationMinutes)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
