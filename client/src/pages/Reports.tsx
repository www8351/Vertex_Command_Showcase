import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Download, Share2, Link, Trash2, Eye, TrendingUp, TrendingDown,
  Calendar, BarChart3, Copy, ExternalLink, ChevronDown, ChevronUp,
  Wallet,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { Account, Withdrawal, BalanceHistory } from "@shared/schema";
import type { JournalEntry } from "@shared/journal-schema";
import { apiUrl } from "@/lib/apiBase";

interface EnrichedJournalEntry extends JournalEntry {
  sourcePlatform?: string;
  psychology?: Record<string, unknown> | null;
}

interface TaxReportData {
  totalGains: number;
  totalLosses: number;
  netPnl: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalWithdrawn: number;
  monthly: { month: string; gains: number; losses: number; net: number; trades: number }[];
  bySymbol: { symbol: string; gains: number; losses: number; net: number; count: number }[];
}

interface SharedReportData {
  id: number;
  title: string;
  shareToken: string;
  isActive: boolean;
  viewCount: number;
  createdAt: string;
  dateFrom: string | null;
  dateTo: string | null;
}

interface PerformanceStats {
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
}

interface MarginData {
  totalUsed: number;
  available: number;
  percent: number;
  initial: number;
  day: number;
  maintenance: number;
}

export default function Reports() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const queryClient = useQueryClient();
  const { formatCurrency } = useCurrency();

  const [activeTab, setActiveTab] = useState<"tax" | "shared" | "account">("tax");
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState(false);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const { data: taxReport, isLoading: taxLoading } = useQuery<TaxReportData>({
    queryKey: ["/api/v1/journal/tax-report", taxYear],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/journal/tax-report?year=${taxYear}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tax report");
      return res.json();
    },
  });

  const { data: sharedReports = [], isLoading: sharedLoading } = useQuery<SharedReportData[]>({
    queryKey: ["/api/v1/reports/shared"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/reports/shared"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shared reports");
      return res.json();
    },
  });

  const deleteReportMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v1/reports/shared/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/reports/shared"] });
      toast({ title: t("reports.reportDeleted") });
    },
  });

  const toggleReportMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/v1/reports/shared/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/reports/shared"] });
    },
  });

  const handleExportTaxCSV = () => {
    window.open(apiUrl(`/api/v1/journal/tax-report/export?year=${taxYear}`), "_blank");
  };

  const copyShareLink = async (token: string) => {
    const url = `${window.location.origin}/report/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t("reports.linkCopied") });
    } catch {
      toast({ title: url, description: t("reports.linkCopied") });
    }
  };

  return (
    <div className="min-h-screen bg-background p-3 sm:p-4 md:p-8 overflow-x-hidden" dir={dir}>
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between rtl:flex-row-reverse">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-reports-title">{t("reports.title")}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("reports.subtitle")}</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
          <Button
            variant={activeTab === "tax" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("tax")}
            className="gap-2"
            data-testid="button-tab-tax"
          >
            <FileText className="w-4 h-4" />
            {t("reports.taxReport")}
          </Button>
          <Button
            variant={activeTab === "shared" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("shared")}
            className="gap-2"
            data-testid="button-tab-shared"
          >
            <Share2 className="w-4 h-4" />
            {t("reports.sharedReports")}
          </Button>
          <Button
            variant={activeTab === "account" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("account")}
            className="gap-2"
            data-testid="button-tab-account"
          >
            <BarChart3 className="w-4 h-4" />
            {t("reports.accountReports")}
          </Button>
        </div>

        {activeTab === "tax" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Label>{t("reports.year")}</Label>
                <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(parseInt(v))}>
                  <SelectTrigger className="w-32" data-testid="select-tax-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleExportTaxCSV} data-testid="button-export-tax-csv">
                <Download className="w-4 h-4" />
                {t("reports.exportCSV")}
              </Button>
            </div>

            {taxLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t("common.loading")}</div>
            ) : taxReport ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label={t("reports.totalGains")}
                    value={formatCurrency(taxReport.totalGains)}
                    icon={<TrendingUp className="w-5 h-5 text-emerald-500" />}
                    color="emerald"
                    testId="stat-total-gains"
                  />
                  <StatCard
                    label={t("reports.totalLosses")}
                    value={formatCurrency(taxReport.totalLosses)}
                    icon={<TrendingDown className="w-5 h-5 text-red-500" />}
                    color="red"
                    testId="stat-total-losses"
                  />
                  <StatCard
                    label={t("reports.netPnl")}
                    value={formatCurrency(taxReport.netPnl)}
                    icon={<BarChart3 className="w-5 h-5 text-indigo-500" />}
                    color={taxReport.netPnl >= 0 ? "emerald" : "red"}
                    testId="stat-net-pnl"
                  />
                  <StatCard
                    label={t("reports.totalTrades")}
                    value={String(taxReport.totalTrades)}
                    icon={<Calendar className="w-5 h-5 text-blue-500" />}
                    color="blue"
                    testId="stat-total-trades"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl bg-card border border-border p-4">
                    <p className="text-sm text-muted-foreground">{t("reports.winCount")}</p>
                    <p className="text-xl font-bold text-emerald-500" data-testid="text-win-count">{taxReport.winCount}</p>
                  </div>
                  <div className="rounded-xl bg-card border border-border p-4">
                    <p className="text-sm text-muted-foreground">{t("reports.lossCount")}</p>
                    <p className="text-xl font-bold text-red-500" data-testid="text-loss-count">{taxReport.lossCount}</p>
                  </div>
                  <div className="rounded-xl bg-card border border-border p-4">
                    <p className="text-sm text-muted-foreground">{t("reports.totalWithdrawn")}</p>
                    <p className="text-xl font-bold" data-testid="text-total-withdrawn">{formatCurrency(taxReport.totalWithdrawn)}</p>
                  </div>
                </div>

                {taxReport.monthly && taxReport.monthly.length > 0 && (
                  <div className="rounded-xl bg-card border border-border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{t("reports.monthlyBreakdown")}</h3>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedMonths(!expandedMonths)}>
                        {expandedMonths ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>

                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={taxReport.monthly}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: string) => v.split("-")[1]} />
                          <YAxis tick={{ fontSize: 10, fill: "#888" }} />
                          <Tooltip
                            contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                            labelStyle={{ color: "#aaa" }}
                            formatter={(value: number) => formatCurrency(value)}
                          />
                          <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                            {taxReport.monthly.map((entry, index) => (
                              <Cell key={index} fill={entry.net >= 0 ? "#10b981" : "#ef4444"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {expandedMonths && (
                      <div className="space-y-2">
                        {taxReport.monthly.map((m) => (
                          <div key={m.month} className="flex flex-col sm:flex-row sm:items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0 gap-1">
                            <span className="text-muted-foreground">{m.month}</span>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs sm:text-sm">
                              <span className="text-emerald-500">+{formatCurrency(m.gains)}</span>
                              <span className="text-red-500">-{formatCurrency(m.losses)}</span>
                              <span className={`font-medium ${m.net >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                {formatCurrency(m.net)}
                              </span>
                              <span className="text-muted-foreground">{m.trades} {t("reports.trades")}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {taxReport.bySymbol && taxReport.bySymbol.length > 0 && (
                  <div className="rounded-xl bg-card border border-border p-4 space-y-3">
                    <h3 className="font-semibold">{t("reports.bySymbol")}</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {taxReport.bySymbol.map((s) => (
                        <div key={s.symbol} className="flex flex-col sm:flex-row sm:items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0 gap-1">
                          <span className="font-medium">{s.symbol}</span>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs sm:text-sm">
                            <span className="text-emerald-500">+{formatCurrency(s.gains)}</span>
                            <span className="text-red-500">-{formatCurrency(s.losses)}</span>
                            <span className={`font-medium ${s.net >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                              {formatCurrency(s.net)}
                            </span>
                            <span className="text-muted-foreground">{s.count}x</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">{t("reports.noData")}</div>
            )}
          </div>
        )}

        {activeTab === "shared" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button className="gap-2" onClick={() => setShowCreateDialog(true)} data-testid="button-create-shared-report">
                <Share2 className="w-4 h-4" />
                {t("reports.createReport")}
              </Button>
            </div>

            {sharedLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t("common.loading")}</div>
            ) : sharedReports.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <Share2 className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                <p className="text-muted-foreground">{t("reports.noSharedReports")}</p>
                <p className="text-xs text-muted-foreground/60">{t("reports.noSharedReportsDesc")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sharedReports.map((report) => (
                  <div key={report.id} className="rounded-xl bg-card border border-border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid={`card-shared-report-${report.id}`}>
                    <div className="space-y-1 min-w-0">
                      <h4 className="font-medium truncate">{report.title}</h4>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
                        <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {report.viewCount}</span>
                        {report.dateFrom && report.dateTo && (
                          <span>{report.dateFrom} — {report.dateTo}</span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${report.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                          {report.isActive ? t("reports.active") : t("reports.inactive")}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => copyShareLink(report.shareToken)} data-testid={`button-copy-link-${report.id}`}>
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => window.open(`/report/${report.shareToken}`, "_blank")} data-testid={`button-view-report-${report.id}`}>
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleReportMutation.mutate({ id: report.id, isActive: !report.isActive })}
                        disabled={isDemo}
                        data-testid={`button-toggle-report-${report.id}`}
                      >
                        <Link className={`w-4 h-4 ${report.isActive ? "text-emerald-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteReportMutation.mutate(report.id)}
                        disabled={isDemo}
                        data-testid={`button-delete-report-${report.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <CreateSharedReportDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
          </div>
        )}

        {activeTab === "account" && <AccountReportsTab />}
      </div>
    </div>
  );
}

type SubTab = "performance" | "orders" | "positionHistory" | "cashHistory" | "fills" | "balanceHistory";

function AccountReportsTab() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [subTab, setSubTab] = useState<SubTab>("performance");
  const [datePreset, setDatePreset] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/v1/accounts"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/accounts"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load accounts");
      return res.json();
    },
  });

  const accountId = selectedAccountId ? parseInt(selectedAccountId) : undefined;
  const selectedAccount = accounts.find((a) => a.id === accountId);

  const { data: journalEntries = [], isLoading: entriesLoading } = useQuery<EnrichedJournalEntry[]>({
    queryKey: ["/api/v1/journal/entries", accountId, appliedFrom, appliedTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (accountId) params.set("accountId", String(accountId));
      if (appliedFrom) params.set("dateFrom", appliedFrom);
      if (appliedTo) params.set("dateTo", appliedTo);
      const res = await fetch(apiUrl(`/api/v1/journal/entries?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load entries");
      return res.json();
    },
    enabled: !!accountId,
  });

  const { data: balanceHistoryRaw = [] } = useQuery<BalanceHistory[]>({
    queryKey: ["/api/v1/balance-history", accountId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/balance-history/${accountId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load balance history");
      return res.json();
    },
    enabled: !!accountId,
  });

  const balanceHistoryData = useMemo(() => {
    if (!appliedFrom && !appliedTo) return balanceHistoryRaw;
    return balanceHistoryRaw.filter((b) => {
      if (appliedFrom && b.date < appliedFrom) return false;
      if (appliedTo && b.date > appliedTo) return false;
      return true;
    });
  }, [balanceHistoryRaw, appliedFrom, appliedTo]);

  const { data: withdrawals = [] } = useQuery<Withdrawal[]>({
    queryKey: ["/api/v1/withdrawals", accountId],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/withdrawals"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load withdrawals");
      return res.json();
    },
    enabled: !!accountId,
  });

  const accountWithdrawals = useMemo(() => {
    if (!accountId) return [];
    let filtered = withdrawals.filter((w) => w.accountId === accountId);
    if (appliedFrom) filtered = filtered.filter((w) => w.dateRequested >= appliedFrom);
    if (appliedTo) filtered = filtered.filter((w) => w.dateRequested <= appliedTo);
    return filtered;
  }, [withdrawals, accountId, appliedFrom, appliedTo]);

  const totalPL = useMemo(() => {
    return journalEntries.reduce((sum, e) => sum + (e.realizedPnl || 0), 0);
  }, [journalEntries]);

  const openPL = useMemo(() => {
    if (!selectedAccount) return 0;
    const latestBh = balanceHistoryRaw.length > 0 ? balanceHistoryRaw[balanceHistoryRaw.length - 1] : null;
    return latestBh?.unrealizedPnl ?? 0;
  }, [selectedAccount, balanceHistoryRaw]);

  const netLiquidity = useMemo(() => {
    if (!selectedAccount) return 0;
    return selectedAccount.balance || 0;
  }, [selectedAccount]);

  const performanceStats = useMemo((): PerformanceStats | null => {
    if (journalEntries.length === 0) return null;
    const wins = journalEntries.filter((e) => (e.realizedPnl || 0) > 0);
    const losses = journalEntries.filter((e) => (e.realizedPnl || 0) < 0);
    const totalWins = wins.reduce((s, e) => s + (e.realizedPnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((s, e) => s + (e.realizedPnl || 0), 0));
    return {
      totalTrades: journalEntries.length,
      winRate: journalEntries.length > 0 ? (wins.length / journalEntries.length) * 100 : 0,
      avgWin: wins.length > 0 ? totalWins / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      bestTrade: journalEntries.length > 0 ? Math.max(...journalEntries.map((e) => e.realizedPnl || 0)) : 0,
      worstTrade: journalEntries.length > 0 ? Math.min(...journalEntries.map((e) => e.realizedPnl || 0)) : 0,
    };
  }, [journalEntries]);

  const marginData = useMemo((): MarginData | null => {
    if (!selectedAccount) return null;
    const accountSize = selectedAccount.size || 0;
    const currentBalance = selectedAccount.balance || 0;
    const maxDrawdown = selectedAccount.maxDrawdown || 0;
    const usedMargin = Math.max(0, accountSize - currentBalance);
    const availableMargin = currentBalance;
    const marginPercent = accountSize > 0 ? (availableMargin / accountSize) * 100 : 100;
    const initialMargin = accountSize * 0.1;
    const dayMargin = accountSize * 0.05;
    const maintenanceMargin = maxDrawdown > 0 ? maxDrawdown : accountSize * 0.04;
    return {
      totalUsed: usedMargin,
      available: availableMargin,
      percent: Math.min(100, marginPercent),
      initial: initialMargin,
      day: dayMargin,
      maintenance: maintenanceMargin,
    };
  }, [selectedAccount]);

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    let from = "";
    let to = now.toISOString().split("T")[0];
    if (preset === "today") {
      from = to;
    } else if (preset === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      from = d.toISOString().split("T")[0];
    } else if (preset === "month") {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } else if (preset === "year") {
      from = `${now.getFullYear()}-01-01`;
    } else {
      from = "";
      to = "";
    }
    setDateFrom(from);
    setDateTo(to);
  };

  const handleGo = () => {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  };

  const handleDownloadCSV = () => {
    if (!accountId) return;
    let data: (string | number | null)[][] = [];
    let headers: string[] = [];
    let filename = "account-report";

    if (subTab === "performance" || subTab === "orders" || subTab === "fills" || subTab === "positionHistory") {
      headers = [t("reports.symbol"), t("reports.side"), t("reports.quantity"), t("reports.entryPrice"), t("reports.exitPrice"), t("reports.pnl"), t("reports.openedAt"), t("reports.closedAt")];
      data = journalEntries.map((e) => [
        e.symbol, e.side, e.quantity, e.entryPrice, e.exitPrice, e.realizedPnl,
        e.openedAt ? new Date(e.openedAt).toLocaleString() : "",
        e.closedAt ? new Date(e.closedAt).toLocaleString() : "",
      ]);
      filename = `${subTab}-${accountId}`;
    } else if (subTab === "cashHistory") {
      headers = [t("reports.date"), t("reports.type"), t("reports.amount"), t("reports.status")];
      data = accountWithdrawals.map((w) => [
        w.dateRequested, t("reports.withdrawal"), w.amount, w.status,
      ]);
      filename = `cash-history-${accountId}`;
    } else if (subTab === "balanceHistory") {
      headers = [t("reports.date"), t("reports.balance"), t("reports.profit"), t("reports.equity"), t("reports.pnl")];
      data = balanceHistoryData.map((b) => [
        b.date, b.balance, b.profit, b.equity, b.dailyPnl,
      ]);
      filename = `balance-history-${accountId}`;
    }

    const csv = [headers.join(","), ...data.map((r) => r.map((c) => `"${c ?? ""}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = () => {
    if (!accountId) return;
    const params = new URLSearchParams();
    params.set("accountId", String(accountId));
    params.set("tab", subTab);
    if (appliedFrom) params.set("dateFrom", appliedFrom);
    if (appliedTo) params.set("dateTo", appliedTo);
    window.open(apiUrl(`/api/v1/reports/account-pdf?${params}`), "_blank");
  };

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "performance", label: t("reports.performance") },
    { key: "orders", label: t("reports.orders") },
    { key: "positionHistory", label: t("reports.positionHistory") },
    { key: "cashHistory", label: t("reports.cashHistory") },
    { key: "fills", label: t("reports.fills") },
    { key: "balanceHistory", label: t("reports.accountBalanceHistory") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start gap-6">
        <div className="space-y-3 min-w-0">
          <h2 className="text-lg font-semibold" data-testid="text-account-reports-title">{t("reports.accountReports")}</h2>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("reports.selectAccount")}</p>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-64" data-testid="select-account">
                <SelectValue placeholder={t("reports.selectAccount")} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.accountId})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedAccount && (
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.totalPL")}</p>
                <p className={`text-lg font-bold ${totalPL >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="text-total-pl">
                  {formatCurrency(totalPL)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.openPL")}</p>
                <p className="text-lg font-bold" data-testid="text-open-pl">{formatCurrency(openPL)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.netLiquidity")}</p>
                <p className="text-lg font-bold" data-testid="text-net-liquidity">{formatCurrency(netLiquidity)}</p>
              </div>
            </div>
          )}
        </div>

        {selectedAccount && (
          <div className="flex flex-wrap items-end gap-3 sm:ms-auto">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("reports.date")}</p>
              <Select value={datePreset} onValueChange={handleDatePresetChange}>
                <SelectTrigger className="w-28" data-testid="select-date-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("reports.custom")}</SelectItem>
                  <SelectItem value="today">{t("reports.today")}</SelectItem>
                  <SelectItem value="week">{t("reports.thisWeek")}</SelectItem>
                  <SelectItem value="month">{t("reports.thisMonth")}</SelectItem>
                  <SelectItem value="year">{t("reports.thisYear")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("reports.from")}</p>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setDatePreset("all"); }}
                className="w-36"
                data-testid="input-account-date-from"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("reports.to")}</p>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setDatePreset("all"); }}
                className="w-36"
                data-testid="input-account-date-to"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleGo} data-testid="button-go">{t("reports.go")}</Button>
              <Button size="sm" variant="outline" onClick={handleDownloadCSV} data-testid="button-download-csv">
                {t("reports.downloadCSV")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadPDF} data-testid="button-download-pdf">
                {t("reports.downloadPDF")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {!selectedAccount ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{t("reports.noAccountSelected")}</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border pb-0 overflow-x-auto">
            {subTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSubTab(tab.key)}
                className={`px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  subTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-subtab-${tab.key}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-[300px]">
            {(subTab === "cashHistory" || subTab === "balanceHistory") ? (
              <>
                {subTab === "cashHistory" && <CashHistoryView withdrawals={accountWithdrawals} />}
                {subTab === "balanceHistory" && <BalanceHistoryView data={balanceHistoryData} />}
              </>
            ) : entriesLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t("common.loading")}</div>
            ) : (
              <>
                {subTab === "performance" && <PerformanceView stats={performanceStats} entries={journalEntries} />}
                {subTab === "orders" && <TradeTable entries={journalEntries} type="orders" />}
                {subTab === "positionHistory" && <TradeTable entries={journalEntries} type="positions" />}
                {subTab === "fills" && <TradeTable entries={journalEntries} type="fills" />}
              </>
            )}
          </div>

          {marginData && <MarginSection data={marginData} />}
        </>
      )}
    </div>
  );
}

function PerformanceView({ stats, entries }: { stats: PerformanceStats | null; entries: EnrichedJournalEntry[] }) {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  if (!stats || entries.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t("reports.noEntriesFound")}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        <MiniStat label={t("reports.totalTrades")} value={String(stats.totalTrades)} testId="text-perf-total-trades" />
        <MiniStat label={t("reports.winRate")} value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"} testId="text-perf-win-rate" />
        <MiniStat label={t("reports.avgWin")} value={formatCurrency(stats.avgWin)} color="text-emerald-400" testId="text-perf-avg-win" />
        <MiniStat label={t("reports.avgLoss")} value={formatCurrency(stats.avgLoss)} color="text-red-400" testId="text-perf-avg-loss" />
        <MiniStat label={t("reports.profitFactor")} value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)} testId="text-perf-profit-factor" />
        <MiniStat label={t("reports.bestTradeVal")} value={formatCurrency(stats.bestTrade)} color="text-emerald-400" testId="text-perf-best" />
        <MiniStat label={t("reports.worstTradeVal")} value={formatCurrency(stats.worstTrade)} color="text-red-400" testId="text-perf-worst" />
        <MiniStat label={t("reports.netPnl")} value={formatCurrency(entries.reduce((s, e) => s + (e.realizedPnl || 0), 0))} testId="text-perf-net-pnl" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, testId }: { label: string; value: string; color?: string; testId: string }) {
  return (
    <div className="rounded-lg bg-card/50 border border-border/50 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={`text-lg font-bold ${color || ""}`} data-testid={testId}>{value}</p>
    </div>
  );
}

function TradeTable({ entries, type }: { entries: EnrichedJournalEntry[]; type: "orders" | "positions" | "fills" }) {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  const filtered = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      const da = a.closedAt ? new Date(a.closedAt).getTime() : a.openedAt ? new Date(a.openedAt).getTime() : 0;
      const db2 = b.closedAt ? new Date(b.closedAt).getTime() : b.openedAt ? new Date(b.openedAt).getTime() : 0;
      return db2 - da;
    });
    if (type === "orders") return sorted;
    if (type === "positions") return sorted.filter((e) => e.closedAt);
    if (type === "fills") return sorted.filter((e) => e.entryPrice && e.exitPrice);
    return sorted;
  }, [entries, type]);

  if (filtered.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t("reports.noEntriesFound")}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={`table-${type}`}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground uppercase">
            <th className="py-2 px-3 text-start">{t("reports.symbol")}</th>
            <th className="py-2 px-3 text-start">{t("reports.side")}</th>
            <th className="py-2 px-3 text-end">{t("reports.quantity")}</th>
            <th className="py-2 px-3 text-end">{t("reports.entryPrice")}</th>
            <th className="py-2 px-3 text-end">{t("reports.exitPrice")}</th>
            <th className="py-2 px-3 text-end">{t("reports.pnl")}</th>
            <th className="py-2 px-3 text-start">{t("reports.openedAt")}</th>
            <th className="py-2 px-3 text-start">{t("reports.closedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e, i) => (
            <tr key={e.id || i} className="border-b border-border/30 hover:bg-muted/20" data-testid={`row-trade-${e.id || i}`}>
              <td className="py-2 px-3 font-medium">{e.symbol || "—"}</td>
              <td className="py-2 px-3">
                <span className={`px-1.5 py-0.5 rounded text-xs ${e.side === "buy" || e.side === "long" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                  {e.side?.toUpperCase() || "—"}
                </span>
              </td>
              <td className="py-2 px-3 text-end">{e.quantity ?? "—"}</td>
              <td className="py-2 px-3 text-end">{e.entryPrice != null ? e.entryPrice.toFixed(2) : "—"}</td>
              <td className="py-2 px-3 text-end">{e.exitPrice != null ? e.exitPrice.toFixed(2) : "—"}</td>
              <td className={`py-2 px-3 text-end font-medium ${(e.realizedPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatCurrency(e.realizedPnl || 0)}
              </td>
              <td className="py-2 px-3 text-xs text-muted-foreground">{e.openedAt ? new Date(e.openedAt).toLocaleString() : "—"}</td>
              <td className="py-2 px-3 text-xs text-muted-foreground">{e.closedAt ? new Date(e.closedAt).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CashHistoryView({ withdrawals }: { withdrawals: Withdrawal[] }) {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  if (withdrawals.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t("reports.noEntriesFound")}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-cash-history">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground uppercase">
            <th className="py-2 px-3 text-start">{t("reports.date")}</th>
            <th className="py-2 px-3 text-start">{t("reports.type")}</th>
            <th className="py-2 px-3 text-end">{t("reports.amount")}</th>
            <th className="py-2 px-3 text-start">{t("reports.status")}</th>
          </tr>
        </thead>
        <tbody>
          {withdrawals.map((w, i) => (
            <tr key={w.id || i} className="border-b border-border/30 hover:bg-muted/20" data-testid={`row-cash-${w.id || i}`}>
              <td className="py-2 px-3">{w.dateRequested}</td>
              <td className="py-2 px-3">{t("reports.withdrawal")}</td>
              <td className="py-2 px-3 text-end text-red-400">{formatCurrency(w.amount)}</td>
              <td className="py-2 px-3">
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  w.status === "approved" || w.status === "paid" ? "bg-emerald-500/10 text-emerald-400" :
                  w.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-red-500/10 text-red-400"
                }`}>
                  {w.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceHistoryView({ data }: { data: BalanceHistory[] }) {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  if (data.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t("reports.noEntriesFound")}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-balance-history">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground uppercase">
            <th className="py-2 px-3 text-start">{t("reports.date")}</th>
            <th className="py-2 px-3 text-end">{t("reports.balance")}</th>
            <th className="py-2 px-3 text-end">{t("reports.profit")}</th>
            <th className="py-2 px-3 text-end">{t("reports.equity")}</th>
            <th className="py-2 px-3 text-end">{t("reports.pnl")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b, i) => (
            <tr key={b.id || i} className="border-b border-border/30 hover:bg-muted/20" data-testid={`row-balance-${b.id || i}`}>
              <td className="py-2 px-3">{b.date}</td>
              <td className="py-2 px-3 text-end">{formatCurrency(b.balance)}</td>
              <td className={`py-2 px-3 text-end ${(b.profit || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatCurrency(b.profit || 0)}
              </td>
              <td className="py-2 px-3 text-end">{b.equity != null ? formatCurrency(b.equity) : "—"}</td>
              <td className={`py-2 px-3 text-end ${(b.dailyPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {b.dailyPnl != null ? formatCurrency(b.dailyPnl) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarginSection({ data }: { data: MarginData }) {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  return (
    <div className="rounded-xl bg-card border border-border p-4 sm:p-6 space-y-6" data-testid="section-margin">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.totalMarginUsed")}</p>
          <p className="text-lg font-bold text-amber-400" data-testid="text-margin-used">{formatCurrency(data.totalUsed)}</p>
          <p className="text-xs text-muted-foreground">{data.percent < 100 ? `${(100 - data.percent).toFixed(0)}%` : "0%"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.marginAvailable")}</p>
          <p className="text-lg font-bold text-emerald-400" data-testid="text-margin-available">{formatCurrency(data.available)}</p>
          <p className="text-xs text-muted-foreground">{data.percent.toFixed(0)}%</p>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${data.percent}%`,
                background: data.percent > 50 ? "linear-gradient(90deg, #ef4444, #10b981)" : "linear-gradient(90deg, #ef4444, #f59e0b)",
              }}
              data-testid="progress-margin"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.initialMargin")}</p>
          <p className="font-bold" data-testid="text-initial-margin">{formatCurrency(data.initial)}</p>
          <p className="text-xs text-muted-foreground">0%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.dayMargin")}</p>
          <p className="font-bold" data-testid="text-day-margin">{formatCurrency(data.day)}</p>
          <p className="text-xs text-muted-foreground">0%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("reports.maintenanceMargin")}</p>
          <p className="font-bold" data-testid="text-maintenance-margin">{formatCurrency(data.maintenance)}</p>
          <p className="text-xs text-muted-foreground">0%</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, testId }: { label: string; value: string; icon: React.ReactNode; color: string; testId: string }) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500/10 border-emerald-500/20",
    red: "bg-red-500/10 border-red-500/20",
    blue: "bg-blue-500/10 border-blue-500/20",
    indigo: "bg-indigo-500/10 border-indigo-500/20",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.blue}`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function CreateSharedReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>(["winRate", "profitFactor", "totalPnl", "totalTrades", "equityCurve", "bySymbol"]);

  const fieldOptions = [
    { key: "winRate", label: t("reports.fields.winRate") },
    { key: "profitFactor", label: t("reports.fields.profitFactor") },
    { key: "totalPnl", label: t("reports.fields.totalPnl") },
    { key: "totalTrades", label: t("reports.fields.totalTrades") },
    { key: "equityCurve", label: t("reports.fields.equityCurve") },
    { key: "bySymbol", label: t("reports.fields.bySymbol") },
    { key: "byTag", label: t("reports.fields.byTag") },
    { key: "byWeekday", label: t("reports.fields.byWeekday") },
    { key: "avgWin", label: t("reports.fields.avgWin") },
    { key: "avgLoss", label: t("reports.fields.avgLoss") },
    { key: "bestTrade", label: t("reports.fields.bestTrade") },
    { key: "worstTrade", label: t("reports.fields.worstTrade") },
  ];

  const toggleField = (key: string) => {
    setSelectedFields((prev) => prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v1/reports/shared", {
        title,
        reportType: "performance",
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        includeFields: selectedFields,
      });
      return res.json();
    },
    onSuccess: (report: SharedReportData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/reports/shared"] });
      onOpenChange(false);
      setTitle("");
      setDateFrom("");
      setDateTo("");

      const url = `${window.location.origin}/report/${report.shareToken}`;
      navigator.clipboard.writeText(url).catch(() => {});
      toast({ title: t("reports.reportCreated"), description: t("reports.linkCopiedDesc") });
    },
    onError: () => {
      toast({ title: t("reports.createError"), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-indigo-500" />
            {t("reports.createReport")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>{t("reports.reportTitle")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("reports.reportTitlePlaceholder")}
              data-testid="input-report-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("reports.dateFrom")}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-date-from" />
            </div>
            <div>
              <Label>{t("reports.dateTo")}</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-date-to" />
            </div>
          </div>
          <div>
            <Label className="mb-2 block">{t("reports.includeFields")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {fieldOptions.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedFields.includes(f.key)}
                    onCheckedChange={() => toggleField(f.key)}
                    data-testid={`checkbox-field-${f.key}`}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => createMutation.mutate()}
            disabled={isDemo || !title.trim() || createMutation.isPending}
            data-testid="button-submit-create-report"
          >
            <Share2 className="w-4 h-4" />
            {createMutation.isPending ? t("common.loading") : t("reports.createAndCopy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
