import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Activity, DollarSign, TrendingUp, TrendingDown, ShieldAlert } from "lucide-react";

interface AccountSnapshot {
  accountId: number;
  accountName: string;
  cashBalance: number;
  netLiquidatingValue: number;
  autoLiquidateThreshold: number;
  initialMargin: number;
  maintenanceMargin: number;
  realizedPnlToday: number;
  unrealizedPnl: number;
  updatedAt: number;
}

type PositionSide = 'long' | 'short' | 'flat';

interface PositionSnapshot {
  accountId: number;
  symbol: string;
  productCode: string;
  netPosition: number;
  side: PositionSide;
  averageEntryPrice: number;
  currentMarketPrice: number;
  unrealizedPnl: number;
  tickSize: number;
  pointValue: number;
  updatedAt: number;
}

interface AccountStateResponse {
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: unknown[];
  recentFills: unknown[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

const fmtPrice = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);

export default function TradingMonitor() {
  const [refreshKey, setRefreshKey] = useState(0);

  const accountsQuery = useQuery<AccountSnapshot[]>({
    queryKey: ['/api/monitor/accounts', refreshKey],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/monitor/accounts');
      return res.json();
    },
  });

  const accounts = accountsQuery.data ?? [];

  const detailQueries = useQueries({
    queries: accounts.map(a => ({
      queryKey: ['/api/monitor/account', a.accountId, refreshKey],
      queryFn: async (): Promise<AccountStateResponse> => {
        const res = await apiRequest('GET', `/api/monitor/account/${a.accountId}`);
        return res.json();
      },
      enabled: !!a.accountId,
    })),
  });

  const refreshAll = () => setRefreshKey(k => k + 1);

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-emerald-500" /> Trading Monitor
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Raw Tradovate / TopstepX state · {accounts.length} account{accounts.length === 1 ? '' : 's'} tracked
            </p>
          </div>
          <Button
            onClick={refreshAll}
            disabled={accountsQuery.isFetching || detailQueries.some(q => q.isFetching)}
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            data-testid="btn-refresh-monitor"
          >
            {accountsQuery.isFetching || detailQueries.some(q => q.isFetching)
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh Data
          </Button>
        </div>

        {accountsQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {accountsQuery.isError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-500">
            Failed to load accounts: {(accountsQuery.error as any)?.message ?? 'unknown error'}
          </div>
        )}

        {!accountsQuery.isLoading && accounts.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">No accounts currently tracked by the data service.</p>
            <p className="text-xs text-muted-foreground mt-2">
              Register an account via <code className="px-1 py-0.5 rounded bg-secondary">tradovateData.registerAccount(...)</code> on the server.
            </p>
          </div>
        )}

        <div className="space-y-5">
          {accounts.map((acc, i) => {
            const detail = detailQueries[i]?.data;
            const positions = detail?.positions ?? [];
            const isStale = acc.updatedAt && Date.now() - acc.updatedAt > 60_000;
            return (
              <AccountCard
                key={acc.accountId}
                account={acc}
                positions={positions}
                isStale={!!isStale}
                isLoading={detailQueries[i]?.isFetching ?? false}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AccountCard({
  account,
  positions,
  isStale,
  isLoading,
}: {
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  isStale: boolean;
  isLoading: boolean;
}) {
  const cashVsNlv = account.netLiquidatingValue - account.cashBalance;
  const distanceToFloor = account.netLiquidatingValue - account.autoLiquidateThreshold;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden" data-testid={`monitor-account-${account.accountId}`}>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {account.accountName}
            {isStale && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-500">
                STALE
              </span>
            )}
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground" dir="ltr">ID: {account.accountId}</p>
        </div>
        <p className="text-[10px] text-muted-foreground" dir="ltr">
          Updated {new Date(account.updatedAt).toLocaleTimeString()}
        </p>
      </div>

      {/* Balances grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border">
        <Metric label="Cash Balance" value={fmt(account.cashBalance)} icon={<DollarSign className="w-3 h-3" />} />
        <Metric
          label="Net Liq Value (NLV)"
          value={fmt(account.netLiquidatingValue)}
          subtext={`${cashVsNlv >= 0 ? '+' : ''}${fmt(cashVsNlv)} vs cash`}
          accent={cashVsNlv >= 0 ? 'emerald' : 'red'}
          icon={<Activity className="w-3 h-3" />}
        />
        <Metric
          label="Auto-Liquidate"
          value={fmt(account.autoLiquidateThreshold)}
          subtext={`${distanceToFloor >= 0 ? '+' : ''}${fmt(distanceToFloor)} above`}
          accent={distanceToFloor < 0 ? 'red' : distanceToFloor < account.autoLiquidateThreshold * 0.05 ? 'amber' : 'emerald'}
          icon={<ShieldAlert className="w-3 h-3" />}
        />
        <Metric label="Initial Margin" value={fmt(account.initialMargin)} />
        <Metric label="Maintenance Margin" value={fmt(account.maintenanceMargin)} />
        <Metric
          label="Realized / Unrealized"
          value={`${fmt(account.realizedPnlToday)} / ${fmt(account.unrealizedPnl)}`}
          accent={account.realizedPnlToday + account.unrealizedPnl >= 0 ? 'emerald' : 'red'}
          icon={account.realizedPnlToday + account.unrealizedPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        />
      </div>

      {/* Positions table */}
      <div className="px-5 py-3 border-t border-border">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Open Positions ({positions.length})
        </h3>
        {positions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" dir="ltr">
              <thead className="text-[10px] uppercase font-semibold text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 pr-3">Symbol</th>
                  <th className="text-right py-1.5 pr-3">Net Position</th>
                  <th className="text-right py-1.5 pr-3">Avg Entry</th>
                  <th className="text-right py-1.5 pr-3">Current Price</th>
                  <th className="text-right py-1.5">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => {
                  const sideColor = p.side === 'long' ? 'text-emerald-500' : p.side === 'short' ? 'text-red-500' : 'text-muted-foreground';
                  const pnlColor = p.unrealizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500';
                  return (
                    <tr key={p.symbol} className="border-b border-border/40 last:border-0" data-testid={`monitor-pos-${p.symbol}`}>
                      <td className="py-1.5 pr-3 font-mono font-medium">
                        {p.symbol}
                        <span className="text-[10px] text-muted-foreground ml-1">({p.productCode})</span>
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-mono font-semibold ${sideColor}`}>
                        {p.netPosition > 0 ? '+' : ''}{p.netPosition} <span className="text-[10px] uppercase">{p.side}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{fmtPrice(p.averageEntryPrice)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{fmtPrice(p.currentMarketPrice)}</td>
                      <td className={`py-1.5 text-right font-mono font-semibold ${pnlColor}`}>
                        {p.unrealizedPnl >= 0 ? '+' : ''}{fmt(p.unrealizedPnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  subtext,
  accent,
  icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  accent?: 'emerald' | 'red' | 'amber';
  icon?: React.ReactNode;
}) {
  const accentClass =
    accent === 'emerald' ? 'text-emerald-500'
    : accent === 'red' ? 'text-red-500'
    : accent === 'amber' ? 'text-amber-500'
    : 'text-foreground';
  return (
    <div className="bg-card p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={`text-sm font-mono font-bold mt-1 ${accentClass}`} dir="ltr">{value}</p>
      {subtext && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono" dir="ltr">{subtext}</p>}
    </div>
  );
}
