import { useState, useEffect, useMemo, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Activity, AlertTriangle, Shield, ShieldAlert, ShieldCheck,
  ChevronDown, Clock, RefreshCw, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart, Legend, Line
} from "recharts";

interface DrawdownStatus {
  accountId: number;
  accountName: string;
  firm: string;
  startingBalance: number;
  currentEquity: number;
  hwm: number;
  trailingStop: number;
  drawdownRisk: number;
  distanceToStop: number;
  maxDrawdownLimit: number;
  status: "safe" | "warning" | "critical" | "breached";
  lastTickAt: string | null;
  accountStatus: string;
}

interface EquityTick {
  id: number;
  accountId: number;
  timestamp: string;
  equity: number;
  hwm: number;
  trailingStop: number;
  drawdownRisk: number;
  breached: boolean;
}

const TIME_RANGES = [
  { label: "1H", hours: 1 },
  { label: "4H", hours: 4 },
  { label: "1D", hours: 24 },
  { label: "1W", hours: 168 },
  { label: "30D", hours: 720 },
  { label: "All", hours: 0 },
];

function getChartColorsFromCSS() {
  const style = getComputedStyle(document.documentElement);
  const borderHsl = style.getPropertyValue("--border").trim();
  const mutedFgHsl = style.getPropertyValue("--muted-foreground").trim();
  return {
    grid: borderHsl ? `hsl(${borderHsl})` : "#333333",
    axis: mutedFgHsl ? `hsl(${mutedFgHsl})` : "#8c8c8c",
  };
}

function useChartColors() {
  const [colors, setColors] = useState(getChartColorsFromCSS);
  useEffect(() => {
    const update = () => setColors(getChartColorsFromCSS());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "breached":
      return <ShieldAlert className="w-4 h-4 text-red-500" />;
    case "critical":
      return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    default:
      return <ShieldCheck className="w-4 h-4 text-emerald-500" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    safe: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    critical: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    breached: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <Badge className={`${styles[status] || styles.safe} border text-[10px] uppercase tracking-wider`} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

function RiskGauge({ risk }: { risk: number }) {
  const color = risk >= 90 ? "#ef4444" : risk >= 80 ? "#f97316" : risk >= 50 ? "#eab308" : "#22c55e";
  return (
    <div className="flex items-center gap-2" data-testid="risk-gauge">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(risk, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono min-w-[40px] text-right" style={{ color }}>
        {risk.toFixed(1)}%
      </span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-xl text-xs">
      <div className="text-muted-foreground mb-2">{new Date(data.timestamp).toLocaleString()}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Equity</span>
          <span className="text-emerald-400 font-mono">${data.equity?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">HWM</span>
          <span className="text-indigo-400 font-mono">${data.hwm?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Trail Stop</span>
          <span className="text-amber-400 font-mono">${data.trailingStop?.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Risk</span>
          <span className={`font-mono ${data.drawdownRisk >= 80 ? "text-red-400" : "text-foreground"}`}>
            {data.drawdownRisk?.toFixed(1)}%
          </span>
        </div>
        {data.breached && (
          <div className="text-red-400 font-semibold mt-1">⚠ BREACH DETECTED</div>
        )}
      </div>
    </div>
  );
}


export function DrawdownEvaluatorWidget() {
  const [statuses, setStatuses] = useState<DrawdownStatus[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [ticks, setTicks] = useState<EquityTick[]>([]);
  const [timeRange, setTimeRange] = useState(0);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [loadingTicks, setLoadingTicks] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const chartColors = useChartColors();
  const hasAutoSelected = useRef(false);

  const fetchStatuses = async () => {
    try {
      const res = await apiRequest("GET", "/api/v1/drawdown/status");
      const data = await res.json();
      setStatuses(data);
      if (!hasAutoSelected.current && data.length > 0) {
        hasAutoSelected.current = true;
        const withTicks = data.find((s: DrawdownStatus) => s.lastTickAt !== null);
        setSelectedAccountId((withTicks || data[0]).accountId);
      }
    } catch (err) {
      console.error("Failed to fetch drawdown statuses:", err);
    } finally {
      setLoadingStatuses(false);
    }
  };

  const fetchTicks = async (accountId: number) => {
    setLoadingTicks(true);
    try {
      const params = new URLSearchParams();
      if (timeRange > 0) {
        const from = new Date(Date.now() - timeRange * 3600 * 1000);
        params.set("from", from.toISOString());
      }
      const res = await apiRequest("GET", `/api/v1/equity-ticks/${accountId}?${params}`);
      const data = await res.json();
      setTicks(data);
    } catch (err) {
      console.error("Failed to fetch equity ticks:", err);
      setTicks([]);
    } finally {
      setLoadingTicks(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      fetchTicks(selectedAccountId);
      const interval = setInterval(() => fetchTicks(selectedAccountId), 15000);
      return () => clearInterval(interval);
    }
  }, [selectedAccountId, timeRange]);

  const selectedStatus = statuses.find(s => s.accountId === selectedAccountId);

  const summaryStats = useMemo(() => {
    const safe = statuses.filter(s => s.status === "safe").length;
    const warning = statuses.filter(s => s.status === "warning").length;
    const critical = statuses.filter(s => s.status === "critical").length;
    const breached = statuses.filter(s => s.status === "breached").length;
    return { safe, warning, critical, breached, total: statuses.length };
  }, [statuses]);

  const chartData = useMemo(() => {
    return ticks.map((t, idx) => {
      const d = new Date(t.timestamp);
      const timeLabel = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const dateLabel = d.toLocaleDateString([], { month: "short", day: "numeric" });
      return {
        ...t,
        time: timeLabel,
        date: `${dateLabel} ${timeLabel}`,
        tickKey: `${d.getTime()}-${idx}`,
      };
    });
  }, [ticks]);

  const breachPoints = useMemo(() => chartData.filter(d => d.breached), [chartData]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100000];
    const allVals = chartData.flatMap(d => [d.equity, d.hwm, d.trailingStop]);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const padding = (max - min) * 0.1 || 100;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{summaryStats.total} monitored</span>
            <span className="text-emerald-400">{summaryStats.safe} safe</span>
            {(summaryStats.warning + summaryStats.critical) > 0 && <span className="text-amber-400">{summaryStats.warning + summaryStats.critical} at risk</span>}
            {summaryStats.breached > 0 && <span className="text-red-400">{summaryStats.breached} breached</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setLoadingStatuses(true); fetchStatuses(); }}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            data-testid="button-refresh-drawdown"
          >
            <RefreshCw className={`w-3 h-3 ${loadingStatuses ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="relative">
                <button
                  onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                  className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground hover:border-ring min-w-[180px]"
                  data-testid="button-account-selector"
                >
                  {selectedStatus ? (
                    <>
                      <StatusIcon status={selectedStatus.status} />
                      <span className="truncate">{selectedStatus.accountName}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select account...</span>
                  )}
                  <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto" />
                </button>
                {accountDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-full bg-popover border border-border rounded-lg shadow-xl z-50 max-h-[250px] overflow-y-auto">
                    {statuses.map(s => (
                      <button
                        key={s.accountId}
                        onClick={() => { setSelectedAccountId(s.accountId); setAccountDropdownOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent ${s.accountId === selectedAccountId ? "bg-accent" : ""}`}
                        data-testid={`select-account-${s.accountId}`}
                      >
                        <StatusIcon status={s.status} />
                        <span className="truncate text-foreground">{s.accountName}</span>
                        <StatusBadge status={s.status} />
                      </button>
                    ))}
                    {statuses.length === 0 && (
                      <div className="px-3 py-3 text-center text-muted-foreground text-[10px]">
                        No accounts with drawdown rules
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-0.5 bg-background border border-border rounded-lg p-0.5">
                {TIME_RANGES.map(range => (
                  <button
                    key={range.label}
                    onClick={() => setTimeRange(range.hours)}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      timeRange === range.hours
                        ? "bg-indigo-500/20 text-indigo-400"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-range-${range.label}`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[280px]">
              {loadingTicks ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Activity className="w-10 h-10 mb-2" />
                  <p className="text-xs">No equity tick data yet</p>
                  <p className="text-[10px] mt-1">Data will appear when accounts sync with brokers</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="equityFillWidget" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                    <XAxis
                      dataKey={timeRange <= 24 ? "time" : "date"}
                      stroke={chartColors.axis}
                      tick={{ fontSize: 9 }}
                      interval="preserveStartEnd"
                      allowDuplicatedCategory={false}
                    />
                    <YAxis
                      domain={yDomain}
                      stroke={chartColors.axis}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: "10px", paddingTop: "6px" }}
                      iconType="line"
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      fill="url(#equityFillWidget)"
                      stroke="#6366f1"
                      strokeWidth={2}
                      name="Equity"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="hwm"
                      stroke="#818cf8"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      name="HWM"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="trailingStop"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      name="Trailing Stop"
                      dot={false}
                      isAnimationActive={false}
                    />
                    {breachPoints.length > 0 && breachPoints.slice(0, 5).map((bp, idx) => (
                      <ReferenceLine
                        key={`breach-${idx}`}
                        x={timeRange <= 24 ? bp.time : bp.date}
                        stroke="#ef4444"
                        strokeDasharray="3 3"
                        label={{ value: "BREACH", position: "top", fill: "#ef4444", fontSize: 9 }}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {selectedStatus && (
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Starting Balance</div>
                  <div className="text-xs font-mono text-foreground" data-testid="text-starting-balance">
                    ${selectedStatus.startingBalance.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Equity</div>
                  <div className={`text-xs font-mono ${selectedStatus.currentEquity >= selectedStatus.startingBalance ? "text-emerald-400" : "text-red-400"}`} data-testid="text-current-equity">
                    ${selectedStatus.currentEquity.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">HWM</div>
                  <div className="text-xs font-mono text-indigo-400" data-testid="text-hwm">
                    ${selectedStatus.hwm.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Trailing Stop</div>
                  <div className="text-xs font-mono text-amber-400" data-testid="text-trailing-stop">
                    ${selectedStatus.trailingStop.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Distance to Stop</div>
                  <div className={`text-xs font-mono ${selectedStatus.distanceToStop > 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="text-distance">
                    ${selectedStatus.distanceToStop.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Drawdown Risk</div>
                <RiskGauge risk={selectedStatus.drawdownRisk} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                All Accounts
              </h3>
            </div>

            {loadingStatuses && statuses.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            ) : statuses.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-[10px]">
                <Shield className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
                <p>No accounts with drawdown rules found</p>
                <p className="mt-1">Connect a broker and set drawdown limits</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {statuses.map(s => (
                  <motion.button
                    key={s.accountId}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => { setSelectedAccountId(s.accountId); setAccountDropdownOpen(false); }}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                      s.accountId === selectedAccountId
                        ? "bg-indigo-500/10 border-indigo-500/30"
                        : "bg-background border-border hover:border-ring"
                    }`}
                    data-testid={`card-account-${s.accountId}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={s.status} />
                        <span className="text-[11px] font-medium text-foreground truncate max-w-[110px]">{s.accountName}</span>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">{s.firm}</span>
                      <span className="font-mono text-muted-foreground">${s.currentEquity.toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5">
                      <RiskGauge risk={s.drawdownRisk} />
                    </div>
                    {s.lastTickAt && (
                      <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(s.lastTickAt).toLocaleString()}
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
