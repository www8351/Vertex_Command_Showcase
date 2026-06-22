import { useState, useMemo, useRef, useCallback, Fragment, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn, getCsrfToken } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import TradeReplay from "@/components/TradeReplay";
import PlaybookManager from "@/components/PlaybookManager";
import CandlestickReplay from "@/components/CandlestickReplay";
import {
  Plus, Loader2, TrendingUp, TrendingDown, Calendar,
  BarChart3, Brain, FileText, ChevronLeft, ChevronRight, Pencil,
  Trash2, Filter, X, BookOpen, Target, Award, Zap, Upload, Download, ExternalLink,
  RefreshCw, Link2, Building2, Wallet, DollarSign, Percent,
  LayoutGrid, List, Clock, Activity, Tag, Globe, Sparkles,
  ArrowUpDown, Eye, Share2, Bell, Lightbulb, BarChart2, PieChart, Play,
  ShieldAlert, AlertTriangle, Shield,
  CheckCircle, Settings2, Trophy, TrendingDown as TrendingDownIcon
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid
} from "recharts";
import { apiUrl } from "@/lib/apiBase";

interface JournalEntry {
  id: number;
  userId: number;
  importedTradeId: number | null;
  accountId: number | null;
  symbol: string | null;
  side: string | null;
  quantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  openedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  tags: string[] | null;
  autoTags: string[] | null;
  setupType: string | null;
  strategy: string | null;
  createdAt: string;
  sourcePlatform?: string;
  psychology?: {
    moodBefore: string | null;
    moodAfter: string | null;
    confidence: number | null;
    discipline: number | null;
    lessonsLearned: string | null;
  };
}

interface BenchmarkData {
  currentMonth: { trades: number; pnl: number; winRate: number };
  previousMonth: { trades: number; pnl: number; winRate: number };
  currentWeek: { trades: number; pnl: number; winRate: number };
  weeklyAverage: { pnl: number; trades: number; winRate: number };
  yearPnl: number;
  goals: { monthlyPnlTarget: number | null; yearlyPnlTarget: number | null } | null;
}

interface Analytics {
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
  bySymbol: { symbol: string; count: number; pnl: number; winRate: number }[];
  byTag: { tag: string; count: number; pnl: number; winRate: number }[];
  byWeekday: { day: number; count: number; pnl: number; winRate: number }[];
  equityCurve: { date: string; equity: number }[];
  calendarData: { date: string; pnl: number; trades: number }[];
}

interface SessionAnalytics {
  sessions: { session: string; trades: number; winRate: number; avgPnl: number; totalPnl: number }[];
  heatMapData: { day: number; hour: number; pnl: number }[];
}

interface PsychAnalytics {
  moodVsPnl: { mood: string; avgPnl: number; count: number }[];
  confidenceVsWinRate: { confidence: number; winRate: number; count: number }[];
  recentLessons: { lesson: string; date: string | null; pnl: number | null }[];
}

interface RiskAnalytics {
  maxDrawdown: number;
  maxDrawdownAbs: number;
  currentDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  riskRewardRatio: number | null;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  drawdownCurve: { date: string; equity: number; drawdown: number; peak: number }[];
  symbolExposure: { symbol: string; tradeCount: number; totalVolume: number; totalPnl: number; percentage: number; avgPnl: number }[];
  dailyReturns: number;
  meanDailyReturn: number;
  stdDevDaily: number;
  drawdownWarning: boolean;
  drawdownCritical: boolean;
  drawdownLimitPct: number | null;
  drawdownLimitAbs: number | null;
}

interface BrokerAccount {
  id: number;
  name: string;
  firm: string;
  balance: number;
  size: number;
  stage: string;
  integrationConnectionId: number | null;
  externalAccountId: string | null;
  status?: string;
}

interface JournalAlertItem {
  id: number;
  userId: number;
  type: string;
  severity: string;
  message: string;
  data: any;
  isRead: boolean;
  createdAt: string;
}

interface AlertSettings {
  maxDailyLoss: number | null;
  maxConsecutiveLosses: number;
  winRateDropThreshold: number;
  enabled: boolean;
}

interface BrokerConnection {
  id: number;
  providerName: string;
  providerKey: string;
  displayName: string;
  status: string;
}

const MOODS = ["great", "good", "neutral", "bad", "terrible"] as const;
const MOOD_EMOJI: Record<string, string> = { great: "😊", good: "🙂", neutral: "😐", bad: "😟", terrible: "😢" };
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DisplayMode = "dollar" | "percent";
type JournalMode = "auto" | "manual";

export default function Journal() {
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const queryClient = useQueryClient();
  const { formatCurrency } = useCurrency();

  const [journalMode, setJournalMode] = useState<JournalMode>("auto");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("dollar");
  const [activeTab, setActiveTab] = useState("trades");
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  const [newSymbol, setNewSymbol] = useState("");
  const [newSide, setNewSide] = useState("buy");
  const [newQty, setNewQty] = useState("");
  const [newEntry, setNewEntry] = useState("");
  const [newExit, setNewExit] = useState("");
  const [newPnl, setNewPnl] = useState("");
  const [newOpenedAt, setNewOpenedAt] = useState("");
  const [newClosedAt, setNewClosedAt] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newSetup, setNewSetup] = useState("");
  const [newStrategy, setNewStrategy] = useState("");

  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editMoodBefore, setEditMoodBefore] = useState("");
  const [editMoodAfter, setEditMoodAfter] = useState("");
  const [editConfidence, setEditConfidence] = useState("");
  const [editDiscipline, setEditDiscipline] = useState("");
  const [editLessons, setEditLessons] = useState("");

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; total: number; errors: string[]; unmatchedHeaders?: string[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importAccountId, setImportAccountId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [syncingAccounts, setSyncingAccounts] = useState<Set<number>>(new Set());
  const [syncingConnections, setSyncingConnections] = useState<Set<number>>(new Set());
  const [showFeatures, setShowFeatures] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showChartReplay, setShowChartReplay] = useState(false);
  const [chartReplayEntry, setChartReplayEntry] = useState<JournalEntry | null>(null);
  const [showGoalsDialog, setShowGoalsDialog] = useState(false);
  const [goalMonthly, setGoalMonthly] = useState("");
  const [goalYearly, setGoalYearly] = useState("");
  const [showAlertSettings, setShowAlertSettings] = useState(false);

  const { data: entries = [], isLoading: loadingEntries } = useQuery<JournalEntry[]>({
    queryKey: ["/api/v1/journal/entries", filterSymbol, filterTag],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/v1/journal/analytics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: riskAnalytics } = useQuery<RiskAnalytics>({
    queryKey: ["/api/v1/journal/risk-analytics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: sessionAnalytics } = useQuery<SessionAnalytics>({
    queryKey: ["/api/v1/journal/session-analytics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: psychAnalytics } = useQuery<PsychAnalytics>({
    queryKey: ["/api/v1/journal/psychology-analytics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: benchmarkData } = useQuery<BenchmarkData>({
    queryKey: ["/api/v1/journal/benchmark"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: accounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/v1/accounts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: connections = [] } = useQuery<BrokerConnection[]>({
    queryKey: ["/api/v1/integrations/connections"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: journalAlerts = [] } = useQuery<JournalAlertItem[]>({
    queryKey: ["/api/v1/journal/alerts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: alertSettings } = useQuery<AlertSettings>({
    queryKey: ["/api/v1/journal/alerts/settings"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const markAlertReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/v1/journal/alerts/${id}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/alerts"] });
    },
  });

  const markAllAlertsReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/v1/journal/alerts/read-all");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/alerts"] });
    },
  });

  const saveAlertSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AlertSettings>) => {
      const res = await apiRequest("POST", "/api/v1/journal/alerts/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/alerts/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/alerts"] });
      setShowAlertSettings(false);
      toast({ title: t("journal.settingsSaved") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.settingsError"), description: err?.message, variant: "destructive" });
    },
  });

  const unreadAlertCount = journalAlerts.filter(a => !a.isRead).length;

  const autoEntries = useMemo(() => entries.filter(e => e.sourcePlatform && e.sourcePlatform !== "manual"), [entries]);
  const manualEntries = useMemo(() => entries.filter(e => !e.sourcePlatform || e.sourcePlatform === "manual"), [entries]);
  const linkedAccounts = useMemo(() => accounts.filter(a => a.integrationConnectionId), [accounts]);

  const firmGroups = useMemo(() => {
    const map = new Map<string, BrokerAccount[]>();
    linkedAccounts.forEach(a => {
      const arr = map.get(a.firm) || [];
      arr.push(a);
      map.set(a.firm, arr);
    });
    return map;
  }, [linkedAccounts]);

  const connectionGroups = useMemo(() => {
    const map = new Map<number, BrokerAccount[]>();
    linkedAccounts.forEach(a => {
      if (a.integrationConnectionId) {
        const arr = map.get(a.integrationConnectionId) || [];
        arr.push(a);
        map.set(a.integrationConnectionId, arr);
      }
    });
    return map;
  }, [linkedAccounts]);

  function formatValue(value: number, baseBalance?: number): string {
    if (displayMode === "percent" && baseBalance && baseBalance > 0) {
      const pct = (value / baseBalance) * 100;
      return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
    }
    return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
  }

  const createEntryMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/journal/entries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      setShowAddTrade(false);
      resetForm();
      toast({ title: t("journal.tradeAdded") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/v1/journal/entries/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      toast({ title: t("journal.updated") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.updateError"), description: err?.message, variant: "destructive" });
    },
  });

  const savePsychologyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("POST", `/api/v1/journal/entries/${id}/psychology`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/psychology-analytics"] });
      toast({ title: t("journal.psychologySaved") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.psychologyError"), description: err?.message, variant: "destructive" });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v1/journal/entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      setSelectedEntry(null);
      toast({ title: t("journal.deleted") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.deleteError"), description: err?.message, variant: "destructive" });
    },
  });

  const saveGoalsMutation = useMutation({
    mutationFn: async (data: { monthlyPnlTarget: number | null; yearlyPnlTarget: number | null }) => {
      const res = await apiRequest("POST", "/api/v1/journal/goals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/benchmark"] });
      setShowGoalsDialog(false);
      toast({ title: t("journal.goalsSaved") });
    },
    onError: (err: any) => {
      toast({ title: t("journal.goalsError"), description: err?.message, variant: "destructive" });
    },
  });

  function openGoalsDialog() {
    setGoalMonthly(benchmarkData?.goals?.monthlyPnlTarget?.toString() || "");
    setGoalYearly(benchmarkData?.goals?.yearlyPnlTarget?.toString() || "");
    setShowGoalsDialog(true);
  }

  function handleSaveGoals() {
    saveGoalsMutation.mutate({
      monthlyPnlTarget: goalMonthly ? parseFloat(goalMonthly) : null,
      yearlyPnlTarget: goalYearly ? parseFloat(goalYearly) : null,
    });
  }

  function resetForm() {
    setNewSymbol(""); setNewSide("buy"); setNewQty(""); setNewEntry("");
    setNewExit(""); setNewPnl(""); setNewOpenedAt(""); setNewClosedAt("");
    setNewNotes(""); setNewTags(""); setNewSetup(""); setNewStrategy("");
  }

  function handleAddTrade() {
    createEntryMutation.mutate({
      symbol: newSymbol.toUpperCase(),
      side: newSide,
      quantity: parseFloat(newQty),
      entryPrice: parseFloat(newEntry),
      exitPrice: parseFloat(newExit),
      realizedPnl: parseFloat(newPnl),
      openedAt: newOpenedAt,
      closedAt: newClosedAt,
      notes: newNotes || undefined,
      tags: newTags ? newTags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      setupType: newSetup || undefined,
      strategy: newStrategy || undefined,
    });
  }

  async function handleImportCSV() {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      if (importAccountId) formData.append("accountId", importAccountId);
      const csvCsrfToken = await getCsrfToken();
      const csvHeaders: Record<string, string> = {};
      if (csvCsrfToken) csvHeaders["x-csrf-token"] = csvCsrfToken;
      const res = await fetch(apiUrl("/api/v1/journal/import-csv"), {
        method: "POST",
        headers: csvHeaders,
        body: formData,
        credentials: "include",
      });
      let data;
      try { data = await res.json(); } catch { throw new Error(t("journal.importError")); }
      if (!res.ok || !data.success) {
        setImportError(data.message || t("journal.importError"));
        return;
      }
      setImportResult({ imported: data.imported, skipped: data.skipped, total: data.total, errors: data.errors || [], unmatchedHeaders: data.unmatchedHeaders });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      toast({ title: t("journal.importSuccess", { count: data.imported }) });
    } catch (err: any) {
      setImportError(err.message || t("journal.importError"));
    } finally {
      setImporting(false);
    }
  }

  function handleExportCSV() {
    window.open(apiUrl("/api/v1/journal/export?format=csv"), "_blank");
  }

  function handleExportNotion() {
    window.open(apiUrl("/api/v1/journal/export?format=notion"), "_blank");
  }

  async function syncAccount(accountId: number) {
    setSyncingAccounts(prev => new Set(prev).add(accountId));
    try {
      const res = await apiRequest("POST", `/api/v1/accounts/${accountId}/fetch-trades`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      toast({ title: t("journal.syncSuccess"), description: `${data.newTrades || 0} ${t("journal.newTrades")}` });
    } catch (err: any) {
      toast({ title: t("journal.syncError"), description: err?.message, variant: "destructive" });
    } finally {
      setSyncingAccounts(prev => { const n = new Set(prev); n.delete(accountId); return n; });
    }
  }

  async function syncConnection(connectionId: number) {
    setSyncingConnections(prev => new Set(prev).add(connectionId));
    try {
      const res = await apiRequest("POST", `/api/v1/integrations/connections/${connectionId}/fetch-trades`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/session-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      toast({ title: t("journal.syncSuccess"), description: `${data.totalNew || 0} ${t("journal.newTrades")}` });
    } catch (err: any) {
      toast({ title: t("journal.syncError"), description: err?.message, variant: "destructive" });
    } finally {
      setSyncingConnections(prev => { const n = new Set(prev); n.delete(connectionId); return n; });
    }
  }

  async function syncAllFirmAccounts(firmName: string) {
    const firmAccounts = firmGroups.get(firmName) || [];
    for (const a of firmAccounts) {
      await syncAccount(a.id);
    }
  }

  function openEntryDetail(entry: JournalEntry) {
    setSelectedEntry(entry);
    setEditNotes(entry.notes || "");
    setEditTags(entry.tags?.join(", ") || "");
    setEditMoodBefore(entry.psychology?.moodBefore || "");
    setEditMoodAfter(entry.psychology?.moodAfter || "");
    setEditConfidence(String(entry.psychology?.confidence || ""));
    setEditDiscipline(String(entry.psychology?.discipline || ""));
    setEditLessons(entry.psychology?.lessonsLearned || "");
  }

  function saveEntryDetail() {
    if (!selectedEntry) return;
    const tags = editTags ? editTags.split(",").map(t => t.trim()).filter(Boolean) : [];
    updateEntryMutation.mutate({
      id: selectedEntry.id,
      data: { notes: editNotes, tags },
    });
    savePsychologyMutation.mutate({
      id: selectedEntry.id,
      data: {
        moodBefore: editMoodBefore || undefined,
        moodAfter: editMoodAfter || undefined,
        confidence: editConfidence ? parseInt(editConfidence) : undefined,
        discipline: editDiscipline ? parseInt(editDiscipline) : undefined,
        lessonsLearned: editLessons || undefined,
      },
    });
  }

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calMap = new Map<string, { pnl: number; trades: number }>();
    if (analytics?.calendarData) {
      for (const d of analytics.calendarData) {
        calMap.set(d.date, d);
      }
    }
    const days: { date: number; pnl: number; trades: number; dateStr: string }[] = [];
    for (let i = 0; i < firstDay; i++) {
      days.push({ date: 0, pnl: 0, trades: 0, dateStr: "" });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const data = calMap.get(dateStr);
      days.push({ date: d, pnl: data?.pnl || 0, trades: data?.trades || 0, dateStr });
    }
    return days;
  }, [calendarMonth, analytics?.calendarData]);

  const currentEntries = journalMode === "auto" ? autoEntries : manualEntries;

  return (
    <div className={`min-h-screen bg-background ${rtl ? "rtl" : "ltr"}`} dir={rtl ? "rtl" : "ltr"}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between rtl:sm:flex-row-reverse mb-6 gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
                <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />
                {t("journal.title")}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">{t("journal.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 me-2" data-testid="toggle-display-mode">
              <Button
                variant={displayMode === "dollar" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2.5"
                onClick={() => setDisplayMode("dollar")}
                data-testid="btn-display-dollar"
              >
                <DollarSign className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={displayMode === "percent" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2.5"
                onClick={() => setDisplayMode("percent")}
                data-testid="btn-display-percent"
              >
                <Percent className="w-3.5 h-3.5" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowReplay(true)} data-testid="btn-replay"
              className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
              disabled={entries.length === 0}>
              <Play className="w-4 h-4 me-1" />
              <span className="hidden sm:inline">{t("replay.replayBtn")}</span>
            </Button>
          </div>
        </div>

        {/* Mode Toggle: Auto / Manual */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex bg-secondary/30 rounded-xl p-1 border border-border/50 flex-1 max-w-md" data-testid="toggle-journal-mode">
            <button
              onClick={() => setJournalMode("auto")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                journalMode === "auto"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
              data-testid="btn-mode-auto"
            >
              <RefreshCw className="w-4 h-4" />
              {t("journal.autoMode")}
            </button>
            <button
              onClick={() => setJournalMode("manual")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                journalMode === "manual"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
              data-testid="btn-mode-manual"
            >
              <Pencil className="w-4 h-4" />
              {t("journal.manualMode")}
            </button>
          </div>
          <Badge variant="secondary" className="text-xs">
            {currentEntries.length} {t("journal.trades")}
          </Badge>
        </div>

        {/* Mode Content */}
        {journalMode === "auto" ? (
          <div className="space-y-6" key="auto-mode">
            {/* Sync Control Panel */}
            <Card className="border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
              <CardContent className="py-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-indigo-400" />
                    {t("journal.syncPanel")}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/integrations")}
                    className="text-xs"
                    data-testid="btn-manage-connections"
                  >
                    <Link2 className="w-3.5 h-3.5 me-1" />
                    {t("journal.manageConnections")}
                  </Button>
                </div>

                {linkedAccounts.length === 0 ? (
                  <div className="text-center py-8">
                    <Link2 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">{t("journal.noLinkedAccounts")}</p>
                    <Button variant="outline" size="sm" onClick={() => navigate("/integrations")} data-testid="btn-connect-broker">
                      <Plus className="w-4 h-4 me-1" />
                      {t("journal.connectBroker")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* By Connection */}
                    {connections.filter(c => connectionGroups.has(c.id)).map(conn => (
                      <div key={conn.id} className="rounded-xl border border-border/50 bg-secondary/10 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-secondary/20">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-cyan-400" />
                            <span className="text-sm font-medium">{conn.displayName || conn.providerName}</span>
                            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400">
                              {conn.providerKey}
                            </Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => syncConnection(conn.id)}
                            disabled={syncingConnections.has(conn.id)}
                            data-testid={`btn-sync-connection-${conn.id}`}
                          >
                            {syncingConnections.has(conn.id) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin me-1" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5 me-1" />
                            )}
                            {t("journal.syncAll")}
                          </Button>
                        </div>

                        {/* Firm sub-groups within this connection */}
                        {(() => {
                          const connAccounts = connectionGroups.get(conn.id) || [];
                          const firms = new Map<string, BrokerAccount[]>();
                          connAccounts.forEach(a => {
                            const arr = firms.get(a.firm) || [];
                            arr.push(a);
                            firms.set(a.firm, arr);
                          });
                          return Array.from(firms.entries()).map(([firmName, firmAccs]) => (
                            <div key={firmName} className="px-4 py-2">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                                  <span className="text-xs font-medium text-muted-foreground">{firmName}</span>
                                  <Badge variant="secondary" className="text-[10px]">{firmAccs.length}</Badge>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                                  onClick={() => syncAllFirmAccounts(firmName)}
                                  data-testid={`btn-sync-firm-${firmName}`}
                                >
                                  <RefreshCw className="w-3 h-3 me-1" />
                                  {t("journal.syncFirm")}
                                </Button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {firmAccs.map(acc => {
                                  const accEntries = autoEntries.filter(e => e.accountId === acc.id);
                                  const accPnl = accEntries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
                                  return (
                                    <div key={acc.id}
                                      className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/20 border border-border/30 hover:border-indigo-500/30 transition-colors"
                                      data-testid={`sync-account-card-${acc.id}`}
                                    >
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <Wallet className={`w-3.5 h-3.5 flex-shrink-0 ${acc.status === 'sync_failed' ? 'text-orange-400' : 'text-muted-foreground'}`} />
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-medium truncate">{acc.name}</p>
                                            {acc.status === 'sync_failed' && (
                                              <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/50 text-orange-400 flex-shrink-0" data-testid={`badge-sync-failed-${acc.id}`}>
                                                <AlertTriangle className="w-2.5 h-2.5 me-0.5" />
                                                {t("status.sync_failed", { defaultValue: "failed" })}
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <span>{accEntries.length} {t("journal.trades")}</span>
                                            {accEntries.length > 0 && (
                                              <span className={accPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                                {formatValue(accPnl, acc.size)}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 flex-shrink-0"
                                        onClick={() => syncAccount(acc.id)}
                                        disabled={syncingAccounts.has(acc.id)}
                                        data-testid={`btn-sync-account-${acc.id}`}
                                      >
                                        {syncingAccounts.has(acc.id) ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <RefreshCw className="w-3.5 h-3.5" />
                                        )}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Auto KPI Summary */}
            {autoEntries.length > 0 && (
              <AutoKPIBar entries={autoEntries} displayMode={displayMode} formatValue={formatValue} t={t} />
            )}

            {/* Tabs for auto trades — only shown when there are synced entries */}
            {autoEntries.length > 0 && (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8 mb-6">
                  <TabsTrigger value="trades" data-testid="tab-auto-trades">
                    <FileText className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.trades")}</span><span className="sm:hidden text-[10px]">{t("journal.trades")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="analytics" data-testid="tab-auto-analytics">
                    <BarChart3 className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.analytics")}</span><span className="sm:hidden text-[10px]">{t("journal.analytics")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="risk" data-testid="tab-auto-risk">
                    <ShieldAlert className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.risk")}</span><span className="sm:hidden text-[10px]">{t("journal.risk")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="benchmark" data-testid="tab-auto-benchmark">
                    <BarChart2 className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.benchmark")}</span><span className="sm:hidden text-[10px]">{t("journal.benchmark")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="calendar" data-testid="tab-auto-calendar">
                    <Calendar className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.calendar")}</span><span className="sm:hidden text-[10px]">{t("journal.calendar")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="psychology" data-testid="tab-auto-psychology">
                    <Brain className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.psychology")}</span><span className="sm:hidden text-[10px]">{t("journal.psychology")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="alerts" data-testid="tab-auto-alerts" className="relative">
                    <Bell className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.alerts")}</span><span className="sm:hidden text-[10px]">{t("journal.alerts")}</span>
                    {unreadAlertCount > 0 && (
                      <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{unreadAlertCount}</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="playbook" data-testid="tab-auto-playbook">
                    <BookOpen className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.playbook")}</span><span className="sm:hidden text-[10px]">{t("journal.playbook")}</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="trades">
                  <TradeList
                    entries={autoEntries}
                    loading={loadingEntries}
                    filterSymbol={filterSymbol}
                    setFilterSymbol={setFilterSymbol}
                    filterTag={filterTag}
                    setFilterTag={setFilterTag}
                    filterDate={filterDate}
                    setFilterDate={setFilterDate}
                    onSelect={openEntryDetail}
                    onDelete={(id) => deleteEntryMutation.mutate(id)}
                    onViewChart={(entry) => { setChartReplayEntry(entry); setShowChartReplay(true); }}
                    displayMode={displayMode}
                    accounts={accounts}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="analytics">
                  <AnalyticsDashboard analytics={analytics} sessionAnalytics={sessionAnalytics} displayMode={displayMode} t={t} />
                </TabsContent>
                <TabsContent value="risk">
                  <RiskDashboard riskAnalytics={riskAnalytics} t={t} />
                </TabsContent>
                <TabsContent value="benchmark">
                  <BenchmarkDashboard benchmark={benchmarkData} t={t} onSetGoals={openGoalsDialog} />
                </TabsContent>
                <TabsContent value="calendar">
                  <CalendarView
                    calendarDays={calendarDays}
                    calendarMonth={calendarMonth}
                    setCalendarMonth={setCalendarMonth}
                    displayMode={displayMode}
                    onDayClick={(dateStr) => { setFilterDate(dateStr); setActiveTab("trades"); }}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="psychology">
                  <PsychologyAnalytics psychAnalytics={psychAnalytics} t={t} />
                </TabsContent>
                <TabsContent value="alerts">
                  <AlertsSection
                    alerts={journalAlerts}
                    onMarkRead={(id) => markAlertReadMutation.mutate(id)}
                    onMarkAllRead={() => markAllAlertsReadMutation.mutate()}
                    onOpenSettings={() => setShowAlertSettings(true)}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="playbook">
                  <PlaybookManager />
                </TabsContent>
              </Tabs>
            )}
          </div>
        ) : (
          <div className="space-y-6" key="manual-mode">
            {/* Manual toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="btn-export-csv" disabled={manualEntries.length === 0}>
                <Download className="w-4 h-4 me-1" />
                {t("journal.export")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportNotion} data-testid="btn-export-notion" disabled={manualEntries.length === 0} className="border-gray-600 hover:bg-gray-800">
                <ExternalLink className="w-4 h-4 me-1" />
                {t("journal.exportNotion")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowImportDialog(true); setImportFile(null); setImportResult(null); setImportAccountId(""); }} data-testid="btn-import-csv">
                <Upload className="w-4 h-4 me-1" />
                {t("journal.import")}
              </Button>
              <Button onClick={() => setShowAddTrade(true)} data-testid="btn-add-trade">
                <Plus className="w-4 h-4 me-1" />
                {t("journal.addTrade")}
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8 mb-6">
                <TabsTrigger value="trades" data-testid="tab-trades">
                  <FileText className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.trades")}</span><span className="sm:hidden text-[10px]">{t("journal.trades")}</span>
                </TabsTrigger>
                <TabsTrigger value="analytics" data-testid="tab-analytics">
                  <BarChart3 className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.analytics")}</span><span className="sm:hidden text-[10px]">{t("journal.analytics")}</span>
                </TabsTrigger>
                <TabsTrigger value="risk" data-testid="tab-risk">
                  <ShieldAlert className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.risk")}</span><span className="sm:hidden text-[10px]">{t("journal.risk")}</span>
                </TabsTrigger>
                <TabsTrigger value="benchmark" data-testid="tab-benchmark">
                  <BarChart2 className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.benchmark")}</span><span className="sm:hidden text-[10px]">{t("journal.benchmark")}</span>
                </TabsTrigger>
                <TabsTrigger value="calendar" data-testid="tab-calendar">
                  <Calendar className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.calendar")}</span><span className="sm:hidden text-[10px]">{t("journal.calendar")}</span>
                </TabsTrigger>
                <TabsTrigger value="psychology" data-testid="tab-psychology">
                  <Brain className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.psychology")}</span><span className="sm:hidden text-[10px]">{t("journal.psychology")}</span>
                </TabsTrigger>
                <TabsTrigger value="alerts" data-testid="tab-alerts" className="relative">
                  <Bell className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.alerts")}</span><span className="sm:hidden text-[10px]">{t("journal.alerts")}</span>
                  {unreadAlertCount > 0 && (
                    <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{unreadAlertCount}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="playbook" data-testid="tab-playbook">
                  <BookOpen className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t("journal.playbook")}</span><span className="sm:hidden text-[10px]">{t("journal.playbook")}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="trades">
                <TradeList
                  entries={manualEntries}
                  loading={loadingEntries}
                  filterSymbol={filterSymbol}
                  setFilterSymbol={setFilterSymbol}
                  filterTag={filterTag}
                  setFilterTag={setFilterTag}
                  filterDate={filterDate}
                  setFilterDate={setFilterDate}
                  onSelect={openEntryDetail}
                  onDelete={(id) => deleteEntryMutation.mutate(id)}
                  onViewChart={(entry) => { setChartReplayEntry(entry); setShowChartReplay(true); }}
                  displayMode={displayMode}
                  accounts={accounts}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="analytics">
                <AnalyticsDashboard analytics={analytics} sessionAnalytics={sessionAnalytics} displayMode={displayMode} t={t} />
              </TabsContent>
              <TabsContent value="risk">
                <RiskDashboard riskAnalytics={riskAnalytics} t={t} />
              </TabsContent>
              <TabsContent value="benchmark">
                <BenchmarkDashboard benchmark={benchmarkData} t={t} onSetGoals={openGoalsDialog} />
              </TabsContent>
              <TabsContent value="calendar">
                <CalendarView
                  calendarDays={calendarDays}
                  calendarMonth={calendarMonth}
                  setCalendarMonth={setCalendarMonth}
                  displayMode={displayMode}
                  onDayClick={(dateStr) => { setFilterDate(dateStr); setActiveTab("trades"); }}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="psychology">
                <PsychologyAnalytics psychAnalytics={psychAnalytics} t={t} />
              </TabsContent>
              <TabsContent value="alerts">
                <AlertsSection
                  alerts={journalAlerts}
                  onMarkRead={(id) => markAlertReadMutation.mutate(id)}
                  onMarkAllRead={() => markAllAlertsReadMutation.mutate()}
                  onOpenSettings={() => setShowAlertSettings(true)}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="playbook">
                <PlaybookManager />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Alert Settings Dialog */}
        <AlertSettingsDialog
          open={showAlertSettings}
          onOpenChange={setShowAlertSettings}
          settings={alertSettings}
          onSave={(data) => saveAlertSettingsMutation.mutate(data)}
          saving={saveAlertSettingsMutation.isPending}
          t={t}
        />

        {/* Add Trade Dialog */}
        <Dialog open={showAddTrade} onOpenChange={setShowAddTrade}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-500" />
                {t("journal.addManualTrade")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("journal.symbol")}</Label>
                  <Input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)}
                    placeholder="ES, NQ, CL" dir="ltr" data-testid="input-journal-symbol" />
                </div>
                <div>
                  <Label>{t("journal.side")}</Label>
                  <Select value={newSide} onValueChange={setNewSide}>
                    <SelectTrigger data-testid="select-journal-side">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">Buy / Long</SelectItem>
                      <SelectItem value="sell">Sell / Short</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>{t("journal.quantity")}</Label>
                  <Input type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)}
                    dir="ltr" data-testid="input-journal-qty" />
                </div>
                <div>
                  <Label>{t("journal.entryPrice")}</Label>
                  <Input type="number" step="0.01" value={newEntry} onChange={(e) => setNewEntry(e.target.value)}
                    dir="ltr" data-testid="input-journal-entry-price" />
                </div>
                <div>
                  <Label>{t("journal.exitPrice")}</Label>
                  <Input type="number" step="0.01" value={newExit} onChange={(e) => setNewExit(e.target.value)}
                    dir="ltr" data-testid="input-journal-exit-price" />
                </div>
              </div>
              <div>
                <Label>{t("journal.realizedPnl")}</Label>
                <Input type="number" step="0.01" value={newPnl} onChange={(e) => setNewPnl(e.target.value)}
                  dir="ltr" data-testid="input-journal-pnl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("journal.openedAt")}</Label>
                  <Input type="datetime-local" value={newOpenedAt} onChange={(e) => setNewOpenedAt(e.target.value)}
                    dir="ltr" data-testid="input-journal-opened" />
                </div>
                <div>
                  <Label>{t("journal.closedAt")}</Label>
                  <Input type="datetime-local" value={newClosedAt} onChange={(e) => setNewClosedAt(e.target.value)}
                    dir="ltr" data-testid="input-journal-closed" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("journal.setupType")}</Label>
                  <Input value={newSetup} onChange={(e) => setNewSetup(e.target.value)}
                    placeholder={t("journal.setupPlaceholder")} data-testid="input-journal-setup" />
                </div>
                <div>
                  <Label>{t("journal.strategy")}</Label>
                  <Input value={newStrategy} onChange={(e) => setNewStrategy(e.target.value)}
                    placeholder={t("journal.strategyPlaceholder")} data-testid="input-journal-strategy" />
                </div>
              </div>
              <div>
                <Label>{t("journal.tags")}</Label>
                <Input value={newTags} onChange={(e) => setNewTags(e.target.value)}
                  placeholder={t("journal.tagsPlaceholder")} data-testid="input-journal-tags" />
              </div>
              <div>
                <Label>{t("journal.notes")}</Label>
                <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
                  rows={3} data-testid="input-journal-notes" />
              </div>
              <Button onClick={handleAddTrade} className="w-full"
                disabled={isDemo || !newSymbol || !newQty || !newEntry || !newExit || !newPnl || !newOpenedAt || !newClosedAt || createEntryMutation.isPending}
                data-testid="btn-submit-journal-trade">
                {createEntryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : <Plus className="w-4 h-4 me-1" />}
                {t("journal.addTrade")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Entry Detail Dialog */}
        <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-indigo-500" />
                {selectedEntry?.symbol} — {t("journal.tradeDetail")}
              </DialogTitle>
            </DialogHeader>
            {selectedEntry && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">{t("journal.side")}:</span> <Badge variant="outline">{selectedEntry.side}</Badge></div>
                  <div><span className="text-muted-foreground">{t("journal.quantity")}:</span> {selectedEntry.quantity}</div>
                  <div><span className="text-muted-foreground">{t("journal.entryPrice")}:</span> ${selectedEntry.entryPrice?.toFixed(2)}</div>
                  <div><span className="text-muted-foreground">{t("journal.exitPrice")}:</span> ${selectedEntry.exitPrice?.toFixed(2)}</div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{t("journal.realizedPnl")}:</span>{" "}
                    <span className={`font-bold ${(selectedEntry.realizedPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {(selectedEntry.realizedPnl || 0) >= 0 ? "+" : ""}{formatCurrency(selectedEntry.realizedPnl || 0)}
                    </span>
                  </div>
                </div>

                {selectedEntry.symbol && selectedEntry.openedAt && selectedEntry.closedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10"
                    onClick={() => {
                      setChartReplayEntry(selectedEntry);
                      setSelectedEntry(null);
                      setShowChartReplay(true);
                    }}
                    data-testid="btn-detail-view-chart"
                  >
                    <BarChart3 className="w-4 h-4 me-2" />
                    {t("replay.viewChart")}
                  </Button>
                )}

                <div>
                  <Label>{t("journal.notes")}</Label>
                  <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3}
                    data-testid="input-edit-notes" />
                </div>
                <div>
                  <Label>{t("journal.tags")}</Label>
                  <Input value={editTags} onChange={(e) => setEditTags(e.target.value)}
                    placeholder={t("journal.tagsPlaceholder")} data-testid="input-edit-tags" />
                </div>
                {selectedEntry.autoTags && selectedEntry.autoTags.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("journal.autoTag")}</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedEntry.autoTags.map(tag => (
                        <Badge key={`auto-${tag}`} variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10" data-testid={`detail-autotag-${tag}`}>
                          <span className="me-0.5">🤖</span>{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <Brain className="w-4 h-4 text-purple-400" /> {t("journal.psychologySnapshot")}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("journal.moodBefore")}</Label>
                      <Select value={editMoodBefore} onValueChange={setEditMoodBefore}>
                        <SelectTrigger data-testid="select-mood-before"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {MOODS.map(m => (
                            <SelectItem key={m} value={m}>{MOOD_EMOJI[m]} {t(`journal.mood.${m}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("journal.moodAfter")}</Label>
                      <Select value={editMoodAfter} onValueChange={setEditMoodAfter}>
                        <SelectTrigger data-testid="select-mood-after"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {MOODS.map(m => (
                            <SelectItem key={m} value={m}>{MOOD_EMOJI[m]} {t(`journal.mood.${m}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("journal.confidence")} (1-5)</Label>
                      <Select value={editConfidence} onValueChange={setEditConfidence}>
                        <SelectTrigger data-testid="select-confidence"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {[1,2,3,4,5].map(v => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("journal.discipline")} (1-5)</Label>
                      <Select value={editDiscipline} onValueChange={setEditDiscipline}>
                        <SelectTrigger data-testid="select-discipline"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {[1,2,3,4,5].map(v => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label>{t("journal.lessonsLearned")}</Label>
                    <Textarea value={editLessons} onChange={(e) => setEditLessons(e.target.value)} rows={2}
                      data-testid="input-lessons" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={saveEntryDetail} className="flex-1" data-testid="btn-save-entry-detail"
                    disabled={isDemo || updateEntryMutation.isPending || savePsychologyMutation.isPending}>
                    {(updateEntryMutation.isPending || savePsychologyMutation.isPending)
                      ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
                    {t("journal.save")}
                  </Button>
                  <Button variant="destructive" size="icon"
                    onClick={() => deleteEntryMutation.mutate(selectedEntry.id)}
                    disabled={isDemo}
                    data-testid="btn-delete-entry">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Import CSV Dialog */}
        <Dialog open={showImportDialog} onOpenChange={(open) => { setShowImportDialog(open); if (!open) { setImportFile(null); setImportResult(null); setImportError(null); setImportAccountId(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-500" />
                {t("journal.importTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("journal.importDescription")}</p>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  data-testid="input-csv-file"
                />
                {importFile ? (
                  <div className="space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-indigo-400" />
                    <p className="text-sm font-medium">{importFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                    <Button variant="ghost" size="sm" onClick={() => setImportFile(null)} data-testid="btn-remove-file">
                      <X className="w-3 h-3 me-1" /> {t("journal.removeFile")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="btn-choose-file">
                      {t("journal.chooseFile")}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t("journal.csvFormats")}</p>
                  </div>
                )}
              </div>

              {accounts.length > 0 && (
                <div>
                  <Label className="text-xs">{t("journal.importAccount")}</Label>
                  <Select value={importAccountId} onValueChange={setImportAccountId}>
                    <SelectTrigger className="mt-1" data-testid="select-import-account">
                      <SelectValue placeholder={t("journal.noAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("journal.noAccount")}</SelectItem>
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={String(acc.id)}>{acc.name} ({acc.firm})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="bg-secondary/30 rounded-lg p-3">
                <p className="text-xs font-medium mb-1">{t("journal.requiredColumns")}</p>
                <p className="text-xs text-muted-foreground">Symbol, Side, PnL (Realized PnL)</p>
                <p className="text-xs font-medium mt-2 mb-1">{t("journal.optionalColumns")}</p>
                <p className="text-xs text-muted-foreground">Quantity, Entry Price, Exit Price, Opened At, Closed At, Notes, Tags, Setup Type, Strategy</p>
              </div>

              {importError && (
                <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/20" data-testid="text-import-error">
                  <p className="text-sm font-medium text-red-400">{importError}</p>
                </div>
              )}

              {importResult && (
                <div className={`rounded-lg p-3 ${importResult.imported > 0 ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                  <p className="text-sm font-medium" data-testid="text-import-result">
                    {t("journal.importResult", { imported: importResult.imported, skipped: importResult.skipped, total: importResult.total })}
                  </p>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                  {importResult.unmatchedHeaders && importResult.unmatchedHeaders.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("journal.unmatchedColumns")}: {importResult.unmatchedHeaders.join(", ")}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleImportCSV} className="flex-1" disabled={!importFile || importing} data-testid="btn-start-import">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : <Upload className="w-4 h-4 me-1" />}
                  {importing ? t("journal.importing") : t("journal.startImport")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Trade Replay Dialog — offers both equity-curve and chart replay */}
        <Dialog open={showReplay} onOpenChange={setShowReplay}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="w-5 h-5 text-indigo-500" />
                {t("replay.title")}
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="equity" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-3">
                <TabsTrigger value="equity" data-testid="tab-equity-replay">
                  <Activity className="w-4 h-4 me-1" />
                  {t("replay.equityReplay")}
                </TabsTrigger>
                <TabsTrigger value="chart" data-testid="tab-chart-replay">
                  <BarChart3 className="w-4 h-4 me-1" />
                  {t("replay.chartReplay")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="equity">
                <TradeReplay
                  entries={entries}
                  onClose={() => setShowReplay(false)}
                  t={t}
                />
              </TabsContent>
              <TabsContent value="chart">
                <ReplayTradeSelector
                  entries={entries}
                  onSelect={(entry) => {
                    setShowReplay(false);
                    setChartReplayEntry(entry);
                    setShowChartReplay(true);
                  }}
                  t={t}
                />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Candlestick Chart Replay Dialog */}
        <Dialog open={showChartReplay} onOpenChange={(open) => {
          setShowChartReplay(open);
          if (!open) setChartReplayEntry(null);
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-500" />
                {t("replay.viewChart")} — {chartReplayEntry?.symbol}
              </DialogTitle>
            </DialogHeader>
            {chartReplayEntry && (
              <CandlestickReplay
                trade={chartReplayEntry}
                onClose={() => {
                  setShowChartReplay(false);
                  setChartReplayEntry(null);
                }}
                t={t}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Goals Dialog */}
        <Dialog open={showGoalsDialog} onOpenChange={setShowGoalsDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-indigo-500" />
                {t("journal.goalsTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t("journal.monthlyTarget")}</Label>
                <Input type="number" step="0.01" value={goalMonthly} onChange={(e) => setGoalMonthly(e.target.value)}
                  placeholder="e.g. 5000" dir="ltr" data-testid="input-goal-monthly" />
              </div>
              <div>
                <Label>{t("journal.yearlyTarget")}</Label>
                <Input type="number" step="0.01" value={goalYearly} onChange={(e) => setGoalYearly(e.target.value)}
                  placeholder="e.g. 50000" dir="ltr" data-testid="input-goal-yearly" />
              </div>
              <Button className="w-full" onClick={handleSaveGoals} disabled={saveGoalsMutation.isPending} data-testid="btn-save-goals">
                {saveGoalsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
                {t("journal.saveGoals")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Features & Suggestions Dialog */}
        <Dialog open={showFeatures} onOpenChange={setShowFeatures}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                {t("journal.featuresTitle")}
              </DialogTitle>
            </DialogHeader>
            <FeaturesSuggestions t={t} onClose={() => setShowFeatures(false)} navigate={navigate} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function AutoKPIBar({ entries, displayMode, formatValue, t }: {
  entries: JournalEntry[];
  displayMode: DisplayMode;
  formatValue: (v: number, base?: number) => string;
  t: any;
}) {
  const totalPnl = entries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
  const winners = entries.filter(e => (e.realizedPnl || 0) > 0).length;
  const winRate = entries.length > 0 ? (winners / entries.length) * 100 : 0;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayEntries = entries.filter(e => (e.closedAt || "").startsWith(todayStr));
  const todayPnl = todayEntries.reduce((s, e) => s + (e.realizedPnl || 0), 0);
  const uniqueSymbols = new Set(entries.map(e => e.symbol).filter(Boolean));

  const kpis = [
    { label: t("journal.totalPnl"), value: formatValue(totalPnl), color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400", icon: TrendingUp },
    { label: t("journal.todayPnl"), value: formatValue(todayPnl), color: todayPnl >= 0 ? "text-emerald-400" : "text-red-400", icon: Activity },
    { label: t("journal.winRate"), value: `${winRate.toFixed(1)}%`, color: "text-indigo-400", icon: Target },
    { label: t("journal.totalTrades"), value: String(entries.length), color: "text-amber-400", icon: Zap },
    { label: t("journal.symbolsTraded"), value: String(uniqueSymbols.size), color: "text-cyan-400", icon: BarChart2 },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="border-border/40">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{kpi.label}</p>
            </div>
            <p className={`text-lg font-bold ${kpi.color}`} data-testid={`auto-kpi-${kpi.label}`}>{kpi.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TradeList({
  entries, loading, filterSymbol, setFilterSymbol, filterTag, setFilterTag, filterDate, setFilterDate, onSelect, onDelete, onViewChart, displayMode, accounts, t
}: {
  entries: JournalEntry[];
  loading: boolean;
  filterSymbol: string;
  setFilterSymbol: (v: string) => void;
  filterTag: string;
  setFilterTag: (v: string) => void;
  filterDate: string;
  setFilterDate: (v: string) => void;
  onSelect: (e: JournalEntry) => void;
  onDelete: (id: number) => void;
  onViewChart: (e: JournalEntry) => void;
  displayMode: DisplayMode;
  accounts: BrokerAccount[];
  t: any;
}) {
  const { formatCurrency } = useCurrency();
  const [sortField, setSortField] = useState<"date" | "pnl" | "symbol">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    let result = entries;
    if (filterSymbol) result = result.filter(e => e.symbol?.toLowerCase().includes(filterSymbol.toLowerCase()));
    if (filterTag) result = result.filter(e => e.tags?.some(t => t.toLowerCase().includes(filterTag.toLowerCase())));
    if (filterDate) result = result.filter(e => {
      const d = e.closedAt || e.openedAt;
      return d && d.startsWith(filterDate);
    });
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = new Date(a.closedAt || a.openedAt || 0).getTime() - new Date(b.closedAt || b.openedAt || 0).getTime();
      else if (sortField === "pnl") cmp = (a.realizedPnl || 0) - (b.realizedPnl || 0);
      else if (sortField === "symbol") cmp = (a.symbol || "").localeCompare(b.symbol || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [entries, filterSymbol, filterTag, filterDate, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const effectivePage = Math.min(currentPage, totalPages);
  const paginatedEntries = useMemo(() => {
    const page = Math.min(currentPage, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function toggleSort(field: "date" | "pnl" | "symbol") {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  function getAccountSize(accountId: number | null): number {
    if (!accountId) return 0;
    return accounts.find(a => a.id === accountId)?.size || 0;
  }

  function formatPnl(value: number, accountId: number | null): string {
    if (displayMode === "percent") {
      const base = getAccountSize(accountId);
      if (base > 0) {
        const pct = (value / base) * 100;
        return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      }
    }
    return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Input
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            placeholder={t("journal.filterBySymbol")}
            className="max-w-[180px]"
            dir="ltr"
            data-testid="input-filter-symbol"
          />
          <Input
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            placeholder={t("journal.filterByTag")}
            className="max-w-[180px]"
            data-testid="input-filter-tag"
          />
          {filterDate && (
            <Badge variant="default" className="cursor-pointer gap-1" onClick={() => setFilterDate("")}
              data-testid="badge-filter-date">
              {filterDate} <X className="w-3 h-3" />
            </Badge>
          )}
          {(filterSymbol || filterTag || filterDate) && (
            <Button variant="ghost" size="icon" onClick={() => { setFilterSymbol(""); setFilterTag(""); setFilterDate(""); }}
              data-testid="btn-clear-filters">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <Badge variant="secondary">{filtered.length} {t("journal.trades")}</Badge>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{t("journal.noEntries")}</p>
          </CardContent>
        </Card>
      ) : (
        <div>
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border mb-1">
            <button className="text-start hover:text-foreground" onClick={() => toggleSort("symbol")}
              data-testid="sort-symbol">
              {t("journal.symbol")} {sortField === "symbol" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            <span />
            <button className="text-end hover:text-foreground" onClick={() => toggleSort("pnl")}
              data-testid="sort-pnl">
              {t("journal.realizedPnl")} {sortField === "pnl" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            <button className="text-end hover:text-foreground" onClick={() => toggleSort("date")}
              data-testid="sort-date">
              {t("journal.closedAt")} {sortField === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
          </div>
          <div className="space-y-2">
            {paginatedEntries.map((entry) => (
              <motion.div key={entry.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="cursor-pointer hover:bg-secondary/30 transition-colors" onClick={() => onSelect(entry)}
                  data-testid={`card-journal-entry-${entry.id}`}>
                  <CardContent className="py-3 px-3 sm:px-4 flex items-start sm:items-center justify-between gap-2">
                    <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
                      <div className={`w-2 h-8 rounded-full flex-shrink-0 ${(entry.realizedPnl || 0) >= 0 ? "bg-emerald-500" : "bg-red-500"}`} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                          <span className="font-semibold text-sm">{entry.symbol}</span>
                          <Badge variant="outline" className="text-xs">{entry.side}</Badge>
                          <span className="text-xs text-muted-foreground">{entry.quantity} {t("journal.contracts")}</span>
                          <Badge variant="outline" className={`text-[9px] hidden sm:inline-flex ${entry.sourcePlatform && entry.sourcePlatform !== "manual" ? "border-cyan-500/30 text-cyan-500" : "border-neutral-500/30 text-neutral-400"}`} data-testid={`badge-source-${entry.id}`}>
                            {entry.sourcePlatform && entry.sourcePlatform !== "manual"
                              ? (entry.sourcePlatform === "tradovate" ? "Tradovate" : entry.sourcePlatform === "topstepx" ? "TopstepX" : t("account.sourceImported"))
                              : t("account.sourceManual")}
                          </Badge>
                          {entry.psychology?.moodBefore && (
                            <span className="text-sm" title={t(`journal.mood.${entry.psychology.moodBefore}`)}
                              data-testid={`mood-indicator-${entry.id}`}>
                              {MOOD_EMOJI[entry.psychology.moodBefore]}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {(entry.closedAt || entry.openedAt) ? new Date(entry.closedAt || entry.openedAt!).toLocaleDateString() : "—"}
                          {entry.autoTags && entry.autoTags.length > 0 && (
                            <span className="ms-2">
                              {entry.autoTags.map(tag => (
                                <Badge key={`auto-${tag}`} variant="outline" className="text-[10px] ms-1 border-amber-500/40 text-amber-400 bg-amber-500/10" data-testid={`badge-autotag-${entry.id}-${tag}`}>
                                  <span className="me-0.5">🤖</span>{tag}
                                </Badge>
                              ))}
                            </span>
                          )}
                          {entry.tags && entry.tags.length > 0 && (
                            <span className="ms-1">
                              {entry.tags.map(tag => (
                                <Badge key={tag} variant="secondary" className="text-[10px] ms-1">{tag}</Badge>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {entry.symbol && entry.openedAt && entry.closedAt && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                          onClick={(e) => { e.stopPropagation(); onViewChart(entry); }}
                          title={t("replay.viewChart")}
                          data-testid={`btn-view-chart-${entry.id}`}
                        >
                          <BarChart3 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <div className="text-end">
                      <p className={`font-bold text-sm ${(entry.realizedPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}
                        data-testid={`text-pnl-${entry.id}`}>
                        {formatPnl(entry.realizedPnl || 0, entry.accountId)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ${entry.entryPrice?.toFixed(2)} → ${entry.exitPrice?.toFixed(2)}
                      </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4" data-testid="pagination-controls">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={effectivePage <= 1}
                data-testid="btn-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                {effectivePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={effectivePage >= totalPages}
                data-testid="btn-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalyticsDashboard({ analytics, sessionAnalytics, displayMode, t }: { analytics?: Analytics; sessionAnalytics?: SessionAnalytics; displayMode: DisplayMode; t: any }) {
  const { formatCurrency } = useCurrency();
  if (!analytics) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  function fmtPnl(value: number): string {
    return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
  }

  const kpis = [
    { label: t("journal.winRate"), value: `${analytics.winRate.toFixed(1)}%`, icon: Target, color: "text-emerald-400" },
    { label: t("journal.totalPnl"), value: fmtPnl(analytics.totalPnl), icon: TrendingUp, color: analytics.totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: t("journal.profitFactor"), value: analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor.toFixed(2), icon: Award, color: "text-yellow-400" },
    { label: t("journal.totalTrades"), value: String(analytics.totalTrades), icon: Zap, color: "text-indigo-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="py-4 text-center">
              <kpi.icon className={`w-5 h-5 mx-auto mb-1 ${kpi.color}`} />
              <p className="text-2xl font-bold" data-testid={`text-kpi-${kpi.label}`}>{kpi.value}</p>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-1">{t("journal.avgWin")} / {t("journal.avgLoss")}</p>
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-400">{t("journal.avgWin")}: {formatCurrency(analytics.avgWin)}</span>
              <span className="text-red-400">{t("journal.avgLoss")}: -{formatCurrency(analytics.avgLoss)}</span>
            </div>
            <div className="flex gap-4 text-sm mt-1">
              <span className="text-emerald-400">{t("journal.bestTrade")}: {formatCurrency(analytics.bestTrade)}</span>
              <span className="text-red-400">{t("journal.worstTrade")}: {formatCurrency(analytics.worstTrade)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-1">{t("journal.winLoss")}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                <div className="bg-emerald-500 h-full" style={{ width: `${analytics.winRate}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{analytics.winners}W / {analytics.losers}L</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {analytics.equityCurve.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.equityCurve")}</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={analytics.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Area type="monotone" dataKey="equity" stroke="#6366f1" fill="rgba(99,102,241,0.2)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {analytics.totalTrades > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.pnlDistribution")}</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={(() => {
                const buckets = new Map<string, number>();
                const ranges = ["< -500", "-500 to -200", "-200 to -50", "-50 to 0", "0 to 50", "50 to 200", "200 to 500", "> 500"];
                ranges.forEach(r => buckets.set(r, 0));
                if (analytics.equityCurve.length > 1) {
                  for (let i = 1; i < analytics.equityCurve.length; i++) {
                    const diff = analytics.equityCurve[i].equity - analytics.equityCurve[i-1].equity;
                    if (diff < -500) buckets.set("< -500", (buckets.get("< -500") || 0) + 1);
                    else if (diff < -200) buckets.set("-500 to -200", (buckets.get("-500 to -200") || 0) + 1);
                    else if (diff < -50) buckets.set("-200 to -50", (buckets.get("-200 to -50") || 0) + 1);
                    else if (diff < 0) buckets.set("-50 to 0", (buckets.get("-50 to 0") || 0) + 1);
                    else if (diff < 50) buckets.set("0 to 50", (buckets.get("0 to 50") || 0) + 1);
                    else if (diff < 200) buckets.set("50 to 200", (buckets.get("50 to 200") || 0) + 1);
                    else if (diff < 500) buckets.set("200 to 500", (buckets.get("200 to 500") || 0) + 1);
                    else buckets.set("> 500", (buckets.get("> 500") || 0) + 1);
                  }
                }
                return ranges.map(r => ({ range: r, count: buckets.get(r) || 0 }));
              })()}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="range" tick={{ fontSize: 9 }} stroke="rgba(255,255,255,0.3)" interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {analytics.bySymbol.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm font-semibold mb-3">{t("journal.bySymbol")}</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.bySymbol}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="symbol" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                  <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <Bar dataKey="pnl" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {analytics.byWeekday.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm font-semibold mb-3">{t("journal.byWeekday")}</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.byWeekday.sort((a, b) => a.day - b.day).map(d => ({ ...d, name: WEEKDAY_NAMES[d.day] }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                  <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <Bar dataKey="pnl" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {analytics.byTag.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.byTag")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="py-2 text-start">{t("journal.tag")}</th>
                    <th className="py-2 text-end">{t("journal.tradeCount")}</th>
                    <th className="py-2 text-end">{t("journal.winRate")}</th>
                    <th className="py-2 text-end">{t("journal.totalPnl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.byTag.map((row) => (
                    <tr key={row.tag} className="border-b border-border/50">
                      <td className="py-2"><Badge variant="secondary">{row.tag}</Badge></td>
                      <td className="py-2 text-end">{row.count}</td>
                      <td className="py-2 text-end">{row.winRate.toFixed(1)}%</td>
                      <td className={`py-2 text-end font-medium ${row.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        ${row.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <SessionAnalysis sessionAnalytics={sessionAnalytics} t={t} />
    </div>
  );
}

const SESSION_LABELS: Record<string, { color: string; icon: string; hours: string }> = {
  asia: { color: "text-amber-400", icon: "🌏", hours: "18:00-02:00 EST" },
  europe: { color: "text-blue-400", icon: "🌍", hours: "02:00-08:00 EST" },
  us: { color: "text-emerald-400", icon: "🌎", hours: "08:00-16:00 EST" },
};

function SessionAnalysis({ sessionAnalytics, t }: { sessionAnalytics?: SessionAnalytics; t: any }) {
  const { formatCurrency } = useCurrency();

  if (!sessionAnalytics) return null;

  const totalTrades = sessionAnalytics.sessions.reduce((s, sess) => s + sess.trades, 0);
  if (totalTrades === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground" data-testid="text-session-no-data">{t("journal.sessionNoData")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("journal.sessionNoDataHint")}</p>
        </CardContent>
      </Card>
    );
  }

  const sessionNameMap: Record<string, string> = {
    asia: t("journal.sessionAsia"),
    europe: t("journal.sessionEurope"),
    us: t("journal.sessionUS"),
  };

  const maxAbsPnl = Math.max(
    ...sessionAnalytics.heatMapData.map(d => Math.abs(d.pnl)),
    1
  );

  const dayNames = WEEKDAY_NAMES;

  const comparisonData = sessionAnalytics.sessions.map(s => ({
    name: sessionNameMap[s.session] || s.session,
    trades: s.trades,
    totalPnl: s.totalPnl,
    avgPnl: s.avgPnl,
    winRate: s.winRate,
  }));

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold flex items-center gap-2">
        <Clock className="w-4 h-4 text-indigo-400" />
        {t("journal.sessionAnalysis")}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sessionAnalytics.sessions.map(s => {
          const meta = SESSION_LABELS[s.session] || SESSION_LABELS.us;
          return (
            <Card key={s.session} data-testid={`card-session-${s.session}`}>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{meta.icon}</span>
                  <div>
                    <p className={`text-sm font-semibold ${meta.color}`}>{sessionNameMap[s.session]}</p>
                    <p className="text-[10px] text-muted-foreground">{meta.hours}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t("journal.sessionTrades")}</p>
                    <p className="text-sm font-bold" data-testid={`text-session-trades-${s.session}`}>{s.trades}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t("journal.sessionWinRate")}</p>
                    <p className="text-sm font-bold" data-testid={`text-session-winrate-${s.session}`}>{s.winRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t("journal.sessionAvgPnl")}</p>
                    <p className={`text-sm font-bold ${s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`text-session-avgpnl-${s.session}`}>
                      {s.avgPnl >= 0 ? "+" : ""}{formatCurrency(s.avgPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t("journal.sessionTotalPnl")}</p>
                    <p className={`text-sm font-bold ${s.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`text-session-totalpnl-${s.session}`}>
                      {s.totalPnl >= 0 ? "+" : ""}{formatCurrency(s.totalPnl)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="py-4">
          <p className="text-sm font-semibold mb-3">{t("journal.sessionComparison")}</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
              <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
              <Tooltip
                contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }}
                formatter={(value: number, name: string) => {
                  if (name === "totalPnl") return [`$${value.toFixed(2)}`, t("journal.sessionTotalPnl")];
                  if (name === "avgPnl") return [`$${value.toFixed(2)}`, t("journal.sessionAvgPnl")];
                  if (name === "winRate") return [`${value.toFixed(1)}%`, t("journal.sessionWinRate")];
                  return [value, name];
                }}
              />
              <Bar dataKey="totalPnl" fill="#6366f1" radius={[4, 4, 0, 0]} name="totalPnl" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-sm font-semibold mb-1">{t("journal.sessionHeatMap")}</p>
          <p className="text-[10px] text-muted-foreground mb-3">{t("journal.sessionHeatMapDesc")}</p>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-[2px]">
                <div className="w-10" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center text-[9px] text-muted-foreground">{String(h).padStart(2, "0")}</div>
                ))}
                {dayNames.map((day, dayIdx) => (
                  <Fragment key={dayIdx}>
                    <div className="text-[10px] text-muted-foreground flex items-center w-10">{day}</div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = sessionAnalytics.heatMapData.find(c => c.day === dayIdx && c.hour === h);
                      const pnl = cell?.pnl || 0;
                      const intensity = maxAbsPnl > 0 ? Math.min(Math.abs(pnl) / maxAbsPnl, 1) : 0;
                      const bgStyle = pnl === 0
                        ? { backgroundColor: "rgba(255,255,255,0.03)" }
                        : pnl > 0
                          ? { backgroundColor: `rgba(16,185,129,${intensity * 0.7 + 0.1})` }
                          : { backgroundColor: `rgba(239,68,68,${intensity * 0.7 + 0.1})` };

                      return (
                        <div
                          key={`${dayIdx}-${h}`}
                          className="aspect-square rounded-sm flex items-center justify-center cursor-default"
                          style={bgStyle}
                          title={`${day} ${String(h).padStart(2, "0")}:00 — $${pnl.toFixed(2)}`}
                          data-testid={`heatmap-cell-${dayIdx}-${h}`}
                        >
                          {Math.abs(pnl) > 0 && (
                            <span className="text-[7px] font-medium text-white/80">
                              {pnl > 0 ? "+" : ""}{Math.round(pnl)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CalendarView({
  calendarDays, calendarMonth, setCalendarMonth, displayMode, onDayClick, t
}: {
  calendarDays: { date: number; pnl: number; trades: number; dateStr: string }[];
  calendarMonth: Date;
  setCalendarMonth: (d: Date) => void;
  displayMode: DisplayMode;
  onDayClick: (dateStr: string) => void;
  t: any;
}) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function prevMonth() {
    const d = new Date(calendarMonth);
    d.setMonth(d.getMonth() - 1);
    setCalendarMonth(d);
  }

  function nextMonth() {
    const d = new Date(calendarMonth);
    d.setMonth(d.getMonth() + 1);
    setCalendarMonth(d);
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="icon" onClick={prevMonth} data-testid="btn-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h3 className="text-lg font-semibold">
            {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
          </h3>
          <Button variant="ghost" size="icon" onClick={nextMonth} data-testid="btn-next-month">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {WEEKDAY_NAMES.map(d => (
            <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, i) => (
            <div
              key={i}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-colors ${
                day.date === 0 ? "" :
                day.trades === 0 ? "bg-secondary/20" :
                day.pnl > 0 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-pointer hover:ring-2 hover:ring-emerald-400/50" :
                day.pnl < 0 ? "bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:ring-2 hover:ring-red-400/50" :
                "bg-secondary/30 cursor-pointer hover:ring-2 hover:ring-muted-foreground/30"
              }`}
              data-testid={day.dateStr ? `cal-day-${day.dateStr}` : undefined}
              onClick={() => day.date > 0 && day.trades > 0 && onDayClick(day.dateStr)}
            >
              {day.date > 0 && (
                <>
                  <span className="font-medium">{day.date}</span>
                  {day.trades > 0 && (
                    <span className="text-[9px] mt-0.5">
                      {day.pnl >= 0 ? "+" : ""}{Math.round(day.pnl)}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RiskDashboard({ riskAnalytics, t }: { riskAnalytics?: RiskAnalytics; t: any }) {
  const { formatCurrency } = useCurrency();
  if (!riskAnalytics) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const ddColor = riskAnalytics.currentDrawdown > 15 ? "text-red-400" : riskAnalytics.currentDrawdown > 8 ? "text-yellow-400" : "text-emerald-400";
  const sharpeColor = riskAnalytics.sharpeRatio >= 1 ? "text-emerald-400" : riskAnalytics.sharpeRatio >= 0 ? "text-yellow-400" : "text-red-400";
  const rrColor = (riskAnalytics.riskRewardRatio || 0) >= 1.5 ? "text-emerald-400" : (riskAnalytics.riskRewardRatio || 0) >= 1 ? "text-yellow-400" : "text-red-400";

  const kpis = [
    { id: "max-drawdown", label: t("journal.riskMaxDD"), value: `${riskAnalytics.maxDrawdown.toFixed(2)}%`, icon: TrendingDown, color: "text-red-400" },
    { id: "current-drawdown", label: t("journal.riskCurrentDD"), value: `${riskAnalytics.currentDrawdown.toFixed(2)}%`, icon: AlertTriangle, color: ddColor },
    { id: "sharpe-ratio", label: t("journal.riskSharpe"), value: riskAnalytics.sharpeRatio.toFixed(2), icon: Target, color: sharpeColor },
    { id: "sortino-ratio", label: t("journal.riskSortino"), value: riskAnalytics.sortinoRatio.toFixed(2), icon: Shield, color: "text-indigo-400" },
    { id: "risk-reward", label: t("journal.riskRR"), value: riskAnalytics.riskRewardRatio !== null ? riskAnalytics.riskRewardRatio.toFixed(2) : "∞", icon: Award, color: rrColor },
  ];

  return (
    <div className="space-y-6">
      {(riskAnalytics.drawdownWarning || riskAnalytics.drawdownCritical) && (
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${riskAnalytics.drawdownCritical ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"}`} data-testid="risk-drawdown-alert">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">
              {riskAnalytics.drawdownCritical ? t("journal.riskDDCritical") : t("journal.riskDDWarning")}
            </p>
            <p className="text-xs opacity-80">
              {t("journal.riskDDCurrent")}: {riskAnalytics.currentDrawdown.toFixed(2)}% / {t("journal.riskDDLimit")}: {riskAnalytics.drawdownLimitPct?.toFixed(1)}%{riskAnalytics.drawdownLimitAbs ? ` (${formatCurrency(riskAnalytics.drawdownLimitAbs)})` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="py-4 text-center">
              <kpi.icon className={`w-5 h-5 mx-auto mb-1 ${kpi.color}`} />
              <p className="text-2xl font-bold" data-testid={`text-risk-${kpi.id}`}>{kpi.value}</p>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-1">{t("journal.riskAvgWinLoss")}</p>
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-400">{t("journal.avgWin")}: {formatCurrency(riskAnalytics.avgWin)}</span>
              <span className="text-red-400">{t("journal.avgLoss")}: -{formatCurrency(riskAnalytics.avgLoss)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-1">{t("journal.riskDailyStats")}</p>
            <div className="flex gap-4 text-sm">
              <span className="text-muted-foreground">{t("journal.riskTradingDays")}: {riskAnalytics.dailyReturns}</span>
              <span className="text-muted-foreground">{t("journal.riskDailyAvg")}: {formatCurrency(riskAnalytics.meanDailyReturn)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {riskAnalytics.drawdownCurve.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.riskDDChart")}</p>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={riskAnalytics.drawdownCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis yAxisId="equity" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis yAxisId="dd" orientation="right" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" reversed />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Area yAxisId="equity" type="monotone" dataKey="equity" stroke="#6366f1" fill="rgba(99,102,241,0.15)" name={t("journal.equityCurve")} />
                <Area yAxisId="dd" type="monotone" dataKey="drawdown" stroke="#ef4444" fill="rgba(239,68,68,0.15)" name={t("journal.riskDrawdown")} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {riskAnalytics.symbolExposure.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.riskExposure")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="py-2 text-start">{t("journal.symbol")}</th>
                    <th className="py-2 text-end">{t("journal.tradeCount")}</th>
                    <th className="py-2 text-end">{t("journal.riskExposurePct")}</th>
                    <th className="py-2 text-end">{t("journal.totalPnl")}</th>
                    <th className="py-2 text-end">{t("journal.riskAvgPnl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {riskAnalytics.symbolExposure.map((row) => (
                    <tr key={row.symbol} className="border-b border-border/50" data-testid={`row-exposure-${row.symbol}`}>
                      <td className="py-2 font-medium">{row.symbol}</td>
                      <td className="py-2 text-end">{row.tradeCount}</td>
                      <td className="py-2 text-end">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-secondary rounded-full h-2 overflow-hidden">
                            <div className="bg-indigo-500 h-full" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                          </div>
                          <span>{row.percentage.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className={`py-2 text-end font-medium ${row.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatCurrency(row.totalPnl)}
                      </td>
                      <td className={`py-2 text-end ${row.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatCurrency(row.avgPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {riskAnalytics.totalTrades === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{t("journal.riskNoData")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AlertsSection({ alerts, onMarkRead, onMarkAllRead, onOpenSettings, t }: {
  alerts: JournalAlertItem[];
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onOpenSettings: () => void;
  t: any;
}) {
  const unread = alerts.filter(a => !a.isRead);
  const read = alerts.filter(a => a.isRead);

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <ShieldAlert className="w-4 h-4 text-red-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      default: return <Bell className="w-4 h-4 text-blue-500" />;
    }
  };

  const severityBorder = (severity: string) => {
    switch (severity) {
      case "critical": return "border-red-500/30";
      case "warning": return "border-amber-500/30";
      default: return "border-blue-500/30";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium">{t("journal.alertsTitle")}</span>
          {unread.length > 0 && (
            <Badge variant="destructive" className="text-xs">{unread.length}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onMarkAllRead} data-testid="btn-mark-all-read">
              <CheckCircle className="w-3.5 h-3.5 me-1" />
              {t("journal.markAllRead")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onOpenSettings} data-testid="btn-alert-settings">
            <Settings2 className="w-3.5 h-3.5 me-1" />
            {t("journal.alertSettings")}
          </Button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Shield className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{t("journal.noAlerts")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...unread, ...read].map((alert) => (
            <Card
              key={alert.id}
              className={`transition-all ${!alert.isRead ? severityBorder(alert.severity) + " bg-secondary/20" : "opacity-60"}`}
            >
              <CardContent className="py-3 px-4 flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">{severityIcon(alert.severity)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(alert.createdAt).toLocaleString()}
                  </p>
                </div>
                {!alert.isRead && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => onMarkRead(alert.id)}
                    data-testid={`btn-mark-read-${alert.id}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PsychologyAnalytics({ psychAnalytics, t }: { psychAnalytics?: PsychAnalytics; t: any }) {
  if (!psychAnalytics) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {psychAnalytics.moodVsPnl.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.moodVsPnl")}</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={psychAnalytics.moodVsPnl.map(d => ({ ...d, label: `${MOOD_EMOJI[d.mood] || ""} ${t(`journal.mood.${d.mood}`)}` }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Bar dataKey="avgPnl" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {psychAnalytics.confidenceVsWinRate.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.confidenceVsWinRate")}</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={psychAnalytics.confidenceVsWinRate.sort((a, b) => a.confidence - b.confidence)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="confidence" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Bar dataKey="winRate" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-4">
          <p className="text-sm font-semibold mb-3">{t("journal.lessonsLearned")}</p>
          {psychAnalytics.recentLessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("journal.noLessons")}</p>
          ) : (
            <div className="space-y-3">
              {psychAnalytics.recentLessons.map((lesson, i) => (
                <div key={i} className="p-3 bg-secondary/20 rounded-lg">
                  <p className="text-sm">{lesson.lesson}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {lesson.date && <span>{new Date(lesson.date).toLocaleDateString()}</span>}
                    {lesson.pnl !== null && (
                      <span className={lesson.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {lesson.pnl >= 0 ? "+" : ""}${lesson.pnl.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {psychAnalytics.moodVsPnl.length === 0 && psychAnalytics.confidenceVsWinRate.length === 0 && psychAnalytics.recentLessons.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{t("journal.noPsychData")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("journal.noPsychDataHint")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BenchmarkDashboard({ benchmark, t, onSetGoals }: { benchmark?: BenchmarkData; t: any; onSetGoals: () => void }) {
  const { formatCurrency } = useCurrency();
  if (!benchmark) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  function fmtPnl(value: number): string {
    return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
  }

  function getDelta(current: number, previous: number): { value: number; positive: boolean } {
    const delta = current - previous;
    return { value: delta, positive: delta >= 0 };
  }

  const monthPnlDelta = getDelta(benchmark.currentMonth.pnl, benchmark.previousMonth.pnl);
  const monthTradesDelta = getDelta(benchmark.currentMonth.trades, benchmark.previousMonth.trades);
  const monthWinRateDelta = getDelta(benchmark.currentMonth.winRate, benchmark.previousMonth.winRate);

  const weekPnlDelta = getDelta(benchmark.currentWeek.pnl, benchmark.weeklyAverage.pnl);
  const weekTradesDelta = getDelta(benchmark.currentWeek.trades, benchmark.weeklyAverage.trades);
  const weekWinRateDelta = getDelta(benchmark.currentWeek.winRate, benchmark.weeklyAverage.winRate);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-indigo-400" />
          {t("journal.benchmarkTitle")}
        </h3>
        <Button variant="outline" size="sm" onClick={onSetGoals} data-testid="btn-set-goals">
          <Target className="w-4 h-4 me-1" />
          {t("journal.setGoals")}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.vsLastMonth")}</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.pnl")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{fmtPnl(benchmark.currentMonth.pnl)}</span>
                  <span className="text-xs text-muted-foreground">vs {fmtPnl(benchmark.previousMonth.pnl)}</span>
                  <Badge variant="outline" className={`text-[10px] ${monthPnlDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`} data-testid="badge-month-pnl-delta">
                    {monthPnlDelta.positive ? "↑" : "↓"} {formatCurrency(Math.abs(monthPnlDelta.value))}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.tradeCountLabel")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{benchmark.currentMonth.trades}</span>
                  <span className="text-xs text-muted-foreground">vs {benchmark.previousMonth.trades}</span>
                  <Badge variant="outline" className={`text-[10px] ${monthTradesDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                    {monthTradesDelta.positive ? "↑" : "↓"} {Math.abs(monthTradesDelta.value)}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.winRateLabel")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{benchmark.currentMonth.winRate.toFixed(1)}%</span>
                  <span className="text-xs text-muted-foreground">vs {benchmark.previousMonth.winRate.toFixed(1)}%</span>
                  <Badge variant="outline" className={`text-[10px] ${monthWinRateDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                    {monthWinRateDelta.positive ? "↑" : "↓"} {Math.abs(monthWinRateDelta.value).toFixed(1)}%
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold mb-3">{t("journal.vsWeeklyAvg")}</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.pnl")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{fmtPnl(benchmark.currentWeek.pnl)}</span>
                  <span className="text-xs text-muted-foreground">vs {fmtPnl(benchmark.weeklyAverage.pnl)}</span>
                  <Badge variant="outline" className={`text-[10px] ${weekPnlDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`} data-testid="badge-week-pnl-delta">
                    {weekPnlDelta.positive ? "↑" : "↓"} {formatCurrency(Math.abs(weekPnlDelta.value))}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.tradeCountLabel")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{benchmark.currentWeek.trades}</span>
                  <span className="text-xs text-muted-foreground">vs {benchmark.weeklyAverage.trades.toFixed(0)}</span>
                  <Badge variant="outline" className={`text-[10px] ${weekTradesDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                    {weekTradesDelta.positive ? "↑" : "↓"} {Math.abs(weekTradesDelta.value).toFixed(0)}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("journal.winRateLabel")}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{benchmark.currentWeek.winRate.toFixed(1)}%</span>
                  <span className="text-xs text-muted-foreground">vs {benchmark.weeklyAverage.winRate.toFixed(1)}%</span>
                  <Badge variant="outline" className={`text-[10px] ${weekWinRateDelta.positive ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                    {weekWinRateDelta.positive ? "↑" : "↓"} {Math.abs(weekWinRateDelta.value).toFixed(1)}%
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {benchmark.goals ? (
        <div className="space-y-4">
          {benchmark.goals.monthlyPnlTarget && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">{t("journal.monthlyProgress")}</p>
                  <span className="text-xs text-muted-foreground">
                    {fmtPnl(benchmark.currentMonth.pnl)} / {formatCurrency(benchmark.goals.monthlyPnlTarget)} {t("journal.ofTarget")}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      benchmark.currentMonth.pnl >= benchmark.goals.monthlyPnlTarget ? "bg-emerald-500" :
                      benchmark.currentMonth.pnl >= 0 ? "bg-indigo-500" : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(Math.max((benchmark.currentMonth.pnl / benchmark.goals.monthlyPnlTarget) * 100, 0), 100)}%` }}
                    data-testid="progress-monthly"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-end">
                  {Math.round((benchmark.currentMonth.pnl / benchmark.goals.monthlyPnlTarget) * 100)}%
                </p>
              </CardContent>
            </Card>
          )}
          {benchmark.goals.yearlyPnlTarget && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">{t("journal.yearlyProgress")}</p>
                  <span className="text-xs text-muted-foreground">
                    {fmtPnl(benchmark.yearPnl)} / {formatCurrency(benchmark.goals.yearlyPnlTarget)} {t("journal.ofTarget")}
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      benchmark.yearPnl >= benchmark.goals.yearlyPnlTarget ? "bg-emerald-500" :
                      benchmark.yearPnl >= 0 ? "bg-indigo-500" : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(Math.max((benchmark.yearPnl / benchmark.goals.yearlyPnlTarget) * 100, 0), 100)}%` }}
                    data-testid="progress-yearly"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-end">
                  {Math.round((benchmark.yearPnl / benchmark.goals.yearlyPnlTarget) * 100)}%
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Target className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("journal.noGoalsSet")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onSetGoals} data-testid="btn-set-goals-empty">
              <Target className="w-4 h-4 me-1" />
              {t("journal.setGoals")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AlertSettingsDialog({ open, onOpenChange, settings, onSave, saving, t }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings?: AlertSettings;
  onSave: (data: Partial<AlertSettings>) => void;
  saving: boolean;
  t: any;
}) {
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState("3");
  const [winRateDropThreshold, setWinRateDropThreshold] = useState("10");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (settings && open) {
      setMaxDailyLoss(settings.maxDailyLoss ? String(settings.maxDailyLoss) : "");
      setMaxConsecutiveLosses(String(settings.maxConsecutiveLosses ?? 3));
      setWinRateDropThreshold(String(settings.winRateDropThreshold ?? 10));
      setEnabled(settings.enabled ?? true);
    }
  }, [settings, open]);

  const handleSave = () => {
    onSave({
      maxDailyLoss: maxDailyLoss ? parseFloat(maxDailyLoss) : null,
      maxConsecutiveLosses: parseInt(maxConsecutiveLosses) || 3,
      winRateDropThreshold: parseFloat(winRateDropThreshold) || 10,
      enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-amber-400" />
            {t("journal.alertSettings")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("journal.alertSettingsDesc")}</p>
        <div className="space-y-4">
          <div>
            <Label>{t("journal.maxDailyLoss")}</Label>
            <Input
              type="number"
              placeholder={t("journal.maxDailyLossPlaceholder")}
              value={maxDailyLoss}
              onChange={(e) => setMaxDailyLoss(e.target.value)}
              data-testid="input-max-daily-loss"
            />
          </div>
          <div>
            <Label>{t("journal.maxConsecutiveLosses")}</Label>
            <Input
              type="number"
              min="1"
              value={maxConsecutiveLosses}
              onChange={(e) => setMaxConsecutiveLosses(e.target.value)}
              data-testid="input-max-consecutive-losses"
            />
          </div>
          <div>
            <Label>{t("journal.winRateDropThreshold")}</Label>
            <Input
              type="number"
              min="1"
              max="100"
              value={winRateDropThreshold}
              onChange={(e) => setWinRateDropThreshold(e.target.value)}
              data-testid="input-win-rate-drop"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-indigo-600" : "bg-gray-600"}`}
              data-testid="toggle-alerts-enabled"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <Label>{t("journal.alertsEnabled")}</Label>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1" data-testid="btn-cancel-alert-settings">
              {t("journal.save") === "Save" ? "Cancel" : t("copyTrading.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1" data-testid="btn-save-alert-settings">
              {saving && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
              {t("journal.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function ReplayTradeSelector({ entries, onSelect, t }: {
  entries: JournalEntry[];
  onSelect: (entry: JournalEntry) => void;
  t: any;
}) {
  const { formatCurrency } = useCurrency();
  const chartEligible = entries.filter(e => e.symbol && e.openedAt && e.closedAt);

  if (chartEligible.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("replay.chartUnavailable")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("replay.noMarketData")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("replay.selectTradeForChart")}</p>
      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
        {chartEligible.slice(0, 50).map((entry) => (
          <Card
            key={entry.id}
            className="cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => onSelect(entry)}
            data-testid={`card-chart-select-${entry.id}`}
          >
            <CardContent className="py-2.5 px-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-1.5 h-7 rounded-full flex-shrink-0 ${(entry.realizedPnl || 0) >= 0 ? "bg-emerald-500" : "bg-red-500"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{entry.symbol}</span>
                    <Badge variant="outline" className="text-[10px]">{entry.side}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.openedAt ? new Date(entry.openedAt).toLocaleString() : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold ${(entry.realizedPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {(entry.realizedPnl || 0) >= 0 ? "+" : ""}{formatCurrency(entry.realizedPnl || 0)}
                </span>
                <BarChart3 className="w-4 h-4 text-indigo-400" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FeaturesSuggestions({ t, onClose, navigate }: { t: any; onClose: () => void; navigate: (path: string) => void }) {
  const features = [
    {
      icon: Bell,
      color: "text-amber-400 bg-amber-500/10",
      title: t("journal.feat.alertsTitle"),
      desc: t("journal.feat.alertsDesc"),
      tag: t("journal.feat.tagSmart"),
    },
    {
      icon: Share2,
      color: "text-cyan-400 bg-cyan-500/10",
      title: t("journal.feat.shareTitle"),
      desc: t("journal.feat.shareDesc"),
      tag: t("journal.feat.tagSocial"),
    },
    {
      icon: PieChart,
      color: "text-purple-400 bg-purple-500/10",
      title: t("journal.feat.riskTitle"),
      desc: t("journal.feat.riskDesc"),
      tag: t("journal.feat.tagAnalytics"),
    },
    {
      icon: Clock,
      color: "text-emerald-400 bg-emerald-500/10",
      title: t("journal.feat.sessionTitle"),
      desc: t("journal.feat.sessionDesc"),
      tag: t("journal.feat.tagAnalytics"),
    },
    {
      icon: Eye,
      color: "text-indigo-400 bg-indigo-500/10",
      title: t("journal.feat.replayTitle"),
      desc: t("journal.feat.replayDesc"),
      tag: t("journal.feat.tagPro"),
    },
    {
      icon: Lightbulb,
      color: "text-yellow-400 bg-yellow-500/10",
      title: t("journal.feat.aiTitle"),
      desc: t("journal.feat.aiDesc"),
      tag: t("journal.feat.tagAI"),
    },
    {
      icon: Tag,
      color: "text-rose-400 bg-rose-500/10",
      title: t("journal.feat.autoTagTitle"),
      desc: t("journal.feat.autoTagDesc"),
      tag: t("journal.feat.tagSmart"),
    },
    {
      icon: BarChart2,
      color: "text-teal-400 bg-teal-500/10",
      title: t("journal.feat.benchmarkTitle"),
      desc: t("journal.feat.benchmarkDesc"),
      tag: t("journal.feat.tagAnalytics"),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("journal.feat.intro")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {features.map((feat, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <div className="rounded-xl border border-border/50 p-4 hover:border-indigo-500/30 transition-all hover:shadow-lg hover:shadow-indigo-500/5 group">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${feat.color}`}>
                  <feat.icon className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold group-hover:text-indigo-400 transition-colors">{feat.title}</h4>
                    <Badge variant="outline" className="text-[9px] border-border/50">{feat.tag}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feat.desc}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" size="sm" onClick={() => { onClose(); navigate("/integrations"); }} data-testid="btn-feat-integrations">
          <Link2 className="w-4 h-4 me-1" />
          {t("journal.feat.goIntegrations")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { onClose(); navigate("/billing"); }} data-testid="btn-feat-upgrade">
          <Sparkles className="w-4 h-4 me-1" />
          {t("journal.feat.upgrade")}
        </Button>
      </div>
    </div>
  );
}
