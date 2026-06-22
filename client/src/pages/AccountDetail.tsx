import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL, getDateLocale } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Shield, Target, Award, Activity, Calendar, AlertTriangle, CheckCircle2,
  Building, CreditCard, Clock, Loader2, ShieldAlert, XCircle,
  DollarSign, Save, FileSpreadsheet, Trash2, Lock, Download, Image as ImageIcon
} from "lucide-react";
import TradeCalendar from "@/components/TradeCalendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine, Brush, ComposedChart, Line, Legend
} from "recharts";
import type {
  Account as DbAccount, Withdrawal as DbWithdrawal, Firm, FirmTier, BalanceHistory
} from "@shared/schema";
import type { ImportedTrade } from "@shared/integrations-schema";

type AccountStage = 'phase1' | 'phase2' | 'funded' | 'payout';

const STAGE_INFO: Record<AccountStage, { color: string }> = {
  phase1: { color: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' },
  phase2: { color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  funded: { color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  payout: { color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
};

const STATUS_INFO: Record<string, { color: string; icon: any }> = {
  healthy: { color: 'text-emerald-500', icon: CheckCircle2 },
  buffer_building: { color: 'text-blue-500', icon: TrendingUp },
  near_target: { color: 'text-amber-500', icon: Target },
  ready_to_withdraw: { color: 'text-emerald-400', icon: Award },
  consistency_risk: { color: 'text-orange-500', icon: AlertTriangle },
  drawdown_risk: { color: 'text-red-500', icon: ShieldAlert },
  violated: { color: 'text-red-600', icon: XCircle },
  inactive: { color: 'text-zinc-400', icon: Clock },
  sync_failed: { color: 'text-red-600', icon: XCircle },
};

interface ConsistencyInfo {
  bestDay: number;
  totalProfit: number;
  consistencyPct: number;
  status: 'safe' | 'warning' | 'no_profit';
  threshold: number;
}

interface TradeStatsInfo {
  wins: number;
  losses: number;
  breakevens: number;
  totalTrades: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  riskReward: number;
  netPnl: number;
}

interface DrawdownInfo {
  drawdownType: 'trailing' | 'static';
  trailingAmount: number;
  trailingStopType: 'intraday' | 'eod';
  drawdownFloor: number;
  rawStop: number;
  distanceToFloor: number;
  drawdownRisk: number;
  peakBalance: number;
  lowestEquity?: number;
  breachedByLow?: boolean;
  locked: boolean;
}

interface AccountDetailData extends DbAccount {
  computedStatus: string;
  firmRules: Firm | null;
  history: BalanceHistory[];
  trades: ImportedTrade[];
  withdrawals: DbWithdrawal[];
  consistency?: ConsistencyInfo;
  tradeStats?: TradeStatsInfo;
  drawdownInfo?: DrawdownInfo;
}

export default function AccountDetail() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const isDemo = useIsDemo();
  const id = parseInt(params.id || '0');

  const [isBalanceEditMode, setIsBalanceEditMode] = useState(false);
  const [profitInput, setProfitInput] = useState('');
  const [pnlRange, setPnlRange] = useState<'7d' | '30d' | 'all'>('all');
  const [pnlMode, setPnlMode] = useState<'trade' | 'day'>('trade');
  const [pnlShowDrawdown, setPnlShowDrawdown] = useState(false);
  const [pnlShowMarkers, setPnlShowMarkers] = useState(true);
  const pnlChartRef = useRef<HTMLDivElement | null>(null);

  const { data: account, isLoading } = useQuery<AccountDetailData>({
    queryKey: [`/api/v1/accounts/${id}`],
    enabled: id > 0,
  });

  const updateBalanceMutation = useMutation({
    mutationFn: async ({ id, balance }: { id: number; balance: number }) => {
      const res = await apiRequest("PATCH", `/api/v1/accounts/${id}`, { balance });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/v1/accounts/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trading-priorities"] });
      setIsBalanceEditMode(false);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (accountId: number) => { await apiRequest("DELETE", `/api/v1/accounts/${accountId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      navigate("/");
    },
  });

  const { toast } = useToast();

  const fetchTradesMutation = useMutation({
    mutationFn: async (accountId: number) => {
      const res = await apiRequest("POST", `/api/v1/accounts/${accountId}/fetch-trades`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/v1/accounts/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
      toast({ title: t('integrations.tradesFetched'), description: `${data.tradesFromApi} ${t('integrations.tradesFound')}, ${data.newTradesSaved} ${t('integrations.newTradesSaved')}` });
    },
    onError: (err: any) => {
      toast({ title: t('integrations.fetchTradesError'), description: err?.message, variant: "destructive" });
    },
  });

  const { formatCurrency } = useCurrency();

  if (isLoading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="h-full bg-background flex flex-col items-center justify-center gap-4" dir={dir}>
        <p className="text-muted-foreground">{t('accountDetail.notFound')}</p>
      </div>
    );
  }

  const profit = account.balance - account.size;

  const useBuffer = account.bufferEnabled !== false;
  const bufferMax = useBuffer ? (account.maxDrawdown || 0) : 0;
  const currentBuffer = Math.min(Math.max(profit, 0), bufferMax);
  const bufferPercent = bufferMax > 0 ? (currentBuffer / bufferMax) * 100 : 0;
  const currentTarget = Math.max(0, profit - bufferMax);
  const targetPercent = account.target ? (currentTarget / account.target) * 100 : 0;
  const consistencyPercent = profit > 0 && account.consistencyRule && account.topDayProfit
    ? ((account.topDayProfit) / profit) * 100 : 0;
  const statusInfo = STATUS_INFO[account.computedStatus] || STATUS_INFO.healthy;
  const StatusIcon = statusInfo.icon;
  const stageInfo = STAGE_INFO[account.stage as AccountStage] || STAGE_INFO.phase1;

  const totalWithdrawals = account.withdrawals
    .filter(w => w.status === 'paid' || w.status === 'approved')
    .reduce((s, w) => s + w.amount, 0);

  const chartData = account.history.map(h => ({
    date: h.date.substring(5),
    balance: h.balance,
    profit: h.profit,
  }));

  const pnlCurveAll = (() => {
    const closed = (account.trades || [])
      .filter(t => t.realizedPnl != null && (t.closedAt || t.openedAt))
      .map(t => ({
        ts: new Date(t.closedAt || t.openedAt!).getTime(),
        pnl: t.realizedPnl as number,
      }))
      .filter(t => !isNaN(t.ts))
      .sort((a, b) => a.ts - b.ts);

    if (pnlMode === 'day') {
      const byDay = new Map<string, number>();
      for (const c of closed) {
        const d = new Date(c.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDay.set(key, (byDay.get(key) || 0) + c.pnl);
      }
      return Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, pnl]) => ({ ts: new Date(key).getTime(), pnl }));
    }
    return closed;
  })();

  const pnlCurveData = (() => {
    const now = Date.now();
    const cutoff = pnlRange === '7d' ? now - 7 * 86400000 : pnlRange === '30d' ? now - 30 * 86400000 : 0;
    const filtered = pnlCurveAll.filter(t => t.ts >= cutoff);

    let running = 0;
    let peak = 0;
    return filtered.map((t, i) => {
      running += t.pnl;
      if (running > peak) peak = running;
      const drawdown = peak - running;
      const d = new Date(t.ts);
      return {
        idx: i + 1,
        ts: t.ts,
        label: pnlMode === 'day'
          ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        cumulativePnl: Math.round(running * 100) / 100,
        tradePnl: Math.round(t.pnl * 100) / 100,
        drawdown: Math.round(drawdown * 100) / 100,
        side: t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be',
      };
    });
  })();

  const pnlMin = pnlCurveData.length > 0 ? Math.min(0, ...pnlCurveData.map(p => p.cumulativePnl)) : 0;
  const pnlMax = pnlCurveData.length > 0 ? Math.max(0, ...pnlCurveData.map(p => p.cumulativePnl)) : 0;
  const pnlGradientStop = pnlMax === pnlMin ? 0.5 : pnlMax / (pnlMax - pnlMin);

  const pnlTarget = account.target || 0;
  const pnlFinal = pnlCurveData.length > 0 ? pnlCurveData[pnlCurveData.length - 1].cumulativePnl : 0;

  const downloadPnlCsv = () => {
    const headers = ['idx', 'timestamp', 'label', 'tradePnl', 'cumulativePnl', 'drawdown', 'side'];
    const rows = pnlCurveData.map(p => [
      p.idx,
      new Date(p.ts).toISOString(),
      p.label,
      p.tradePnl,
      p.cumulativePnl,
      p.drawdown,
      p.side,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-${account.accountId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPnlPng = async () => {
    const container = pnlChartRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) { URL.revokeObjectURL(svgUrl); return; }
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(svgUrl);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pnl-${account.accountId}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const PnlMarker = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !pnlShowMarkers) return null;
    const isWin = payload.side === 'win';
    const isLoss = payload.side === 'loss';
    if (!isWin && !isLoss) return null;
    const color = isWin ? '#10b981' : '#ef4444';
    const points = isWin ? `${cx},${cy - 5} ${cx - 4},${cy + 3} ${cx + 4},${cy + 3}` : `${cx},${cy + 5} ${cx - 4},${cy - 3} ${cx + 4},${cy - 3}`;
    return <polygon points={points} fill={color} stroke={color} strokeWidth={1} opacity={0.85} />;
  };

  return (
    <div className="min-h-full bg-background text-foreground" dir={dir}>
      <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* Back + Header */}
        <div className="flex items-center justify-between rtl:flex-row-reverse">
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold">{account.name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${stageInfo.color}`}>{t(`phases.${account.stage}`)}</span>
              {(account as any).brokerActive === false && (() => {
                const reason = ((account as any).brokerStatus as string | null)?.trim() || t('account.brokerInactiveReasonUnknown');
                const updatedAt = (account as any).brokerStatusUpdatedAt as string | null;
                const tooltip = t('account.brokerInactiveTooltip', { reason })
                  + (updatedAt ? ` · ${t('account.brokerStatusUpdated', { when: new Date(updatedAt).toLocaleString(getDateLocale(i18n.language)) })}` : '');
                return (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                    data-testid="badge-broker-inactive"
                    title={tooltip}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{t('account.brokerInactive')}:</span>
                    <span dir="ltr" className="font-mono">{reason}</span>
                  </span>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground flex-wrap">
              <span className="font-mono" dir="ltr">{account.accountId}</span>
              <span className="flex items-center gap-1" dir="ltr"><Building className="w-3.5 h-3.5" /> {account.firm}</span>
              <span className={`flex items-center gap-1 ${statusInfo.color}`}><StatusIcon className="w-3.5 h-3.5" /> {t(`status.${account.computedStatus}`)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {account.dataSource !== "integration" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setProfitInput(''); setIsBalanceEditMode(true); }}
                className="h-8 text-xs gap-1.5"
                data-testid="button-quick-balance"
              >
                <DollarSign className="w-3.5 h-3.5" /> {t('accountDetail.updateBalance')}
              </Button>
            )}
            {account.computedStatus === 'sync_failed' && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { if (confirm(t('admin.confirmDeleteDesc'))) deleteAccountMutation.mutate(account.id); }}
                className="h-8 text-xs gap-1.5"
                disabled={deleteAccountMutation.isPending}
                data-testid="button-delete-sync-failed"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t('admin.deleteAccount')}
              </Button>
            )}
          </div>
        </div>

        {isBalanceEditMode && (() => {
          const dayProfit = parseFloat(profitInput) || 0;
          const newBalance = account.balance + dayProfit;
          return (
            <div className="bg-card p-4 rounded-lg border border-indigo-500/30 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <DollarSign className="w-5 h-5 text-indigo-500 shrink-0" />
                <p className="text-sm font-medium shrink-0">{t('accountDetail.todayPnl')}:</p>
                <Input
                  type="number"
                  value={profitInput}
                  onChange={e => setProfitInput(e.target.value)}
                  placeholder={t('accountDetail.pnlPlaceholder')}
                  className="bg-secondary/50 border-border text-sm h-9 font-mono text-left max-w-[180px]"
                  dir="ltr"
                  autoFocus
                  data-testid="input-quick-balance"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (profitInput && !isNaN(dayProfit)) updateBalanceMutation.mutate({ id: account.id, balance: newBalance });
                  }}
                  disabled={isDemo || updateBalanceMutation.isPending || !profitInput}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs gap-1"
                  data-testid="button-save-balance"
                >
                  {updateBalanceMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {t('common.save')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsBalanceEditMode(false)} className="h-8 text-xs">{t('common.cancel')}</Button>
              </div>
              {profitInput && (
                <p className="text-xs text-muted-foreground" dir="ltr">
                  <span className="font-mono">{formatCurrency(account.balance)}</span>
                  <span className="mx-1">{dayProfit >= 0 ? '+' : '−'}</span>
                  <span className={`font-mono font-semibold ${dayProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{formatCurrency(Math.abs(dayProfit))}</span>
                  <span className="mx-1">=</span>
                  <span className="font-mono font-bold text-foreground">{formatCurrency(newBalance)}</span>
                </p>
              )}
            </div>
          );
        })()}

        {/* Key Metrics */}
        <div className="grid grid-cols-1 min-[375px]:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          {[
            { label: t('accountDetail.accountSize'), value: formatCurrency(account.size), color: 'text-foreground' },
            { label: t('accountDetail.balance'), value: formatCurrency(account.balance), color: 'text-foreground' },
            { label: t('dashboard.pnl'), value: formatCurrency(profit), color: profit >= 0 ? 'text-emerald-500' : 'text-red-500' },
            { label: t('accountDetail.peakBalance'), value: formatCurrency(account.peakBalance || account.balance), color: 'text-indigo-500' },
            { label: t('nav.withdrawals'), value: formatCurrency(totalWithdrawals), color: 'text-purple-500' },
            { label: t('dashboard.tradingDays'), value: `${account.tradingDays || 0}${account.firmRules ? '/' + account.firmRules.minTradingDays : ''}`, color: 'text-blue-500' },
          ].map((m, i) => (
            <div key={i} className="bg-card p-4 rounded-lg border border-border" data-testid={`metric-${i}`}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{m.label}</p>
              <p className={`text-lg font-bold font-mono mt-1 ${m.color}`} dir="ltr">{m.value}</p>
            </div>
          ))}
        </div>

        {/* Progress Bars */}
        <div className={`grid grid-cols-1 ${(account.stage === 'funded' || account.stage === 'payout') ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
          {(account.stage === 'funded' || account.stage === 'payout') && (
            <div className="bg-card p-5 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-blue-500" /> {t('dashboard.buffer')}</span>
                {useBuffer ? (
                  <span className="text-xs font-mono text-muted-foreground" dir="ltr">{formatCurrency(currentBuffer)} / {formatCurrency(bufferMax)}</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t('accountDetail.disabled')}</span>
                )}
              </div>
              {useBuffer ? (
                <>
                  <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-1000 ${bufferPercent >= 100 ? 'bg-emerald-500' : bufferPercent >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(bufferPercent, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">{Math.round(bufferPercent)}% {t('accountDetail.bufferFull')}</p>
                </>
              ) : (
                <p className="text-[10px] text-muted-foreground">{t('accountDetail.noBufferDesc')}</p>
              )}
            </div>
          )}
          <div className="bg-card p-5 rounded-lg border border-border">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-indigo-500" /> {t('accountDetail.profitTarget')}</span>
              <span className="text-xs font-mono text-muted-foreground" dir="ltr">{formatCurrency(currentTarget)} / {formatCurrency(account.target || 0)}</span>
            </div>
            <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${Math.min(targetPercent, 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">{Math.round(targetPercent)}% {t('accountDetail.ofTarget')}</p>
          </div>
          <div className="bg-card p-5 rounded-lg border border-border">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-amber-500" /> {t('dashboard.consistency')}</span>
              <span className="text-xs font-mono text-muted-foreground" dir="ltr">{consistencyPercent.toFixed(1)}% / {account.consistencyRule || 0}%</span>
            </div>
            <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${
                consistencyPercent > (account.consistencyRule || 30) ? 'bg-red-500' :
                consistencyPercent > (account.consistencyRule || 30) * 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min((consistencyPercent / ((account.consistencyRule || 30) * 1.5)) * 100, 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              {t('accountDetail.peakDay')}: {formatCurrency(account.topDayProfit || 0)}
            </p>
          </div>
          {(() => {
            const dd = account.drawdownInfo;
            if (!dd || !dd.trailingAmount) return null;
            const isTrailing = dd.drawdownType === 'trailing';
            const floor = dd.drawdownFloor;
            const distance = Math.max(0, dd.distanceToFloor);
            const percent = dd.trailingAmount > 0 ? Math.max(0, Math.min((distance / dd.trailingAmount) * 100, 100)) : 100;
            const isLocked = isTrailing && dd.locked;
            const ddTitle = isTrailing
              ? (isLocked ? t('accountDetail.ddLocked') : t('accountDetail.trailingDD'))
              : t('accountDetail.staticDD');
            return (
              <div className="bg-card p-5 rounded-lg border border-border" data-testid="dd-card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                    {ddTitle}
                  </span>
                  {isTrailing && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                        isLocked
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                      }`}
                      data-testid="dd-lock-badge"
                      title={isLocked ? t('accountDetail.ddLockedTooltip') : t('accountDetail.ddTrailingTooltip')}
                    >
                      {isLocked ? <Lock className="w-2.5 h-2.5" /> : <TrendingUp className="w-2.5 h-2.5" />}
                      {isLocked ? t('accountDetail.ddLockedShort') : t('accountDetail.ddTrailingShort')}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-muted-foreground">{t('accountDetail.distanceToFloor')}</span>
                  <span className={`text-xs font-mono font-semibold ${percent >= 60 ? 'text-emerald-500' : percent >= 30 ? 'text-amber-500' : 'text-red-500'}`} dir="ltr">
                    {formatCurrency(distance)}
                  </span>
                </div>
                <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${percent >= 60 ? 'bg-emerald-500' : percent >= 30 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                  <div>
                    <p className="text-muted-foreground">{t('accountDetail.floor')}</p>
                    <p className="font-mono font-semibold text-foreground" dir="ltr">{formatCurrency(floor)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('accountDetail.peak')}</p>
                    <p className="font-mono font-semibold text-foreground" dir="ltr">{formatCurrency(dd.peakBalance)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('accountDetail.ddLimit')}</p>
                    <p className="font-mono text-foreground" dir="ltr">{formatCurrency(dd.trailingAmount)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('accountDetail.ddBasis')}</p>
                    <p className="font-mono text-foreground capitalize">{dd.trailingStopType}</p>
                  </div>
                </div>
                {dd.breachedByLow && (
                  <p className="mt-3 text-[10px] text-red-500 font-semibold flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {t('accountDetail.ddBreached')}
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        {/* Balance History Chart */}
        {chartData.length > 0 && (
          <div className="bg-card p-5 rounded-lg border border-border">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-500" /> {t('accountDetail.balanceHistory')}</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={['dataMin - 1000', 'dataMax + 1000']} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [formatCurrency(value), '']} />
                  <Area type="monotone" dataKey="balance" stroke="#6366f1" fill="#6366f1" fillOpacity={0.1} strokeWidth={2} name={t('accountDetail.balance')} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* P&L Curve (cumulative realized P&L per closed trade) */}
        <div className="bg-card p-5 rounded-lg border border-border" data-testid="account-pnl-curve">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" /> {t('accountDetail.pnlCurve')}
            </h3>
            {pnlCurveData.length > 0 && (
              <span
                className={`text-sm font-mono font-bold ${pnlFinal >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
                dir="ltr"
                data-testid="pnl-final-badge"
              >
                {pnlFinal >= 0 ? '+' : ''}{formatCurrency(pnlFinal)}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mb-3">{t('accountDetail.pnlCurveSubtitle')}</p>

          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" data-testid="pnl-range-toggle">
                {(['7d', '30d', 'all'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setPnlRange(r)}
                    className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${pnlRange === r ? 'bg-indigo-500/20 text-indigo-500' : 'text-muted-foreground hover:bg-secondary/50'}`}
                    data-testid={`pnl-range-${r}`}
                  >
                    {t(`accountDetail.pnlRange_${r}`)}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" data-testid="pnl-mode-toggle">
                {(['trade', 'day'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setPnlMode(m)}
                    className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${pnlMode === m ? 'bg-indigo-500/20 text-indigo-500' : 'text-muted-foreground hover:bg-secondary/50'}`}
                    data-testid={`pnl-mode-${m}`}
                  >
                    {t(`accountDetail.pnlMode_${m}`)}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer select-none" data-testid="pnl-toggle-drawdown">
                <input
                  type="checkbox"
                  checked={pnlShowDrawdown}
                  onChange={e => setPnlShowDrawdown(e.target.checked)}
                  className="accent-red-500"
                />
                <span className="text-muted-foreground">{t('accountDetail.pnlShowDrawdown')}</span>
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer select-none" data-testid="pnl-toggle-markers">
                <input
                  type="checkbox"
                  checked={pnlShowMarkers}
                  onChange={e => setPnlShowMarkers(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span className="text-muted-foreground">{t('accountDetail.pnlShowMarkers')}</span>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadPnlPng}
                disabled={pnlCurveData.length === 0}
                className="h-7 text-[10px] gap-1"
                data-testid="pnl-export-png"
              >
                <ImageIcon className="w-3 h-3" /> PNG
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadPnlCsv}
                disabled={pnlCurveData.length === 0}
                className="h-7 text-[10px] gap-1"
                data-testid="pnl-export-csv"
              >
                <Download className="w-3 h-3" /> CSV
              </Button>
            </div>
          </div>

          {pnlCurveData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
              {t('accountDetail.pnlNoTrades')}
            </div>
          ) : (
            <div className="h-72" ref={pnlChartRef}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pnlCurveData}>
                  <defs>
                    <linearGradient id="pnlSplit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset={`${Math.max(0, Math.min(100, pnlGradientStop * 100))}%`} stopColor="#10b981" stopOpacity={0.05} />
                      <stop offset={`${Math.max(0, Math.min(100, pnlGradientStop * 100))}%`} stopColor="#ef4444" stopOpacity={0.05} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    yAxisId="pnl"
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  {pnlShowDrawdown && (
                    <YAxis
                      yAxisId="dd"
                      orientation="right"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v: number) => formatCurrency(v)}
                      reversed
                    />
                  )}
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string) => {
                      const labelMap: Record<string, string> = {
                        cumulativePnl: t('accountDetail.pnlCurve'),
                        tradePnl: t('accountDetail.tradePnl'),
                        drawdown: t('accountDetail.pnlDrawdown'),
                      };
                      return [formatCurrency(value), labelMap[name] || name];
                    }}
                    labelFormatter={(label, payload) => {
                      const idx = payload?.[0]?.payload?.idx;
                      return idx ? `#${idx} · ${label}` : label;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />

                  <ReferenceLine yAxisId="pnl" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: '0', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  {pnlTarget > 0 && pnlTarget >= pnlMin && pnlTarget <= Math.max(pnlMax, pnlTarget) && (
                    <ReferenceLine
                      yAxisId="pnl"
                      y={pnlTarget}
                      stroke="#6366f1"
                      strokeDasharray="4 4"
                      label={{ value: `${t('accountDetail.profitTarget')}: ${formatCurrency(pnlTarget)}`, fontSize: 10, fill: '#6366f1', position: 'insideTopRight' }}
                    />
                  )}
                  <Area
                    yAxisId="pnl"
                    type="monotone"
                    dataKey="cumulativePnl"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#pnlSplit)"
                    name="cumulativePnl"
                    dot={pnlShowMarkers ? <PnlMarker /> : false}
                    activeDot={{ r: 5, fill: '#10b981', stroke: 'white', strokeWidth: 1 }}
                    isAnimationActive={false}
                  />
                  {pnlShowDrawdown && (
                    <Line
                      yAxisId="dd"
                      type="monotone"
                      dataKey="drawdown"
                      stroke="#ef4444"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      dot={false}
                      name="drawdown"
                      isAnimationActive={false}
                    />
                  )}
                  <Brush dataKey="label" height={20} stroke="#6366f1" travellerWidth={8} fill="hsl(var(--secondary))" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div data-testid="account-trade-calendar">
          <TradeCalendar accountId={account.id} />
        </div>

        {/* Firm Rules */}
        {account.firmRules && (
          <div className="bg-card p-5 rounded-lg border border-border">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-indigo-500" /> {t('accountDetail.firmRules')} - {account.firm}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: t('settings.minTradingDays'), value: account.firmRules.minTradingDays || 0, current: account.tradingDays || 0, met: (account.tradingDays || 0) >= (account.firmRules.minTradingDays || 0) },
                { label: t('accountDetail.consistencyRule'), value: `${account.consistencyRule || account.firmRules.consistencyPercentage || 30}%`, current: `${consistencyPercent.toFixed(1)}%`, met: consistencyPercent <= (account.consistencyRule || account.firmRules.consistencyPercentage || 30) },
                { label: t('accountDetail.maxDailyDD'), value: account.firmRules.dailyDrawdown != null ? `$${account.firmRules.dailyDrawdown.toLocaleString()}` : '—' },
                { label: t('accountDetail.maxTotalDD'), value: account.trailingDrawdown || account.maxDrawdown || account.firmRules.totalDrawdown ? `$${(account.trailingDrawdown || account.maxDrawdown || account.firmRules.totalDrawdown || 0).toLocaleString()}` : '—' },
                { label: t('settings.waitDays'), value: account.firmRules.withdrawalWaitDays || 0 },
              ].map((rule, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 bg-secondary/30 rounded-lg">
                  <span className="text-xs text-muted-foreground">{rule.label}</span>
                  <div className="flex items-center gap-2">
                    {rule.current !== undefined && <span className="text-xs font-mono text-muted-foreground" dir="ltr">{rule.current} /</span>}
                    <span className="text-xs font-mono font-medium" dir="ltr">{rule.value}</span>
                    {'met' in rule && (
                      rule.met ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics: Trade Stats + Consistency Engine */}
        {(account.tradeStats || account.consistency) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Trade Stats */}
            {account.tradeStats && account.tradeStats.totalTrades > 0 && (() => {
              const ts = account.tradeStats!;
              return (
                <div className="bg-card p-5 rounded-lg border border-border" data-testid="widget-trade-stats">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-500" />
                    Trade Stats
                  </h3>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: 'Total Trades', value: String(ts.totalTrades), color: 'text-foreground' },
                      { label: 'Win Rate', value: `${ts.winRatePct.toFixed(1)}%`, color: ts.winRatePct >= 50 ? 'text-emerald-500' : 'text-red-500' },
                      { label: 'Risk / Reward', value: ts.avgLoss > 0 ? `1 : ${ts.riskReward.toFixed(2)}` : '—', color: ts.riskReward >= 1 ? 'text-emerald-500' : 'text-amber-500' },
                      { label: 'Net P&L', value: formatCurrency(ts.netPnl), color: ts.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500' },
                    ].map((m, i) => (
                      <div key={i} className="p-3 bg-secondary/30 rounded-lg">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{m.label}</p>
                        <p className={`text-sm font-bold font-mono mt-1 ${m.color}`} dir="ltr">{m.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-500">{ts.wins}W</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-500">{ts.losses}L</span>
                    {ts.breakevens > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-secondary text-muted-foreground">{ts.breakevens} BE</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      avg win {formatCurrency(ts.avgWin)} · avg loss {formatCurrency(ts.avgLoss)}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Consistency Engine */}
            {account.consistency && (() => {
              const c = account.consistency!;
              const pct = c.consistencyPct * 100;
              const thresholdPct = c.threshold * 100;
              const isSafe = c.status === 'safe';
              const isNoProfit = c.status === 'no_profit';
              return (
                <div className="bg-card p-5 rounded-lg border border-border" data-testid="widget-consistency">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Activity className="w-4 h-4 text-amber-500" />
                      Consistency Engine
                    </h3>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      isSafe ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                      isNoProfit ? 'bg-secondary text-muted-foreground border-border' :
                      'bg-red-500/10 text-red-500 border-red-500/20'
                    }`}>
                      {isSafe ? 'SAFE' : isNoProfit ? 'NO DATA' : 'WARNING'}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-4">
                    Max {thresholdPct.toFixed(0)}% of total profit allowed in one day
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 bg-secondary/30 rounded-lg">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Best Day</p>
                      <p className={`text-sm font-bold font-mono mt-1 ${c.bestDay > 0 ? 'text-emerald-500' : 'text-foreground'}`} dir="ltr">
                        {formatCurrency(c.bestDay)}
                      </p>
                    </div>
                    <div className="p-3 bg-secondary/30 rounded-lg">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Profit</p>
                      <p className={`text-sm font-bold font-mono mt-1 ${c.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">
                        {formatCurrency(c.totalProfit)}
                      </p>
                    </div>
                  </div>

                  {!isNoProfit && (
                    <>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-muted-foreground">Best day share</span>
                        <span className={`text-[10px] font-mono font-bold ${isSafe ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      {/* Progress bar — green if safe, red if warning */}
                      <div className="relative h-2.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${isSafe ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      {/* Threshold marker */}
                      <div className="relative h-3 mt-0.5">
                        <div
                          className="absolute top-0 w-0.5 h-3 bg-amber-400 rounded-full"
                          style={{ left: `calc(${Math.min(thresholdPct, 100)}% - 1px)` }}
                          title={`${thresholdPct.toFixed(0)}% limit`}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-muted-foreground">0%</p>
                        <p className="text-[10px] text-amber-400">▲ {thresholdPct.toFixed(0)}% limit</p>
                        <p className="text-[10px] text-muted-foreground">100%</p>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        {/* Trade History */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> {t('accountDetail.tradeHistory')}</h3>
            {account.integrationConnectionId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchTradesMutation.mutate(account.id)}
                disabled={isDemo || fetchTradesMutation.isPending}
                className="h-7 text-xs gap-1.5"
                data-testid="button-fetch-trades"
              >
                {fetchTradesMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                )}
                {t('integrations.fetchTrades')}
              </Button>
            )}
          </div>
          {(!account.trades || account.trades.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="w-6 h-6 mb-2" /><p className="text-xs">{t('accountDetail.noTrades')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm" dir="ltr">
                <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold sticky top-0 bg-card">
                  <tr>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.instrument')}</th>
                    <th className="px-4 py-2.5 font-medium text-center">{t('accountDetail.side')}</th>
                    <th className="px-4 py-2.5 font-medium text-center">{t('accountDetail.contracts')}</th>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.entryPrice')}</th>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.exitPrice')}</th>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.tradePnl')}</th>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.entryTime')}</th>
                    <th className="px-4 py-2.5 font-medium text-left">{t('accountDetail.exitTime')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {account.trades.map(trade => (
                    <tr key={trade.id} className="hover:bg-secondary/40 transition-colors text-xs" data-testid={`row-trade-${trade.id}`}>
                      <td className="px-4 py-2.5 font-mono font-medium">{trade.symbol || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          trade.side?.toLowerCase() === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                        }`}>{trade.side || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono">{trade.quantity || 0}</td>
                      <td className="px-4 py-2.5 font-mono">{trade.entryPrice ? `$${trade.entryPrice.toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-2.5 font-mono">{trade.exitPrice ? `$${trade.exitPrice.toLocaleString()}` : '—'}</td>
                      <td className={`px-4 py-2.5 font-mono font-semibold ${(trade.realizedPnl || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {trade.realizedPnl != null ? `${trade.realizedPnl >= 0 ? '+' : ''}$${trade.realizedPnl.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {trade.openedAt ? new Date(trade.openedAt).toLocaleString(getDateLocale(i18n.language), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {trade.closedAt ? new Date(trade.closedAt).toLocaleString(getDateLocale(i18n.language), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Withdrawals History */}
        {account.withdrawals.length > 0 && (
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <h3 className="text-sm font-semibold p-5 pb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-purple-500" /> {t('accountDetail.withdrawalHistory')}</h3>
            <div className="overflow-x-auto">
            <table className="w-full text-right text-sm min-w-[600px]">
              <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                <tr>
                  <th className="px-5 py-2.5 font-medium text-left">{t('withdrawal.amount')}</th>
                  <th className="px-5 py-2.5 font-medium">{t('withdrawal.dateRequested')}</th>
                  <th className="px-5 py-2.5 font-medium">{t('withdrawal.dateApproved')}</th>
                  <th className="px-5 py-2.5 font-medium">{t('withdrawal.datePaid')}</th>
                  <th className="px-5 py-2.5 font-medium text-center">{t('withdrawal.status')}</th>
                  <th className="px-5 py-2.5 font-medium">{t('withdrawal.notes')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {account.withdrawals.map(w => {
                  const statusStyles: Record<string, string> = {
                    pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                    approved: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                    paid: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                    rejected: 'bg-red-500/10 text-red-600 border-red-500/20',
                  };
                  return (
                    <tr key={w.id} className="hover:bg-secondary/40 transition-colors">
                      <td className="px-5 py-3 text-left" dir="ltr"><span className="font-mono font-semibold text-emerald-500">+{formatCurrency(w.amount)}</span></td>
                      <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.dateRequested}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.dateApproved || '—'}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.datePaid || '—'}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusStyles[w.status]}`}>
                          {t(`withdrawal.status${w.status.charAt(0).toUpperCase() + w.status.slice(1)}`)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{w.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
