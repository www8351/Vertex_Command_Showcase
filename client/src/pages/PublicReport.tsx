import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  TrendingUp, BarChart3, Target, Activity, Calendar,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { apiUrl } from "@/lib/apiBase";

export default function PublicReport() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { formatCurrency } = useCurrency();
  const params = useParams<{ token: string }>();
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl(`/api/v1/public/report/${params.token}`))
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Not found");
        }
        return res.json();
      })
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6" dir={dir}>
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <BarChart3 className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold">{t("reports.reportNotFound")}</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const d = report.data || {};
  const hasEquityCurve = d.equityCurve && d.equityCurve.length > 0;
  const hasBySymbol = d.bySymbol && d.bySymbol.length > 0;
  const hasByTag = d.byTag && d.byTag.length > 0;

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <div className="bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-transparent border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-10 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <img src="/logo.png" alt="Vertex Command" className="w-5 h-5 opacity-50 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span>Vertex Command</span>
          </div>
          <h1 className="text-3xl font-bold" data-testid="text-public-report-title">{report.title}</h1>
          {report.dateFrom && report.dateTo && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {report.dateFrom} — {report.dateTo}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("reports.by")} {d.traderName} · {t("reports.generatedOn")} {new Date(d.generatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {d.totalTrades !== undefined && (
            <PublicStatCard icon={<Activity className="w-5 h-5 text-blue-500" />} label={t("reports.totalTrades")} value={String(d.totalTrades)} />
          )}
          {d.winRate !== undefined && (
            <PublicStatCard icon={<Target className="w-5 h-5 text-emerald-500" />} label={t("reports.fields.winRate")} value={`${d.winRate.toFixed(1)}%`} />
          )}
          {d.profitFactor !== undefined && (
            <PublicStatCard icon={<TrendingUp className="w-5 h-5 text-indigo-500" />} label={t("reports.fields.profitFactor")} value={d.profitFactor.toFixed(2)} />
          )}
          {d.totalPnl !== undefined && (
            <PublicStatCard icon={<BarChart3 className="w-5 h-5" style={{ color: d.totalPnl >= 0 ? "#10b981" : "#ef4444" }} />} label={t("reports.fields.totalPnl")} value={formatCurrency(d.totalPnl)} />
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {d.avgWin !== undefined && (
            <div className="rounded-xl bg-card border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("reports.fields.avgWin")}</p>
              <p className="text-lg font-bold text-emerald-500">{formatCurrency(d.avgWin)}</p>
            </div>
          )}
          {d.avgLoss !== undefined && (
            <div className="rounded-xl bg-card border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("reports.fields.avgLoss")}</p>
              <p className="text-lg font-bold text-red-500">{formatCurrency(d.avgLoss)}</p>
            </div>
          )}
          {d.bestTrade !== undefined && (
            <div className="rounded-xl bg-card border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("reports.fields.bestTrade")}</p>
              <p className="text-lg font-bold text-emerald-500">{formatCurrency(d.bestTrade)}</p>
            </div>
          )}
          {d.worstTrade !== undefined && (
            <div className="rounded-xl bg-card border border-border p-3">
              <p className="text-xs text-muted-foreground">{t("reports.fields.worstTrade")}</p>
              <p className="text-lg font-bold text-red-500">{formatCurrency(d.worstTrade)}</p>
            </div>
          )}
        </div>

        {hasEquityCurve && (
          <div className="rounded-xl bg-card border border-border p-4 space-y-3">
            <h3 className="font-semibold">{t("reports.fields.equityCurve")}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.equityCurve}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#888" }} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "#aaa" }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Area type="monotone" dataKey="equity" stroke="#6366f1" fill="url(#equityGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {hasBySymbol && (
          <div className="rounded-xl bg-card border border-border p-4 space-y-3">
            <h3 className="font-semibold">{t("reports.fields.bySymbol")}</h3>
            <div className="space-y-2">
              {d.bySymbol.map((s: any) => (
                <div key={s.symbol} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                  <span className="font-medium">{s.symbol}</span>
                  <div className="flex gap-4">
                    <span className={`font-medium ${s.pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(s.pnl)}</span>
                    <span className="text-muted-foreground">{s.count}x</span>
                    <span className="text-muted-foreground">{s.winRate.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasByTag && (
          <div className="rounded-xl bg-card border border-border p-4 space-y-3">
            <h3 className="font-semibold">{t("reports.fields.byTag")}</h3>
            <div className="space-y-2">
              {d.byTag.map((t_: any) => (
                <div key={t_.tag} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                  <span className="font-medium">{t_.tag}</span>
                  <div className="flex gap-4">
                    <span className={`font-medium ${t_.pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(t_.pnl)}</span>
                    <span className="text-muted-foreground">{t_.count}x</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center pt-8 pb-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t("reports.poweredBy")} <span className="font-semibold text-indigo-400">Vertex Command</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function PublicStatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card border border-border p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
