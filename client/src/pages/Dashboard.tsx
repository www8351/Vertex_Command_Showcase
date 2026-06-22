import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import {
  Activity, Briefcase, Plus, TrendingUp, CreditCard, Building,
  ChevronDown, ChevronUp, Filter, Trophy, Target, Medal, Award,
  ArrowUpRight, Wallet, BarChart3, Settings, Bell, Search,
  Crosshair, ShieldAlert, Moon, Sun, Trash2, Loader2, Pencil,
  AlertTriangle, ArrowDownRight, CheckCircle2, XCircle, Clock,
  Download, TrendingDown, Eye, EyeOff, Zap, CalendarDays, LogOut, FileText,
  Plug, Crown, Shield, ShieldCheck, HelpCircle, Globe, Copy, Menu, X, Timer, Lock, RefreshCw, Gift, Handshake,
  LayoutDashboard, RotateCcw, ChevronLeft, ChevronRight, HeartPulse, SlidersHorizontal, Star, BookOpen,
  Coins, Droplet, LineChart, BarChart2, Building2, Bitcoin, Cpu, Fuel, CandlestickChart, Landmark
} from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableWidget } from "@/components/SortableWidget";
import { WebhookSettings } from "@/components/WebhookSettings";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import TradeCalendar from "@/components/TradeCalendar";
import { useWidgetLayout, type WidgetId } from "@/hooks/useWidgetLayout";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, PieChart, Pie, Cell, ReferenceLine, CartesianGrid
} from "recharts";
import type {
  Account as DbAccount, Withdrawal as DbWithdrawal, Firm, Alert, MonthlyReport, FirmTier,
} from "@shared/schema";
import { AddWithdrawalDialog } from "@/components/AccountDialogs";
import { BrokerConnectDialog } from "@/components/BrokerConnectDialog";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { isRTL, getDateLocale } from "@/i18n";
import { useTradingStream } from "@/hooks/useTradingStream";
import { EquityCurveChart } from "@/components/EquityCurveChart";
import { DrawdownEvaluatorWidget } from "@/pages/DrawdownEvaluator";
import { useTheme, ACCENT_PRESETS, type ThemeMode, type AccentColor } from "@/hooks/useTheme";
import { apiUrl } from "@/lib/apiBase";



const GoldBarIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gcGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#fef3c7" />
        <stop offset="0.5" stopColor="#fbbf24" />
        <stop offset="1" stopColor="#b45309" />
      </linearGradient>
    </defs>
    <path d="M4 17l3-2.2h10L20 17v3H4z" fill="url(#gcGrad)" stroke="#7c2d12" strokeWidth="0.5" strokeLinejoin="round" />
    <path d="M6 13.8l2.5-1.8h7L18 13.8v1.5H6z" fill="url(#gcGrad)" stroke="#7c2d12" strokeWidth="0.5" />
    <path d="M8 11l2-1.5h4L16 11v1.2H8z" fill="url(#gcGrad)" stroke="#7c2d12" strokeWidth="0.5" />
    <path d="M5 17.5h14M7 14.3h10M9 11.5h6" stroke="#fff7e6" strokeWidth="0.4" opacity="0.7" />
  </svg>
);

const OilBarrelIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="clGrad" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#1a1a2e" />
        <stop offset="0.5" stopColor="#374151" />
        <stop offset="1" stopColor="#1a1a2e" />
      </linearGradient>
    </defs>
    <ellipse cx="12" cy="4.5" rx="6" ry="1.6" fill="#52525b" stroke="#27272a" strokeWidth="0.4" />
    <path d="M6 4.5v15c0 1 2.7 1.8 6 1.8s6-.8 6-1.8v-15" fill="url(#clGrad)" stroke="#0f172a" strokeWidth="0.5" />
    <ellipse cx="12" cy="4.5" rx="6" ry="1.6" fill="#3f3f46" />
    <path d="M6 9c2 .8 4 1.1 6 1.1s4-.3 6-1.1M6 14.5c2 .8 4 1.1 6 1.1s4-.3 6-1.1" stroke="#fbbf24" strokeWidth="0.6" opacity="0.85" fill="none" />
    <text x="12" y="13.6" textAnchor="middle" fontSize="3.2" fill="#fbbf24" fontWeight="900" fontFamily="sans-serif">OIL</text>
  </svg>
);

const NasdaqIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="nqGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#67e8f9" />
        <stop offset="1" stopColor="#0e7490" />
      </linearGradient>
    </defs>
    <rect x="5" y="5" width="14" height="14" rx="2" fill="url(#nqGrad)" stroke="#155e75" strokeWidth="0.6" />
    <path d="M2 9h3M2 12h3M2 15h3M19 9h3M19 12h3M19 15h3M9 2v3M12 2v3M15 2v3M9 19v3M12 19v3M15 19v3" stroke="#67e8f9" strokeWidth="0.8" />
    <text x="12" y="14.5" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="900" fontFamily="sans-serif">N</text>
  </svg>
);

const SP500Icon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="14" width="3.2" height="7" rx="0.6" fill="#a7f3d0" />
    <rect x="7.7" y="10" width="3.2" height="11" rx="0.6" fill="#6ee7b7" />
    <rect x="12.4" y="6" width="3.2" height="15" rx="0.6" fill="#34d399" />
    <rect x="17.1" y="3" width="3.2" height="18" rx="0.6" fill="#10b981" />
    <path d="M3 12.5L8 9L13.5 11.5L21 4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="21" cy="4" r="1.4" fill="#fff" />
  </svg>
);

const DowIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ymGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#c4b5fd" />
        <stop offset="1" stopColor="#5b21b6" />
      </linearGradient>
    </defs>
    <path d="M2 21V11l4.5-2.5L11 11v10z" fill="url(#ymGrad)" stroke="#3b0764" strokeWidth="0.5" />
    <path d="M11 21V7l5.5-3L22 7v14z" fill="url(#ymGrad)" stroke="#3b0764" strokeWidth="0.5" opacity="0.92" />
    <rect x="3.5" y="13" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="6" y="13" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="8.5" y="13" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="3.5" y="16" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="6" y="16" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="8.5" y="16" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="13" y="9" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="15.5" y="9" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="18" y="9" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="13" y="12" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="15.5" y="12" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="18" y="12" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="13" y="15" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="15.5" y="15" width="1.5" height="1.6" fill="#1e1b4b" />
    <rect x="18" y="15" width="1.5" height="1.6" fill="#1e1b4b" />
  </svg>
);

const BitcoinIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="btcGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#fdba74" />
        <stop offset="1" stopColor="#c2410c" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#btcGrad)" stroke="#7c2d12" strokeWidth="0.5" />
    <path d="M9 6.5v11M11 6.5v11M9.2 8.5h4.5c1.4 0 2.6 1 2.6 2.4 0 1.3-1.2 2.4-2.6 2.4M9.2 13.3h5c1.5 0 2.7 1.1 2.7 2.4s-1.2 2.4-2.7 2.4H9.2M10.5 5v2M14 5v2M10.5 17v2M14 17v2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

interface InstrumentTheme {
  symbol: string;
  display: string;
  name: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  indicatorColor: string;
  basePrice: number;
  gradientFrom: string;
  gradientTo: string;
  glow: string;
}

const HOME_INSTRUMENTS: InstrumentTheme[] = [
  { symbol: "GC",  display: "GC1!",  name: "Gold",       Icon: Coins,             iconClass: "", indicatorColor: "#fbbf24", basePrice: 4719.90,  gradientFrom: "#fbbf24", gradientTo: "#7c2d12", glow: "#f59e0b" },
  { symbol: "ES",  display: "ES1!",  name: "S&P 500",    Icon: CandlestickChart,  iconClass: "", indicatorColor: "#34d399", basePrice: 6936.25,  gradientFrom: "#34d399", gradientTo: "#065f46", glow: "#10b981" },
  { symbol: "NQ",  display: "NQ1!",  name: "Nasdaq-100", Icon: Cpu,               iconClass: "", indicatorColor: "#22d3ee", basePrice: 25638.75, gradientFrom: "#22d3ee", gradientTo: "#155e75", glow: "#06b6d4" },
  { symbol: "YM",  display: "YM1!",  name: "Dow Jones",  Icon: Landmark,          iconClass: "", indicatorColor: "#a78bfa", basePrice: 48498.00, gradientFrom: "#a78bfa", gradientTo: "#4c1d95", glow: "#8b5cf6" },
  { symbol: "CL",  display: "CL1!",  name: "Crude Oil",  Icon: Fuel,              iconClass: "", indicatorColor: "#fb923c", basePrice: 96.77,    gradientFrom: "#fb923c", gradientTo: "#431407", glow: "#ea580c" },
  { symbol: "BTC", display: "BTC1!", name: "Bitcoin",    Icon: Bitcoin,           iconClass: "", indicatorColor: "#f97316", basePrice: 95000,    gradientFrom: "#fb923c", gradientTo: "#7c2d12", glow: "#f97316" },
];

const HOME_FIRMS = [
  { name: "Tradeify", rating: 4.7, maxFunding: "$750K", profitSplit: "90%", trueCost: "$120", tags: ["Instant funding", "Automated payouts"] },
  { name: "Lucid Trading", rating: 4.8, maxFunding: "$600K", profitSplit: "90%", trueCost: "$100", tags: ["End of day drawdowns", "No hard breach rules"] },
  { name: "Apex Trader Funding", rating: 4.5, maxFunding: "$6.0M", profitSplit: "100%", trueCost: "$100", tags: ["No daily drawdown", "Trade any time"] },
];

interface MarketQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  stale?: boolean;
}

function useLiveMarketPrices() {
  const symbols = HOME_INSTRUMENTS.map(i => i.symbol).join(",");
  const { data } = useQuery<{ quotes: MarketQuote[]; fetchedAt: number; delayMinutes: number }>({
    queryKey: ["/api/v1/market/quotes", symbols],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/market/quotes?symbols=${symbols}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load market quotes");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const bySymbol = new Map((data?.quotes || []).map(q => [q.symbol.toUpperCase(), q] as const));
    return HOME_INSTRUMENTS.map(inst => {
      const q = bySymbol.get(inst.symbol);
      return {
        ...inst,
        price: q?.price ?? inst.basePrice,
        change: q?.change ?? 0,
        changePercent: q?.changePercent ?? 0,
        stale: !!q?.stale,
      };
    });
  }, [data]);
}

type AccountStage = 'phase1' | 'phase2' | 'evaluation_1' | 'evaluation_2' | 'funded' | 'payout' | 'LIVE';

const STAGE_KEYS: AccountStage[] = ['evaluation_1', 'evaluation_2', 'funded', 'LIVE'];

const LIVE_STAGE_BADGE = 'bg-gradient-to-r from-amber-400/25 to-amber-500/30 text-amber-700 dark:text-amber-200 border-amber-400/60 font-extrabold tracking-widest shadow-md shadow-amber-400/30';

const STAGE_INFO: Record<AccountStage, { badgeClass: string; dotClass: string; icon: any }> = {
  evaluation_1: { badgeClass: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20', dotClass: 'bg-zinc-400', icon: Target },
  phase1: { badgeClass: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20', dotClass: 'bg-zinc-400', icon: Target },
  evaluation_2: { badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', dotClass: 'bg-blue-400', icon: Medal },
  phase2: { badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', dotClass: 'bg-blue-400', icon: Medal },
  funded: { badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', dotClass: 'bg-amber-400', icon: Trophy },
  payout: { badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', dotClass: 'bg-emerald-400', icon: Award },
  LIVE: { badgeClass: LIVE_STAGE_BADGE, dotClass: 'bg-amber-400', icon: Zap },
};

function isLiveAccount(account: { stage?: string | null; accountType?: string | null }): boolean {
  const stage = (account.stage || '').toUpperCase();
  const type = (account.accountType || '').toUpperCase();
  return stage === 'LIVE' || type === 'LIVE';
}

const STATUS_KEYS = ['healthy', 'buffer_building', 'near_target', 'ready_to_withdraw', 'passed', 'consistency_risk', 'drawdown_risk', 'violated', 'inactive', 'sync_failed'];
const FAILED_STATUSES = ['violated', 'sync_failed', 'inactive'];
const PASSED_STATUSES = ['passed'];

const STATUS_INFO: Record<string, { color: string; icon: any }> = {
  healthy: { color: 'text-emerald-500', icon: CheckCircle2 },
  buffer_building: { color: 'text-blue-500', icon: TrendingUp },
  near_target: { color: 'text-amber-500', icon: Target },
  ready_to_withdraw: { color: 'text-emerald-400', icon: Award },
  passed: { color: 'text-emerald-500', icon: Trophy },
  consistency_risk: { color: 'text-orange-500', icon: AlertTriangle },
  drawdown_risk: { color: 'text-red-500', icon: ShieldAlert },
  violated: { color: 'text-red-600', icon: XCircle },
  inactive: { color: 'text-zinc-400', icon: Clock },
  sync_failed: { color: 'text-red-600', icon: XCircle },
};

const RECOMMENDATION_INFO: Record<string, { color: string; bg: string }> = {
  trade: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  ready_to_withdraw: { color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  light_trading: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  avoid: { color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  do_not_trade: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
};

type ColumnId = 'account' | 'stage' | 'status' | 'size' | 'pnl' | 'target' | 'tradingDays';

const ALL_COLUMNS: ColumnId[] = ['account', 'stage', 'status', 'size', 'pnl', 'target', 'tradingDays'];
const DEFAULT_COLUMNS: ColumnId[] = ['account', 'stage', 'status', 'size', 'pnl', 'target'];
const ALWAYS_VISIBLE: ColumnId[] = ['account'];

const DEFAULT_COL_WIDTHS: Record<ColumnId, number> = {
  account: 180, stage: 100, status: 100, size: 120, pnl: 130,
  target: 140, tradingDays: 100,
};

function getColumnLabel(col: ColumnId, t: any): string {
  const map: Record<ColumnId, string> = {
    account: t('dashboard.account'),
    stage: t('dashboard.stage'),
    status: t('dashboard.statusLabel'),
    size: t('dashboard.balance'),
    pnl: t('dashboard.pnl'),
    target: t('dashboard.target'),
    tradingDays: t('dashboard.tradingDays'),
  };
  return map[col] || col;
}

function DraggableColumnHeader({ col, label, width, onResize, onDragStart, onDragOver, onDrop, dragOverCol }: {
  col: ColumnId; label: string; width: number; onResize: (col: ColumnId, delta: number) => void;
  onDragStart: (col: ColumnId) => void; onDragOver: (e: React.DragEvent, col: ColumnId) => void;
  onDrop: (col: ColumnId) => void; dragOverCol: ColumnId | null;
}) {
  const resizeRef = useRef<{ startX: number } | null>(null);
  const isRtl = document.documentElement.dir === 'rtl';

  const startResize = useCallback((clientX: number) => {
    resizeRef.current = { startX: clientX };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!resizeRef.current) return;
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const rawDelta = cx - resizeRef.current.startX;
      const delta = isRtl ? -rawDelta : rawDelta;
      onResize(col, delta);
      resizeRef.current.startX = cx;
    };
    const onEnd = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
  }, [col, onResize, isRtl]);

  return (
    <th
      draggable
      onDragStart={() => onDragStart(col)}
      onDragOver={e => onDragOver(e, col)}
      onDrop={() => onDrop(col)}
      style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px`, position: 'relative', userSelect: 'none' }}
      className={`px-3 py-2.5 font-medium whitespace-nowrap text-center cursor-grab active:cursor-grabbing border-x border-border/40 ${dragOverCol === col ? 'bg-indigo-500/10' : ''}`}
    >
      <span className="truncate">{label}</span>
      <div
        className="absolute top-0 ltr:right-0 rtl:left-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
        draggable={false}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startResize(e.clientX); }}
        onTouchStart={e => { e.stopPropagation(); startResize(e.touches[0].clientX); }}
      />
    </th>
  );
}

interface EnrichedAccount extends DbAccount {
  profit: number;
  computedStatus?: string;
}

interface TradingPriority {
  id: number; accountId: string; name: string; firm: string; stage: string;
  profit: number; distanceToTarget: number; consistencyRisk: number;
  drawdownRisk: number; score: number; recommendation: string;
}

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function SettingsPage({ firmsList, handleExport, createFirmMutation, updateFirmMutation, deleteFirmMutation, createTierMutation, updateTierMutation, deleteTierMutation }: {
  firmsList: (Firm & { tiers: FirmTier[] })[];
  handleExport: (type: string) => void;
  createFirmMutation: any; updateFirmMutation: any; deleteFirmMutation: any;
  createTierMutation: any; updateTierMutation: any; deleteTierMutation: any;
}) {
  const { t } = useTranslation();
  const isDemo = useIsDemo();
  const { mode, setMode, resolvedTheme, accent, setAccent } = useTheme();
  const [expandedFirm, setExpandedFirm] = useState<number | null>(null);
  const [isAddFirmOpen, setIsAddFirmOpen] = useState(false);
  const [editingFirm, setEditingFirm] = useState<Firm | null>(null);
  const [isAddTierOpen, setIsAddTierOpen] = useState<number | null>(null);
  const [editingTier, setEditingTier] = useState<{ tier: FirmTier; firmId: number } | null>(null);

  const [formName, setFormName] = useState("");
  const [formMinDays, setFormMinDays] = useState("0");
  const [formConsistency, setFormConsistency] = useState("30");
  const [formDailyDD, setFormDailyDD] = useState("");
  const [formTotalDD, setFormTotalDD] = useState("");
  const [formWaitDays, setFormWaitDays] = useState("0");
  const [formWithdrawalStage, setFormWithdrawalStage] = useState("funded");
  const [formBufferBefore, setFormBufferBefore] = useState(true);

  const resetForm = () => {
    setFormName(""); setFormMinDays("0"); setFormConsistency("30");
    setFormDailyDD(""); setFormTotalDD(""); setFormWaitDays("0");
    setFormWithdrawalStage("funded"); setFormBufferBefore(true);
  };

  const loadFirmToForm = (firm: Firm) => {
    setFormName(firm.name);
    setFormMinDays(String(firm.minTradingDays || 0));
    setFormConsistency(String(firm.consistencyPercentage || 30));
    setFormDailyDD(firm.dailyDrawdown != null ? String(firm.dailyDrawdown) : "");
    setFormTotalDD(firm.totalDrawdown != null ? String(firm.totalDrawdown) : "");
    setFormWaitDays(String(firm.withdrawalWaitDays || 0));
    setFormWithdrawalStage(firm.withdrawalAllowedStage || "funded");
    setFormBufferBefore(firm.bufferBeforeTarget !== false);
  };

  const loadTierToForm = (tier: FirmTier) => {
    setFormName(tier.name);
    setFormMinDays(String(tier.minTradingDays || 0));
    setFormConsistency(String(tier.consistencyPercentage || 30));
    setFormDailyDD(tier.dailyDrawdown != null ? String(tier.dailyDrawdown) : "");
    setFormTotalDD(tier.totalDrawdown != null ? String(tier.totalDrawdown) : "");
    setFormWaitDays(String(tier.withdrawalWaitDays || 0));
    setFormWithdrawalStage(tier.withdrawalAllowedStage || "funded");
    setFormBufferBefore(tier.bufferBeforeTarget !== false);
  };

  const getFormData = () => ({
    name: formName,
    minTradingDays: parseInt(formMinDays) || 0,
    consistencyPercentage: parseFloat(formConsistency) || 30,
    dailyDrawdown: formDailyDD ? parseFloat(formDailyDD) : null,
    totalDrawdown: formTotalDD ? parseFloat(formTotalDD) : null,
    withdrawalWaitDays: parseInt(formWaitDays) || 0,
    withdrawalAllowedStage: formWithdrawalStage,
    bufferBeforeTarget: formBufferBefore,
  });

  const ruleFormFields = (showName = true) => (
    <div className="space-y-3">
      {showName && (
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.name')}</Label>
          <Input value={formName} onChange={e => setFormName(e.target.value)} className="bg-secondary/50 border-border text-sm h-9" dir="ltr" data-testid="input-firm-name" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.minTradingDays')}</Label>
          <Input type="number" value={formMinDays} onChange={e => setFormMinDays(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.consistency')}</Label>
          <Input type="number" value={formConsistency} onChange={e => setFormConsistency(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.dailyDD')}</Label>
          <Input type="number" value={formDailyDD} onChange={e => setFormDailyDD(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.maxDD')}</Label>
          <Input type="number" value={formTotalDD} onChange={e => setFormTotalDD(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.waitDays')}</Label>
          <Input type="number" value={formWaitDays} onChange={e => setFormWaitDays(e.target.value)} className="bg-secondary/50 border-border text-sm h-9 font-mono text-left" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('settings.withdrawalStage')}</Label>
          <Select value={formWithdrawalStage} onValueChange={setFormWithdrawalStage}>
            <SelectTrigger className="bg-secondary/50 border-border text-sm h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="funded">{t('phases.funded')}</SelectItem>
              <SelectItem value="payout">{t('phases.payout')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={formBufferBefore} onChange={e => setFormBufferBefore(e.target.checked)} className="rounded" />
        <span className="text-muted-foreground">{t('settings.bufferBeforeTarget')}</span>
      </label>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-500" /> {t('nav.settings')}</h2>

      <div className="bg-card p-5 rounded-lg border border-border">
        <h3 className="text-sm font-semibold mb-3">{t('settings.theme')}</h3>
        <div className="flex gap-3 mb-5">
          {(["dark", "light", "system"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${mode === m ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-secondary'}`}
              data-testid={`button-theme-${m}`}
            >
              {t(`settings.${m}`)}
            </button>
          ))}
        </div>
        <h3 className="text-sm font-semibold mb-3">{t('settings.accentColor')}</h3>
        <div className="flex flex-wrap gap-3">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => setAccent(preset)}
              className={`w-9 h-9 rounded-full border-2 transition-all flex items-center justify-center ${accent.name === preset.name ? 'border-foreground scale-110 ring-2 ring-offset-2 ring-offset-card' : 'border-transparent hover:scale-105'}`}
              style={{ backgroundColor: `hsl(${preset.hue}, ${preset.saturation}%, 48%)` }}
              title={t(`settings.accents.${preset.name}`)}
              data-testid={`button-accent-${preset.name}`}
            >
              {accent.name === preset.name && (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      <WebhookSettings />

      <Dialog open={isAddFirmOpen} onOpenChange={o => { if (!o) { resetForm(); } setIsAddFirmOpen(o); }}>
        <DialogContent className="sm:max-w-[460px] bg-card border-border p-0 overflow-hidden max-h-[85vh] overflow-y-auto" onOpenAutoFocus={e => e.preventDefault()}>
          <div className="p-5">
            <DialogHeader className="mb-4 text-right">
              <DialogTitle className="text-base font-semibold flex items-center gap-2"><Building className="w-4 h-4 text-indigo-500" /> {t('settings.newFirm')}</DialogTitle>
            </DialogHeader>
            {ruleFormFields()}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="ghost" size="sm" onClick={() => setIsAddFirmOpen(false)} className="h-8 text-xs">{t('common.cancel')}</Button>
              <Button size="sm" disabled={isDemo} onClick={() => {
                if (!formName) return;
                createFirmMutation.mutate(getFormData());
                setIsAddFirmOpen(false); resetForm();
              }} className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs" data-testid="button-save-firm">{t('common.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingFirm} onOpenChange={o => { if (!o) { setEditingFirm(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-[460px] bg-card border-border p-0 overflow-hidden max-h-[85vh] overflow-y-auto" onOpenAutoFocus={e => e.preventDefault()}>
          <div className="p-5">
            <DialogHeader className="mb-4 text-right">
              <DialogTitle className="text-base font-semibold flex items-center gap-2"><Pencil className="w-4 h-4 text-indigo-500" /> {t('settings.editFirm')} — {editingFirm?.name}</DialogTitle>
            </DialogHeader>
            {ruleFormFields()}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setEditingFirm(null); resetForm(); }} className="h-8 text-xs">{t('common.cancel')}</Button>
              <Button size="sm" disabled={isDemo} onClick={() => {
                if (!editingFirm) return;
                updateFirmMutation.mutate({ id: editingFirm.id, data: getFormData() });
                setEditingFirm(null); resetForm();
              }} className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs">{t('common.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddTierOpen !== null} onOpenChange={o => { if (!o) { setIsAddTierOpen(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-[460px] bg-card border-border p-0 overflow-hidden max-h-[85vh] overflow-y-auto" onOpenAutoFocus={e => e.preventDefault()}>
          <div className="p-5">
            <DialogHeader className="mb-4 text-right">
              <DialogTitle className="text-base font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-500" /> {t('settings.newTier')}</DialogTitle>
            </DialogHeader>
            {ruleFormFields()}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setIsAddTierOpen(null); resetForm(); }} className="h-8 text-xs">{t('common.cancel')}</Button>
              <Button size="sm" disabled={isDemo} onClick={() => {
                if (!formName || isAddTierOpen === null) return;
                createTierMutation.mutate({ firmId: isAddTierOpen, ...getFormData() });
                setIsAddTierOpen(null); resetForm();
              }} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs" data-testid="button-save-tier">{t('common.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTier} onOpenChange={o => { if (!o) { setEditingTier(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-[460px] bg-card border-border p-0 overflow-hidden max-h-[85vh] overflow-y-auto" onOpenAutoFocus={e => e.preventDefault()}>
          <div className="p-5">
            <DialogHeader className="mb-4 text-right">
              <DialogTitle className="text-base font-semibold flex items-center gap-2"><Pencil className="w-4 h-4 text-amber-500" /> {t('settings.editTier')} — {editingTier?.tier.name}</DialogTitle>
            </DialogHeader>
            {ruleFormFields()}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setEditingTier(null); resetForm(); }} className="h-8 text-xs">{t('common.cancel')}</Button>
              <Button size="sm" disabled={isDemo} onClick={() => {
                if (!editingTier) return;
                updateTierMutation.mutate({ id: editingTier.tier.id, data: { firmId: editingTier.firmId, ...getFormData() } });
                setEditingTier(null); resetForm();
              }} className="bg-amber-600 hover:bg-amber-700 text-white h-8 text-xs">{t('common.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="bg-card p-5 rounded-lg border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Building className="w-4 h-4 text-indigo-500" /> {t('settings.firmsAndRules')}</h3>
          <Button size="sm" onClick={() => { resetForm(); setIsAddFirmOpen(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs gap-1.5" disabled={isDemo} data-testid="button-add-firm">
            <Plus className="w-3.5 h-3.5" /> {t('settings.newFirm')}
          </Button>
        </div>

        <div className="space-y-2">
          {firmsList.map(firm => (
            <div key={firm.id} className="border border-border rounded-lg overflow-hidden" data-testid={`firm-card-${firm.id}`}>
              <div className="flex items-center justify-between p-3 bg-secondary/20 cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => setExpandedFirm(expandedFirm === firm.id ? null : firm.id)}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-indigo-600/10 flex items-center justify-center">
                    <Building className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" dir="ltr">{firm.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {firm.tiers.length} {t('settings.tiers')} | DD: {firm.dailyDrawdown || 0}%/{firm.totalDrawdown || 0}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={e => { e.stopPropagation(); loadFirmToForm(firm); setEditingFirm(firm); }}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" data-testid={`button-edit-firm-${firm.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); if (confirm(t('settings.confirmDeleteFirm'))) deleteFirmMutation.mutate(firm.id); }}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500" disabled={isDemo} data-testid={`button-delete-firm-${firm.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {expandedFirm === firm.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedFirm === firm.id && (
                <div className="p-3 space-y-3 border-t border-border bg-background/50">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">{t('settings.tiers')}</p>
                    <Button variant="outline" size="sm" onClick={() => { resetForm(); setIsAddTierOpen(firm.id); }}
                      className="h-7 text-[11px] gap-1" disabled={isDemo} data-testid={`button-add-tier-${firm.id}`}>
                      <Plus className="w-3 h-3" /> {t('settings.newTier')}
                    </Button>
                  </div>

                  {firm.tiers.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">{t('settings.noTiers')}</p>
                  ) : (
                    <div className="space-y-2">
                      {firm.tiers.map(tier => (
                        <div key={tier.id} className="border border-border rounded-lg overflow-hidden" data-testid={`tier-card-${tier.id}`}>
                            <div className="flex items-center justify-between p-2.5 hover:bg-secondary/20 transition-colors">
                              <div className="flex-1">
                                <p className="text-xs font-medium" dir="ltr">{tier.name}</p>
                                <p className="text-[10px] text-muted-foreground" dir="ltr">
                                  {tier.minTradingDays} {t('settings.tierDays')} | {tier.consistencyPercentage}% {t('settings.tierCons')} | {t('settings.tierDD')}: {tier.dailyDrawdown || 0}%/{tier.totalDrawdown || 0}% | {tier.withdrawalWaitDays} {t('settings.tierWait')}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => { loadTierToForm(tier); setEditingTier({ tier, firmId: firm.id }); }}
                                  className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" data-testid={`button-edit-tier-${tier.id}`}>
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button onClick={() => { if (confirm(t('settings.confirmDeleteTier'))) deleteTierMutation.mutate(tier.id); }}
                                  className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500" disabled={isDemo} data-testid={`button-delete-tier-${tier.id}`}>
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card p-5 rounded-lg border border-border">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Plug className="w-4 h-4 text-indigo-500" /> {t('settings.apiConnections')}</h3>
        <p className="text-xs text-muted-foreground mb-3">{t('settings.apiConnectionsDesc')}</p>
        <a href="/integrations" className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors" data-testid="link-integrations">
          <Plug className="w-4 h-4" /> {t('settings.goToIntegrations')}
        </a>
      </div>

      <TwoFactorSettings />

      <div className="bg-card p-5 rounded-lg border border-border">
        <h3 className="text-sm font-semibold mb-3">{t('settings.exportData')}</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => handleExport('accounts')} className="gap-1.5"><Download className="w-3.5 h-3.5" /> {t('settings.accountsCsv')}</Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('withdrawals')} className="gap-1.5"><Download className="w-3.5 h-3.5" /> {t('settings.withdrawalsCsv')}</Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('system-spec-pdf')} className="gap-1.5" data-testid="button-export-pdf"><FileText className="w-3.5 h-3.5" /> {t('settings.systemSpecPdf')}</Button>
        </div>
      </div>
    </div>
  );
}

function TwoFactorSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'backup' | 'disable'>('idle');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/v1/auth/2fa/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/v1/auth/2fa/status");
      return res.json();
    },
  });

  const handleSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest("POST", "/api/v1/auth/2fa/setup");
      const data = await res.json();
      if (res.ok) {
        setQrCode(data.qrCode);
        setSecret(data.secret);
        setStep('setup');
      } else {
        setError(data.message);
      }
    } catch {
      setError(t('auth.twoFactor.setupError'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest("POST", "/api/v1/auth/2fa/verify", { code });
      const data = await res.json();
      if (res.ok) {
        setBackupCodes(data.backupCodes);
        setStep('backup');
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/2fa/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
      } else {
        setError(data.message);
      }
    } catch {
      setError(t('auth.twoFactor.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest("POST", "/api/v1/auth/2fa/disable", { code });
      const data = await res.json();
      if (res.ok) {
        setStep('idle');
        setCode('');
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/2fa/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
      } else {
        setError(data.message);
      }
    } catch {
      setError(t('auth.twoFactor.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const isEnabled = status?.enabled ?? false;

  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-indigo-500" /> {t('settings.twoFactor.title')}
      </h3>
      <p className="text-xs text-muted-foreground mb-4">{t('settings.twoFactor.description')}</p>

      {statusLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : step === 'idle' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            <span className="text-sm" data-testid="text-2fa-status">
              {isEnabled ? t('settings.twoFactor.enabled') : t('settings.twoFactor.disabled')}
            </span>
          </div>
          {isEnabled ? (
            <Button variant="outline" size="sm" onClick={() => { setStep('disable'); setCode(''); setError(''); }} data-testid="button-2fa-disable">
              {t('settings.twoFactor.disableBtn')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleSetup} disabled={loading} data-testid="button-2fa-enable">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('settings.twoFactor.enableBtn')}
            </Button>
          )}
        </div>
      ) : step === 'setup' ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('settings.twoFactor.scanQr')}</p>
          {qrCode && <img src={qrCode} alt="2FA QR Code" className="w-48 h-48 mx-auto bg-white rounded-lg p-2" data-testid="img-2fa-qr" />}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('settings.twoFactor.manualEntry')}</p>
            <code className="block text-xs bg-secondary/50 rounded px-3 py-2 break-all font-mono" dir="ltr" data-testid="text-2fa-secret">{secret}</code>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">{t('auth.twoFactor.code')}</Label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="000000"
              className="bg-secondary/50 border-border text-sm h-10 text-center tracking-widest w-40"
              dir="ltr"
              data-testid="input-2fa-setup-code"
            />
          </div>
          {error && <p className="text-sm text-red-500" data-testid="text-2fa-error">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleVerify} disabled={loading || !code} data-testid="button-2fa-confirm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('settings.twoFactor.confirmBtn')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStep('idle'); setError(''); }} data-testid="button-2fa-cancel">
              {t('account.cancel')}
            </Button>
          </div>
        </div>
      ) : step === 'backup' ? (
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-sm font-semibold text-amber-400 mb-1">{t('settings.twoFactor.backupTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.twoFactor.backupDesc')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2" data-testid="container-backup-codes">
            {backupCodes.map((c, i) => (
              <code key={i} className="text-sm bg-secondary/50 rounded px-3 py-1.5 text-center font-mono" dir="ltr">{c}</code>
            ))}
          </div>
          <Button size="sm" onClick={() => { setStep('idle'); setCode(''); }} data-testid="button-2fa-done">
            {t('settings.twoFactor.doneBtn')}
          </Button>
        </div>
      ) : step === 'disable' ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('settings.twoFactor.disableDesc')}</p>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">{t('auth.twoFactor.code')}</Label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="000000"
              className="bg-secondary/50 border-border text-sm h-10 text-center tracking-widest w-40"
              dir="ltr"
              data-testid="input-2fa-disable-code"
            />
          </div>
          {error && <p className="text-sm text-red-500" data-testid="text-2fa-error">{error}</p>}
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleDisable} disabled={loading || !code} data-testid="button-2fa-confirm-disable">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('settings.twoFactor.disableBtn')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStep('idle'); setError(''); }} data-testid="button-2fa-cancel">
              {t('account.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const { mode, setMode, resolvedTheme, accent, setAccent } = useTheme();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const queryClient = useQueryClient();
  const { isConnected: isStreamConnected, wsStates, execStates } = useTradingStream((event) => {
    toast({
      title: t("copyTrading.slippageBlocked"),
      description: t("copyTrading.slippageBlockedDesc", {
        action: event.action,
        symbol: event.symbol,
        follower: event.followerName,
      }),
      variant: "destructive",
    });
  });
  const [location, navigate] = useLocation();
  const [activePage, setActivePage] = useState(() => {
    if (typeof window !== 'undefined') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab) return tab;
    }
    return 'dashboard';
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && tab !== activePage) setActivePage(tab);
    else if (!tab && location === '/' && activePage !== 'dashboard') setActivePage('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  const homePrices = useLiveMarketPrices();
  const [totalConnections, setTotalConnections] = useState<number | null>(null);
  useEffect(() => {
    const fetchStats = () => {
      fetch(apiUrl('/api/v1/community-stats'), { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setTotalConnections(data.totalConnections); })
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);
  const initialSearch = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('search') || '')
    : '';
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearchQuery(value), 200);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('search');
    if (q !== null && q !== searchInput) {
      setSearchInput(q);
      setSearchQuery(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const { data: allAccounts = [] } = useQuery<(DbAccount & { computedStatus?: string })[]>({ queryKey: ["/api/v1/accounts"] });
  const rawAccounts = useMemo(() => allAccounts, [allAccounts]);
  const { data: withdrawalsList = [] } = useQuery<DbWithdrawal[]>({ queryKey: ["/api/v1/withdrawals"] });
  const { data: firmsList = [] } = useQuery<(Firm & { tiers: FirmTier[] })[]>({ queryKey: ["/api/v1/firms"] });
  const { data: rawAlertsList = [] } = useQuery<Alert[]>({ queryKey: ["/api/v1/alerts"] });
  const alertsList = useMemo(() => rawAlertsList.filter(a => (a as any).type !== "sync_update"), [rawAlertsList]);
  const { data: tradingPriorities = [] } = useQuery<TradingPriority[]>({ queryKey: ["/api/v1/trading-priorities"] });
  const { data: monthlyReports = [] } = useQuery<MonthlyReport[]>({ queryKey: ["/api/v1/monthly-reports"] });
  const { data: subscription } = useQuery<any>({ queryKey: ["/api/v1/billing/subscription"] });

  const userPlanKey = subscription?.plan?.key || 'free';
  const isAdmin = user?.role === 'admin';

  const { widgets, isCustomizing, setIsCustomizing, reorder, toggleVisibility, resetLayout } = useWidgetLayout();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [dragCol, setDragCol] = useState<ColumnId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null);
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(active.id as string, over.id as string);
    }
  }, [reorder]);

  const WIDGET_LABELS: Record<WidgetId, string> = {
    kpi: t('dashboard.widgets.kpiSummary'),
    pnlChart: t('dashboard.widgets.pnlChart'),
    firmDistribution: t('dashboard.widgets.firmDistribution'),
    calendar: t('dashboard.widgets.calendar'),
    economicCalendar: t('dashboard.widgets.economicCalendar'),
    accounts: t('dashboard.widgets.accountsTable'),
  };

  const [econFilter, setEconFilter] = useState<"all" | "high">("high");
  const [econPeriod, setEconPeriod] = useState<"today" | "week" | "nextWeek">("week");

  type EconImpact = "High" | "Medium" | "Low" | "Holiday";
  interface EconEvent {
    title: string;
    country: string;
    date: string;
    impact: EconImpact;
    forecast: string;
    previous: string;
  }

  const ECON_COUNTRIES: { code: string; flag: string; label: string }[] = [
    { code: "USD", flag: "🇺🇸", label: "USD" },
    { code: "EUR", flag: "🇪🇺", label: "EUR" },
    { code: "GBP", flag: "🇬🇧", label: "GBP" },
    { code: "JPY", flag: "🇯🇵", label: "JPY" },
    { code: "CAD", flag: "🇨🇦", label: "CAD" },
    { code: "AUD", flag: "🇦🇺", label: "AUD" },
    { code: "NZD", flag: "🇳🇿", label: "NZD" },
    { code: "CHF", flag: "🇨🇭", label: "CHF" },
    { code: "CNY", flag: "🇨🇳", label: "CNY" },
  ];

  const [econCountries, setEconCountries] = useState<Set<string>>(() => new Set(["USD"]));

  const toggleEconCountry = (code: string) => {
    setEconCountries(prev => {
      const next = new Set(prev);
      if (next.has(code)) { if (next.size > 1) next.delete(code); }
      else next.add(code);
      return next;
    });
  };

  const { data: econThisWeek = [] } = useQuery<EconEvent[]>({
    queryKey: ["/api/v1/economic-calendar", "thisweek"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/economic-calendar?period=thisweek"), { credentials: "include" });
      return res.json();
    },
  });

  const { data: econNextWeek = [] } = useQuery<EconEvent[]>({
    queryKey: ["/api/v1/economic-calendar", "nextweek"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/economic-calendar?period=nextweek"), { credentials: "include" });
      return res.json();
    },
    enabled: econPeriod === "nextWeek",
  });

  const econEvents = econPeriod === "nextWeek" ? econNextWeek : econThisWeek;


  const hasFeature = (feature: string) => {
    if (isAdmin) return true;
    const plan = subscription?.plan;
    if (!plan) return false;
    const featureMap: Record<string, string> = {
      integrations: 'hasIntegrations',
      copy_trading: 'hasCopyTrading',
      ai_chatbot: 'hasAiChatbot',
      priority_engine: 'hasPriorityEngine',
      exports: 'hasExports',
    };
    return !!plan[featureMap[feature]];
  };

  const [planLimitModal, setPlanLimitModal] = useState<{ feature: string; requiredPlan: string } | null>(null);

  const handleLockedFeature = (feature: string, requiredPlan: string) => {
    setPlanLimitModal({ feature, requiredPlan });
  };

  const accounts: EnrichedAccount[] = useMemo(() =>
    rawAccounts.map(a => {
      const baseline = (a as any).startingBalance ?? a.size;
      return { ...a, profit: a.balance - baseline };
    }), [rawAccounts]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/accounts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] }); },
    onError: () => { toast({ title: t('dashboard.deleteError'), variant: "destructive" }); },
  });
  const deleteWithdrawalMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/withdrawals/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/withdrawals"] }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const markAlertReadMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/v1/alerts/${id}/read`, {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const markAllAlertsReadMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/v1/alerts/read-all", {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const deleteAlertMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/alerts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); toast({ title: t('dashboard.alertsDeleted') }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const deleteBulkAlertsMutation = useMutation({
    mutationFn: async (ids: number[]) => { await apiRequest("POST", "/api/v1/alerts/delete-bulk", { ids }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); setSelectedAlerts(new Set()); toast({ title: t('dashboard.alertsDeleted') }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const [selectedAlerts, setSelectedAlerts] = useState<Set<number>>(new Set());

  const createFirmMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/v1/firms", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: (err: any) => { toast({ title: t('common.error'), description: err?.message?.includes("409") ? t('settings.firmExists') : t('settings.firmCreateError'), variant: "destructive" }); },
  });
  const updateFirmMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => { const res = await apiRequest("PATCH", `/api/v1/firms/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: () => { toast({ title: t('common.error'), description: t('settings.firmUpdateError'), variant: "destructive" }); },
  });
  const deleteFirmMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/firms/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: () => { toast({ title: t('common.error'), description: t('settings.firmDeleteError'), variant: "destructive" }); },
  });
  const createTierMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/v1/firm-tiers", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: () => { toast({ title: t('common.error'), description: t('settings.tierCreateError'), variant: "destructive" }); },
  });
  const updateTierMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => { const res = await apiRequest("PATCH", `/api/v1/firm-tiers/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });
  const deleteTierMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/firm-tiers/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/firms"] }); },
    onError: () => { toast({ title: t('dashboard.operationError'), variant: "destructive" }); },
  });

  const [isWithdrawalListOpen, setIsWithdrawalListOpen] = useState(false);

  const [isGroupedView, setIsGroupedView] = useState(true);
  const [expandedFirms, setExpandedFirms] = useState<Record<string, boolean>>({});
  const [selectedFirms, setSelectedFirms] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [isAlertsPanelOpen, setIsAlertsPanelOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { pnlDisplayMode, cyclePnlMode, formatCurrency, formatPnl } = useCurrency();

  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
    try {
      const saved = localStorage.getItem('vertex_visible_columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((c: string) => ALL_COLUMNS.includes(c as ColumnId)) as ColumnId[];
          if (!valid.includes('account')) valid.unshift('account');
          if (valid.length > 0) return valid;
        }
      }
    } catch {}
    return DEFAULT_COLUMNS;
  });

  const toggleColumn = useCallback((col: ColumnId) => {
    if (ALWAYS_VISIBLE.includes(col)) return;
    setVisibleColumns(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      localStorage.setItem('vertex_visible_columns', JSON.stringify(next));
      return next;
    });
  }, []);

  const isColVisible = useCallback((col: ColumnId) => visibleColumns.includes(col), [visibleColumns]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('vertex_column_widths');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const getColWidth = useCallback((col: ColumnId) => columnWidths[col] || DEFAULT_COL_WIDTHS[col], [columnWidths]);

  const handleColumnResize = useCallback((col: ColumnId, delta: number) => {
    setColumnWidths(prev => {
      const current = prev[col] || DEFAULT_COL_WIDTHS[col];
      const next = { ...prev, [col]: Math.max(60, current + delta) };
      localStorage.setItem('vertex_column_widths', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleColDragStart = useCallback((col: ColumnId) => {
    setDragCol(col);
  }, []);
  const handleColDragOver = useCallback((e: React.DragEvent, col: ColumnId) => {
    e.preventDefault();
    setDragOverCol(col);
  }, []);
  const handleColDrop = useCallback((targetCol: ColumnId) => {
    setDragOverCol(null);
    if (!dragCol || dragCol === targetCol) { setDragCol(null); return; }
    setVisibleColumns(prev => {
      const oldIndex = prev.indexOf(dragCol);
      const newIndex = prev.indexOf(targetCol);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      localStorage.setItem('vertex_visible_columns', JSON.stringify(next));
      return next;
    });
    setDragCol(null);
  }, [dragCol]);

  const { data: billingStatus } = useQuery<{ status: string; daysLeft: number | null; trialEndsAt: string | null; planName: string }>({
    queryKey: ["/api/v1/billing/status"],
  });

  const { data: integrationConnections = [] } = useQuery<any[]>({
    queryKey: ["/api/v1/integrations/connections"],
  });

  const activeConnections = useMemo(() =>
    integrationConnections.filter((c: any) => c.status === 'connected'), [integrationConnections]);

  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0 });
  const [syncLockedUntil, setSyncLockedUntil] = useState<number | null>(null);
  const isSyncLocked = syncLockedUntil !== null && Date.now() < syncLockedUntil;

  const lastImportDate = useMemo(() => {
    const dates = integrationConnections
      .filter((c: any) => c.lastSuccessAt)
      .map((c: any) => new Date(c.lastSuccessAt).getTime());
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [integrationConnections]);

  const handleSyncAll = useCallback(async () => {
    if (activeConnections.length === 0) {
      toast({ title: t('dashboard.syncAll.noConnections'), description: t('dashboard.syncAll.noConnectionsDesc') });
      return;
    }
    setIsSyncingAll(true);
    const total = activeConnections.length;
    setSyncProgress({ done: 0, total });

    const results = await Promise.allSettled(
      activeConnections.map(async (conn: any) => {
        try {
          await apiRequest("POST", `/api/v1/integrations/connections/${conn.id}/sync`, { jobType: "full_sync" });
          return 'success';
        } finally {
          setSyncProgress(prev => ({ ...prev, done: prev.done + 1 }));
        }
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;

    await new Promise(resolve => setTimeout(resolve, 3000));

    queryClient.invalidateQueries();

    toast({
      title: failCount > 0 ? t('dashboard.syncAll.completeWithErrors') : t('dashboard.syncAll.complete'),
      variant: failCount > 0 ? "destructive" : "success",
    });
    setIsSyncingAll(false);
    setSyncProgress({ done: 0, total: 0 });
    setSyncLockedUntil(Date.now() + 60000);
  }, [activeConnections, queryClient, t, toast]);

  const allFirms = useMemo(() => Array.from(new Set(accounts.map(a => a.firm))), [accounts]);

  const liveAccountsAll = useMemo(() => accounts.filter(a => isLiveAccount(a as any)), [accounts]);
  const activeAccounts = useMemo(
    () => accounts.filter(a =>
      !isLiveAccount(a as any)
      && !FAILED_STATUSES.includes(a.computedStatus || '')
      && !PASSED_STATUSES.includes(a.computedStatus || '')
    ),
    [accounts]
  );
  const failedAccountsAll = useMemo(
    () => accounts.filter(a => !isLiveAccount(a as any) && FAILED_STATUSES.includes(a.computedStatus || '')),
    [accounts]
  );
  const passedAccountsAll = useMemo(
    () => accounts.filter(a => !isLiveAccount(a as any) && PASSED_STATUSES.includes(a.computedStatus || '')),
    [accounts]
  );

  const filteredLiveAccounts = useMemo(() => {
    return liveAccountsAll.filter(a => {
      const matchFirm = selectedFirms.length === 0 || selectedFirms.includes(a.firm);
      const matchSearch = !searchQuery || a.name.includes(searchQuery) || a.firm.toLowerCase().includes(searchQuery.toLowerCase()) || a.accountId.includes(searchQuery);
      return matchFirm && matchSearch;
    });
  }, [liveAccountsAll, selectedFirms, searchQuery]);

  const groupedLiveAccounts = useMemo(() => {
    const groups: Record<string, { accounts: EnrichedAccount[]; totalProfit: number; totalSize: number }> = {};
    filteredLiveAccounts.forEach(account => {
      if (!groups[account.firm]) {
        groups[account.firm] = { accounts: [], totalProfit: 0, totalSize: 0 };
      }
      groups[account.firm].accounts.push(account);
      groups[account.firm].totalProfit += account.profit;
      groups[account.firm].totalSize += ((account as any).startingBalance || account.size);
    });
    return groups;
  }, [filteredLiveAccounts]);

  const filteredAccounts = useMemo(() => {
    return activeAccounts.filter(a => {
      const matchFirm = selectedFirms.length === 0 || selectedFirms.includes(a.firm);
      const matchStage = selectedStages.length === 0 || selectedStages.includes(a.stage);
      const matchSearch = !searchQuery || a.name.includes(searchQuery) || a.firm.toLowerCase().includes(searchQuery.toLowerCase()) || a.accountId.includes(searchQuery);
      return matchFirm && matchStage && matchSearch;
    });
  }, [activeAccounts, selectedFirms, selectedStages, searchQuery]);

  const filteredFailedAccounts = useMemo(() => {
    return failedAccountsAll.filter(a => {
      const matchFirm = selectedFirms.length === 0 || selectedFirms.includes(a.firm);
      const matchSearch = !searchQuery || a.name.includes(searchQuery) || a.firm.toLowerCase().includes(searchQuery.toLowerCase()) || a.accountId.includes(searchQuery);
      return matchFirm && matchSearch;
    });
  }, [failedAccountsAll, selectedFirms, searchQuery]);

  const filteredPassedAccounts = useMemo(() => {
    return passedAccountsAll.filter(a => {
      const matchFirm = selectedFirms.length === 0 || selectedFirms.includes(a.firm);
      const matchSearch = !searchQuery || a.name.includes(searchQuery) || a.firm.toLowerCase().includes(searchQuery.toLowerCase()) || a.accountId.includes(searchQuery);
      return matchFirm && matchSearch;
    });
  }, [passedAccountsAll, selectedFirms, searchQuery]);

  const [isFailedSectionOpen, setIsFailedSectionOpen] = useState(false);
  const [isPassedSectionOpen, setIsPassedSectionOpen] = useState(true);

  const groupedFailedAccounts = useMemo(() => {
    const groups: Record<string, { accounts: EnrichedAccount[]; totalProfit: number; totalSize: number }> = {};
    filteredFailedAccounts.forEach(account => {
      if (!groups[account.firm]) {
        groups[account.firm] = { accounts: [], totalProfit: 0, totalSize: 0 };
      }
      groups[account.firm].accounts.push(account);
      groups[account.firm].totalProfit += account.profit;
      groups[account.firm].totalSize += account.size;
    });
    return groups;
  }, [filteredFailedAccounts]);

  const groupedPassedAccounts = useMemo(() => {
    const groups: Record<string, { accounts: EnrichedAccount[]; totalProfit: number; totalSize: number }> = {};
    filteredPassedAccounts.forEach(account => {
      if (!groups[account.firm]) {
        groups[account.firm] = { accounts: [], totalProfit: 0, totalSize: 0 };
      }
      groups[account.firm].accounts.push(account);
      groups[account.firm].totalProfit += account.profit;
      groups[account.firm].totalSize += account.size;
    });
    return groups;
  }, [filteredPassedAccounts]);

  const totalProfit = filteredAccounts.reduce((sum, a) => sum + a.profit, 0);
  const totalSize = filteredAccounts.reduce((sum, a) => sum + a.size, 0);
  const totalEquity = filteredAccounts.reduce((sum, a) => sum + a.balance, 0);

  const totalWithdrawals = useMemo(() =>
    withdrawalsList.filter(w => w.status === 'paid' || w.status === 'approved').reduce((sum, w) => sum + w.amount, 0), [withdrawalsList]);
  const pendingWithdrawals = useMemo(() => withdrawalsList.filter(w => w.status === 'pending'), [withdrawalsList]);
  const unreadAlerts = useMemo(() => alertsList.filter(a => !a.read), [alertsList]);

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, { accounts: EnrichedAccount[]; totalProfit: number; totalSize: number }> = {};
    filteredAccounts.forEach(account => {
      if (!groups[account.firm]) {
        groups[account.firm] = { accounts: [], totalProfit: 0, totalSize: 0 };
      }
      groups[account.firm].accounts.push(account);
      groups[account.firm].totalProfit += account.profit;
      groups[account.firm].totalSize += account.size;
    });
    return groups;
  }, [filteredAccounts]);

  useEffect(() => {
    const newFirms: Record<string, boolean> = {};
    let hasNew = false;
    Object.keys(groupedAccounts).forEach(firm => {
      if (expandedFirms[firm] === undefined) {
        newFirms[firm] = true;
        hasNew = true;
      }
    });
    if (hasNew) setExpandedFirms(prev => ({ ...prev, ...newFirms }));
  }, [groupedAccounts]);


  const firmDistribution = useMemo(() =>
    Object.entries(groupedAccounts).map(([firm, data]) => ({
      name: firm, value: data.accounts.length, profit: data.totalProfit,
    })), [groupedAccounts]);

  const stageDistribution = useMemo(() => {
    const stages: Record<string, number> = {};
    filteredAccounts.forEach(a => { stages[a.stage] = (stages[a.stage] || 0) + 1; });
    return Object.entries(stages).map(([stage, count]) => ({
      name: t(`phases.${stage}`, { defaultValue: stage }), value: count,
    }));
  }, [filteredAccounts]);

  const { data: tradeStats } = useQuery<{ tradeWinRate: number; profitFactor: number; dayWinRate: number; avgWin: number; avgLoss: number; totalTrades: number; winTrades: number; lossTrades: number; totalDays: number; winDays: number }>({ queryKey: ["/api/v1/trades/stats"] });
  const { data: accountsPnl = [] } = useQuery<{ accountId: number; accountName: string; startSize: number; currentBalance: number; data: { day: string; balance: number }[] }[]>({ queryKey: ["/api/v1/trades/monthly-pnl"] });
  const { data: equityCurveData = [] } = useQuery<{ accountId: number; accountName: string; startSize: number; currentBalance: number; target: number; maxDrawdown: number; data: { timestamp: string; balance: number }[] }[]>({ queryKey: ["/api/v1/equity-curve"] });
  const [pnlChartIndex, setPnlChartIndex] = useState(0);

  const failedAccountIds = useMemo(() => new Set(failedAccountsAll.map(a => a.id)), [failedAccountsAll]);

  const equityCurveAccounts = useMemo(() => {
    return equityCurveData.filter(acc => acc.data && acc.data.length > 0 && !failedAccountIds.has(acc.accountId)).map(acc => ({
      accountId: acc.accountId,
      accountName: acc.accountName,
      startSize: acc.startSize || 0,
      currentBalance: acc.currentBalance || 0,
      target: acc.target || 0,
      maxDrawdown: acc.maxDrawdown || 0,
      pnl: Math.round(((acc.currentBalance || 0) - (acc.startSize || 0)) * 100) / 100,
      data: acc.data.map(d => ({ timestamp: d.timestamp, balance: d.balance || 0 })),
    }));
  }, [equityCurveData, failedAccountIds]);

  const pnlChartAccounts = useMemo(() => {
    return accountsPnl.filter(acc => acc.data && acc.data.length > 0 && !failedAccountIds.has(acc.accountId)).map(acc => ({
      accountId: acc.accountId,
      accountName: acc.accountName,
      startSize: acc.startSize || 0,
      currentBalance: acc.currentBalance || 0,
      pnl: Math.round(((acc.currentBalance || 0) - (acc.startSize || 0)) * 100) / 100,
      data: acc.data.map(d => ({ day: (d.day || '').substring(5), fullDay: d.day || '', balance: d.balance || 0 })),
    }));
  }, [accountsPnl, failedAccountIds]);

  useEffect(() => {
    if (pnlChartIndex >= pnlChartAccounts.length && pnlChartAccounts.length > 0) {
      setPnlChartIndex(0);
    }
  }, [pnlChartAccounts.length, pnlChartIndex]);

  const [chartPeriod, setChartPeriod] = useState<"1d" | "1w" | "1m" | "3m">("1m");
  const [chartDisplayMode, setChartDisplayMode] = useState<"usd" | "pct">("usd");
  const [showChartBoundaries, setShowChartBoundaries] = useState(true);


  const StageBadge = ({ stage }: { stage: AccountStage }) => {
    const info = STAGE_INFO[stage] || STAGE_INFO.phase1;
    const animate = stage === 'funded' || stage === 'payout' || stage === 'LIVE';
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] border ${info.badgeClass}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${info.dotClass} ${animate ? 'animate-pulse' : ''}`} />
        {t(`phases.${stage}`)}
      </div>
    );
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const info = STATUS_INFO[status] || STATUS_INFO.healthy;
    const Icon = info.icon;
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${info.color} bg-current/5 border border-current/10`}>
        <Icon className="w-3 h-3" />
        {t(`status.${status}`)}
      </div>
    );
  };

  const CircularProgress = ({ value, max, color = "indigo" }: { value: number; max: number; color?: string }) => {
    const percentage = Math.max(0, Math.min(100, (value / max) * 100));
    const colors: Record<string, string> = { indigo: "stroke-indigo-500", emerald: "stroke-emerald-500", amber: "stroke-amber-500", red: "stroke-red-500" };
    return (
      <div className="relative w-8 h-8 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" fill="none" className="stroke-muted" strokeWidth="3" />
          <circle cx="18" cy="18" r="16" fill="none" className={`${colors[color] || colors.indigo} transition-all duration-1000 ease-out`}
            strokeWidth="3" strokeDasharray={`${percentage} 100`} strokeLinecap="round" />
        </svg>
        <span className="absolute text-[8px] font-mono font-medium text-foreground">{Math.round(percentage)}%</span>
      </div>
    );
  };

  const handleExport = async (type: string) => {
    try {
      const res = await fetch(apiUrl(`/api/v1/export/${type}`));
      if (!res.ok) {
        if (res.status === 403) {
          try {
            const err = await res.json();
            if (err.code === 'plan_limit') {
              handleLockedFeature(err.feature || 'exports', err.requiredPlan || 'pro');
              return;
            }
          } catch {}
        }
        toast({ title: t('dashboard.operationError'), variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const isPdf = type.includes('pdf');
      a.download = isPdf ? `VERTEX_COMMAND_System_Spec.pdf` : `${type}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch {
      toast({ title: t('dashboard.operationError'), variant: "destructive" });
    }
  };

  const renderCellContent = useCallback((col: ColumnId, account: EnrichedAccount) => {
    const profit = account.profit;
    const useBuffer = (account as any).bufferEnabled !== false;
    const bufferMax = useBuffer ? (account.maxDrawdown || 0) : 0;
    const currentBufferValue = Math.min(Math.max(profit, 0), bufferMax);
    const bufferPercent = bufferMax > 0 ? (currentBufferValue / bufferMax) * 100 : 0;
    const targetPercent = account.target ? (Math.max(0, profit) / account.target) * 100 : 0;
    const firmRules = firmsList.find(f => f.name === account.firm);
    const minDays = firmRules?.minTradingDays || 0;

    switch (col) {
      case 'account':
        return (
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{account.name}</p>
            {(account as any).accountType === 'LIVE' && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-amber-400/20 to-amber-500/20 border border-amber-400/40 text-[9px] font-bold text-amber-600 dark:text-amber-400 shadow-sm shadow-amber-400/20"
                data-testid={`badge-live-${account.id}`}
                title={t('account.liveTooltip')}
              >
                <Zap className="w-2.5 h-2.5" />
                {t('account.liveBadge')}
              </span>
            )}
            {account.dataSource === "integration" && (() => {
              const syncAge = account.lastSyncAt ? Date.now() - new Date(account.lastSyncAt).getTime() : null;
              const syncColor = syncAge === null ? "bg-neutral-400" : syncAge < 300000 ? "bg-emerald-500" : syncAge < 3600000 ? "bg-amber-500" : "bg-red-500";
              const syncLabel = syncAge === null ? t('account.syncStatusNever') : syncAge < 300000 ? t('account.syncStatusGood') : t('account.syncStatusStale');
              return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[9px] font-semibold text-cyan-600 dark:text-cyan-400" data-testid={`badge-synced-${account.id}`} title={syncLabel}>
                  <span className={`w-1.5 h-1.5 rounded-full ${syncColor} inline-block`} />
                  <RefreshCw className="w-2.5 h-2.5" />
                </span>
              );
            })()}
            {(account as any).brokerActive === false && (() => {
              const reason = ((account as any).brokerStatus as string | null)?.trim() || t('account.brokerInactiveReasonUnknown');
              const updatedAt = (account as any).brokerStatusUpdatedAt as string | null;
              const tooltip = t('account.brokerInactiveTooltip', { reason })
                + (updatedAt ? ` · ${t('account.brokerStatusUpdated', { when: new Date(updatedAt).toLocaleString(getDateLocale(i18n.language)) })}` : '');
              return (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-[9px] font-semibold text-red-600 dark:text-red-400"
                  data-testid={`badge-broker-inactive-${account.id}`}
                  title={tooltip}
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span dir="ltr">{reason}</span>
                </span>
              );
            })()}
          </div>
        );
      case 'stage': {
        const effectiveStage: AccountStage = isLiveAccount(account as any)
          ? 'LIVE'
          : (account.stage as AccountStage);
        return <StageBadge stage={effectiveStage} />;
      }
      case 'status':
        return (
          <div className="flex items-center gap-1 justify-center">
            <StatusBadge status={account.computedStatus === 'sync_failed' ? 'violated' : (account.computedStatus || 'healthy')} />
          </div>
        );
      case 'size': {
        const displaySize = (account as any).startingBalance || account.size || account.balance;
        return <span className="text-sm font-mono text-muted-foreground" dir="ltr">{formatCurrency(displaySize)}</span>;
      }
      case 'pnl':
        return (
          <div className="flex items-center gap-1.5 justify-center" dir="ltr">
            {profit >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />}
            <span className={`text-sm font-semibold font-mono ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatPnl(profit, account.size)}
            </span>
          </div>
        );
      case 'target':
        return account.target ? (
          <div className="space-y-1">
            <span className="text-sm font-semibold font-mono block text-center" dir="ltr">{formatCurrency(account.target)}</span>
            <div className="w-full">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(targetPercent, 100)}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono text-center" dir="ltr">{targetPercent.toFixed(2)}%</p>
            </div>
          </div>
        ) : <span className="text-[10px] text-muted-foreground">—</span>;
      case 'tradingDays':
        return minDays > 0 ? (
          <div className="flex items-center gap-1.5 justify-center">
            <span className="text-xs font-mono text-muted-foreground" dir="ltr">{account.tradingDays || 0}/{minDays}</span>
            {(account.tradingDays || 0) >= minDays && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
          </div>
        ) : <span className="text-xs font-mono text-muted-foreground">{account.tradingDays || 0}</span>;
      default: return null;
    }
  }, [firmsList, t, formatCurrency, formatPnl]);


  const renderAccountRow = (
    account: EnrichedAccount,
    columns: ColumnId[] = visibleColumns,
    widthFn: (c: ColumnId) => number = getColWidth,
  ) => (
    <tr key={account.id} className="hover:bg-secondary/40 transition-colors group cursor-pointer"
      onClick={() => navigate(`/account/${account.id}`)} data-testid={`row-account-${account.id}`}>
      {columns.map(col => {
        const w = widthFn(col);
        return (
          <td key={col} className="px-3 py-4 overflow-hidden text-center"
            style={{ width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` }}>
            {renderCellContent(col, account)}
          </td>
        );
      })}
    </tr>
  );

  // LIVE section drops the Profit Target column (irrelevant for funded accounts) and
  // redistributes its width across the remaining columns so the table stays balanced.
  const liveVisibleColumns = useMemo(
    () => visibleColumns.filter(c => c !== 'target'),
    [visibleColumns],
  );
  const liveExtraWidth = useMemo(() => {
    if (!visibleColumns.includes('target') || liveVisibleColumns.length === 0) return 0;
    return getColWidth('target') / liveVisibleColumns.length;
  }, [visibleColumns, liveVisibleColumns, getColWidth]);
  const getLiveColWidth = (col: ColumnId) => getColWidth(col) + liveExtraWidth;

  return (
    <div className="h-full bg-background text-foreground font-sans" dir={dir}>
      <div className="flex h-full overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 border-e border-border hidden lg:flex flex-col justify-between bg-card" dir="ltr">
          <div>
            <div className="h-16 flex items-center px-6 border-b border-border">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Vertex Command" className="w-7 h-7 rounded-md object-contain" />
                <h1 className="text-base font-semibold text-foreground">{t('app.name').toUpperCase()}</h1>
              </div>
            </div>
            <div className="px-4 py-6 space-y-1" dir={dir}>
              <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('nav.platform')}</p>
              {[
                { key: 'dashboard', icon: BarChart3, label: t('nav.dashboard') },
                { key: 'priorities', icon: Zap, label: t('nav.priorities'), feature: 'priority_engine', requiredPlan: 'pro' },
                { key: 'withdrawals', icon: CreditCard, label: t('nav.withdrawals') },
                { key: 'economicCalendar', icon: Globe, label: t('journal.economicCalendar', { defaultValue: 'יומן כלכלי' }) },
              ].map(item => {
                const locked = item.feature && !hasFeature(item.feature);
                return (
                <button key={item.key} onClick={() => locked ? handleLockedFeature(item.feature!, item.requiredPlan!) : setActivePage(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${activePage === item.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} ${locked ? 'opacity-50' : ''}`}
                  data-testid={`nav-${item.key}`}>
                  <item.icon className={`w-4 h-4 ${activePage === item.key ? 'text-primary' : ''}`} />
                  {item.label}
                  {locked && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                </button>
              );})}
            </div>
          </div>
          <div className="p-4 border-t border-border" dir={dir}>
            {(() => { const isExpired = billingStatus?.status === 'expired'; return (<>
            <button onClick={() => !isExpired && navigate('/get-started')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-get-started">
              <Zap className="w-4 h-4" /> {t('nav.getStarted', { defaultValue: 'התחל כאן' })}
            </button>
            <button onClick={() => !isExpired && (hasFeature('integrations') ? navigate('/integrations') : handleLockedFeature('integrations', 'pro'))}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${!hasFeature('integrations') || isExpired ? 'opacity-50' : ''} ${isExpired ? 'pointer-events-none' : ''}`}
              data-testid="nav-integrations">
              <Plug className="w-4 h-4" /> {t('nav.integrations')}
              {(!hasFeature('integrations') || isExpired) && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            <button onClick={() => !isExpired && navigate('/journal')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-journal">
              <LayoutDashboard className="w-4 h-4" /> {t('nav.journaling', { defaultValue: 'יומן מסחר' })}
            </button>
            <button onClick={() => !isExpired && navigate('/reports')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-reports">
              <BarChart3 className="w-4 h-4" /> {t('nav.reports')}
              {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            <button onClick={() => !isExpired && navigate('/affiliates')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-affiliates">
              <Gift className="w-4 h-4" /> {t('nav.affiliates')}
              {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            <button onClick={() => !isExpired && navigate('/partners')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-partners">
              <Handshake className="w-4 h-4" /> {t('nav.partners')}
              {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            <button onClick={() => navigate('/billing')}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              data-testid="nav-billing">
              <Crown className="w-4 h-4" /> {t('nav.billing')}
            </button>
            {user?.role === 'admin' && (
              <button onClick={() => !isExpired && navigate('/admin')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
                data-testid="nav-admin">
                <Shield className="w-4 h-4" /> {t('nav.admin')}
                {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
              </button>
            )}
            {(user?.role === 'admin' || userPlanKey === 'unlimited' || userPlanKey === 'desk') && (
              <button onClick={() => !isExpired && navigate('/latency-monitor')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
                data-testid="nav-latency-monitor">
                <Activity className="w-4 h-4" /> Latency Monitor
                {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
              </button>
            )}
            {user?.role === 'admin' && (
              <button onClick={() => !isExpired && navigate('/system-health')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
                data-testid="nav-system-health">
                <HeartPulse className="w-4 h-4" /> {t('nav.systemHealth')}
                {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
              </button>
            )}
            <button onClick={() => !isExpired && navigate('/help')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}
              data-testid="nav-help">
              <HelpCircle className="w-4 h-4" /> {t('nav.helpCenter')}
              {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            <button onClick={() => !isExpired && setActivePage('settings')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${activePage === 'settings' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} ${isExpired ? 'opacity-50 pointer-events-none' : ''}`}>
              <Settings className="w-4 h-4" /> {t('nav.settings')}
              {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
            </button>
            </>); })()}
            <button onClick={() => logout.mutate()}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-1">
              <LogOut className="w-4 h-4" /> {t('auth.logout')}
            </button>
            <div className="mt-4 flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-semibold text-foreground">{user?.name?.charAt(0) || 'U'}</div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-foreground truncate">{user?.name || t('common.user')}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.email || ''}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          {/* Header */}
          <header className="h-12 lg:h-14 flex items-center justify-between px-3 lg:px-6 border-b border-border bg-card sticky top-0 z-20">
            <div className="flex items-center gap-2 lg:hidden">
              <button onClick={() => setIsMobileSidebarOpen(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" data-testid="button-mobile-menu">
                <Menu className="w-5 h-5" />
              </button>
              <img src="/logo.png" alt="Vertex Command" className="w-6 h-6 rounded object-contain" />
              <h1 className="text-sm font-semibold">{t('app.name').toUpperCase()}</h1>
            </div>
            <div className="hidden lg:flex items-center relative w-72">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={searchInput} onChange={e => handleSearchChange(e.target.value)}
                placeholder={t('dashboard.searchPlaceholder')}
                className="w-full bg-secondary/50 border border-border rounded-full pr-9 pl-4 py-1.5 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-muted-foreground"
                data-testid="input-search" />
            </div>
            <div className="flex items-center gap-1.5 lg:gap-3">
              <button onClick={() => setMode(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="w-7 h-7 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                data-testid="button-theme-toggle">
                {resolvedTheme === 'dark' ? <Sun className="w-3.5 h-3.5 lg:w-4 lg:h-4" /> : <Moon className="w-3.5 h-3.5 lg:w-4 lg:h-4" />}
              </button>
              <LanguageSwitcher />

              <button onClick={() => setIsAlertsPanelOpen(!isAlertsPanelOpen)}
                className="w-7 h-7 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors relative"
                data-testid="button-alerts">
                <Bell className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                {unreadAlerts.length > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">{unreadAlerts.length}</span>
                )}
              </button>




              {(() => {
                const now = new Date();
                const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
                const et = new Date(etString);
                const etDay = et.getDay();
                const etMinutes = et.getHours() * 60 + et.getMinutes();
                const isOpen = !(
                  etDay === 6 ||
                  (etDay === 0 && etMinutes < 18 * 60) ||
                  (etDay === 5 && etMinutes >= 17 * 60) ||
                  (etMinutes >= 17 * 60 && etMinutes < 18 * 60)
                );
                return (
                  <div className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full ${isOpen ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`} data-testid="indicator-market-status">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isOpen ? 'bg-emerald-400' : 'bg-red-400'} opacity-75`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    </span>
                    <span className={`text-[10px] font-medium ${isOpen ? 'text-emerald-400' : 'text-red-400'}`}>{isOpen ? 'Live Market' : 'Market Closed'}</span>
                  </div>
                );
              })()}
              {execStates.some(s => s.state === "connected") && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20" data-testid="indicator-exec-stream">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  <span className="text-[10px] font-medium text-blue-400">Exec</span>
                </div>
              )}
            </div>
          </header>

          {/* Trial Banner */}
          {billingStatus?.status === 'trialing' && billingStatus.daysLeft != null && (
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 gap-2 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border-b border-amber-500/20" data-testid="trial-banner">
              <div className="flex items-center gap-2 min-w-0">
                <Timer className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-[11px] sm:text-xs font-medium text-amber-600 dark:text-amber-400">
                  {billingStatus.daysLeft <= 1 ? t('trial.bannerLastDay') : t('trial.banner', { days: billingStatus.daysLeft })}
                </span>
              </div>
              <button onClick={() => navigate('/billing')} className="text-[11px] sm:text-xs font-semibold text-indigo-500 hover:text-indigo-400 transition-colors flex-shrink-0 whitespace-nowrap" data-testid="button-upgrade-now">
                {t('trial.upgradeNow')} →
              </button>
            </div>
          )}

          {/* Alerts Slide Panel */}
          <AnimatePresence>
            {isAlertsPanelOpen && (
              <motion.div initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: "tween", duration: 0.2 }}
                className="fixed top-14 left-0 bottom-0 w-full sm:w-80 bg-card border-r border-border z-30 shadow-lg flex flex-col" dir={dir}>
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-500" /> {t('dashboard.alerts')}</h3>
                  <div className="flex items-center gap-2">
                    {unreadAlerts.length > 0 && (
                      <button onClick={() => markAllAlertsReadMutation.mutate()} className="text-[10px] text-indigo-500 hover:underline" data-testid="button-mark-all-read">{t('dashboard.markAllRead')}</button>
                    )}
                    <button onClick={() => { setIsAlertsPanelOpen(false); setSelectedAlerts(new Set()); }} className="text-muted-foreground hover:text-foreground"><XCircle className="w-4 h-4" /></button>
                  </div>
                </div>
                {alertsList.length > 0 && (
                  <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                    <button
                      onClick={() => {
                        if (selectedAlerts.size === alertsList.length) setSelectedAlerts(new Set());
                        else setSelectedAlerts(new Set(alertsList.map(a => a.id)));
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="button-select-all-alerts"
                    >
                      {selectedAlerts.size === alertsList.length ? t('dashboard.deselectAll') : t('dashboard.selectAll')}
                    </button>
                    {selectedAlerts.size > 0 && (
                      <button
                        onClick={() => deleteBulkAlertsMutation.mutate(Array.from(selectedAlerts))}
                        className="text-[10px] text-red-500 hover:text-red-400 flex items-center gap-1 font-medium transition-colors"
                        data-testid="button-delete-selected-alerts"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t('dashboard.deleteSelected')} ({selectedAlerts.size})
                      </button>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {alertsList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <CheckCircle2 className="w-8 h-8 mb-2" /><p className="text-sm">{t('dashboard.noAlerts')}</p>
                    </div>
                  ) : alertsList.map(alert => {
                    const severityColors: Record<string, string> = { low: 'border-blue-500/20', medium: 'border-amber-500/20', high: 'border-orange-500/20', critical: 'border-red-500/20' };
                    const isSelected = selectedAlerts.has(alert.id);
                    return (
                      <div key={alert.id}
                        className={`p-3 rounded-lg border ${severityColors[alert.severity] || ''} ${isSelected ? 'ring-1 ring-indigo-500/40 bg-indigo-500/5' : !alert.read ? 'bg-secondary/50' : 'bg-transparent'} transition-colors hover:bg-secondary/30 group`}
                        data-testid={`alert-${alert.id}`}>
                        <div className="flex items-start gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedAlerts(prev => { const next = new Set(prev); if (next.has(alert.id)) next.delete(alert.id); else next.add(alert.id); return next; }); }}
                            className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-muted-foreground/40 hover:border-indigo-400'}`}
                            data-testid={`alert-select-${alert.id}`}
                          >
                            {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </button>
                          <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${alert.severity === 'high' || alert.severity === 'critical' ? 'text-red-500' : alert.severity === 'medium' ? 'text-amber-500' : 'text-blue-500'}`} />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { if (!alert.read) markAlertReadMutation.mutate(alert.id); }}>
                            <p className="text-xs text-foreground leading-relaxed">{alert.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 font-mono" dir="ltr">
                              {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString(getDateLocale(i18n.language)) : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {!alert.read && <div className="w-2 h-2 bg-indigo-500 rounded-full mt-1" />}
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteAlertMutation.mutate(alert.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all"
                              data-testid={`alert-delete-${alert.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Withdrawal Dialogs */}
          <Dialog open={isWithdrawalListOpen} onOpenChange={setIsWithdrawalListOpen}>
            <DialogContent className="max-w-3xl bg-card border-border shadow-lg p-0 gap-0" dir={dir}>
              <DialogHeader className="p-5 pb-4 border-b border-border">
                <DialogTitle className="text-lg font-semibold flex items-center gap-2"><Award className="w-4 h-4 text-purple-500" /> {t('withdrawal.tracking')}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto">
                {withdrawalsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16"><Award className="w-8 h-8 text-muted-foreground mb-3" /><p className="text-sm text-muted-foreground">{t('withdrawal.none')}</p></div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right min-w-[600px]">
                    <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold sticky top-0">
                      <tr>
                        <th className="px-4 py-3 font-medium">{t('dashboard.account')}</th>
                        <th className="px-4 py-3 font-medium">{t('dashboard.firm')}</th>
                        <th className="px-4 py-3 font-medium text-left" dir="ltr">{t('withdrawal.amount')}</th>
                        <th className="px-4 py-3 font-medium">{t('withdrawal.dateRequested')}</th>
                        <th className="px-4 py-3 font-medium text-center">{t('withdrawal.status')}</th>
                        <th className="px-4 py-3 font-medium">{t('withdrawal.notes')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {withdrawalsList.map(w => {
                        const statusStyles: Record<string, string> = {
                          pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                          approved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
                          paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                          rejected: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                        };
                        return (
                          <tr key={w.id} className="hover:bg-secondary/40 transition-colors group">
                            <td className="px-4 py-3 text-foreground font-medium text-xs">{w.accountName}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">{w.firm}</td>
                            <td className="px-4 py-3 font-mono text-sm font-medium text-emerald-600 dark:text-emerald-400 text-left" dir="ltr">+{formatCurrency(w.amount)}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs font-mono" dir="ltr">{w.dateRequested}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusStyles[w.status] || ''}`}>
                                {t(`withdrawal.status${w.status.charAt(0).toUpperCase() + w.status.slice(1)}`)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">{w.notes || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>


          {/* Page Content */}
          <div className="flex-1 overflow-auto p-3 lg:p-6 space-y-4 lg:space-y-6 pb-20 lg:pb-6">
            {(activePage === 'dashboard' || activePage === 'accounts' || activePage === 'alerts') && (
              <>
                {activePage === 'dashboard' && (
                  <div className="space-y-6 mb-6">
                    <section>
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3" data-testid="text-for-you-title">
                        {t("home.forYou", { defaultValue: "עבורך" })}
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <Card className="bg-card border-border hover:border-indigo-500/30 transition-colors cursor-pointer" onClick={() => navigate("/integrations")} data-testid="card-promo-connection">
                          <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
                              <Plug className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{t("home.addConnection", { defaultValue: "הוסף חיבור" })}</p>
                              <p className="text-xs text-muted-foreground">{t("home.addConnectionDesc", { defaultValue: "חבר את חשבון הברוקר הראשון שלך" })}</p>
                            </div>
                            <Plus className="w-4 h-4 text-muted-foreground" />
                          </CardContent>
                        </Card>
                        <Card className="bg-card border-border hover:border-emerald-500/30 transition-colors cursor-pointer" onClick={() => navigate("/copy-trading")} data-testid="card-promo-copy">
                          <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                              <Copy className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{t("home.startCopy", { defaultValue: "קופי טריידינג" })}</p>
                              <p className="text-xs text-muted-foreground">{t("home.startCopyDesc", { defaultValue: "העתק עסקאות בין חשבונות אוטומטית" })}</p>
                            </div>
                            <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                          </CardContent>
                        </Card>
                        <Card className="bg-card border-border hover:border-amber-500/30 transition-colors cursor-pointer" onClick={() => navigate("/journal")} data-testid="card-promo-journal">
                          <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                              <BookOpen className="w-5 h-5 text-amber-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{t("home.journal", { defaultValue: "יומן מסחר" })}</p>
                              <p className="text-xs text-muted-foreground">{t("home.journalDesc", { defaultValue: "תעד ונתח את העסקאות שלך" })}</p>
                            </div>
                            <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                          </CardContent>
                        </Card>
                      </div>
                    </section>

                    <section dir="ltr" className="w-full">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3" data-testid="text-instruments-title">
                        Most Traded
                      </h2>
                      <div className="w-full grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 auto-rows-fr" data-testid="container-instruments">
                        {homePrices.map((inst) => {
                          const isPositive = inst.changePercent >= 0;
                          return (
                            <div
                              key={inst.symbol}
                              className="group relative w-full h-full rounded-xl p-3 bg-card border border-border hover:border-foreground/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between"
                              data-testid={`card-instrument-${inst.symbol}`}
                            >
                              <div className="flex items-center gap-2.5 mb-2.5">
                                <inst.Icon
                                  className="w-6 h-6 flex-shrink-0"
                                  strokeWidth={2}
                                  style={{ color: inst.indicatorColor }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div
                                    className="text-[13px] font-bold text-foreground leading-tight tracking-tight"
                                    data-testid={`text-symbol-${inst.symbol}`}
                                  >
                                    {inst.display}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                                    {inst.name}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-auto">
                                <div
                                  className="text-base font-bold text-foreground tabular-nums"
                                  data-testid={`text-price-${inst.symbol}`}
                                >
                                  {inst.price.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </div>

                                <div
                                  className={`text-[11px] font-semibold tabular-nums mt-1 flex items-center gap-1 ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                                  data-testid={`text-change-${inst.symbol}`}
                                >
                                  <span>
                                    {isPositive ? "+" : ""}
                                    {inst.change.toFixed(2)}
                                  </span>
                                  <span className="opacity-80">
                                    ({isPositive ? "+" : ""}
                                    {inst.changePercent.toFixed(2)}%)
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                  </div>
                )}

                <AnimatePresence>
                  {isCustomizing && (
                    <motion.div
                      initial={{ opacity: 0, y: -12, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -12, height: 0 }}
                      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <LayoutDashboard className="w-4 h-4 text-indigo-500" />
                          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{t('dashboard.widgets.customizeHint')}</span>
                        </div>
                        <button onClick={resetLayout} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors" data-testid="button-reset-layout">
                          <RotateCcw className="w-3 h-3" /> {t('dashboard.widgets.reset')}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {activePage === 'dashboard' && (
                  <div className="flex items-center justify-between w-full px-1 py-2" data-testid="last-import-row">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-muted-foreground/70">{t('dashboard.lastImport.label')}:</span>
                      <span className="text-sm text-muted-foreground">
                        {isSyncingAll
                          ? `${t('dashboard.syncAll.syncing')} (${syncProgress.done}/${syncProgress.total})`
                          : lastImportDate
                            ? lastImportDate.toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : t('dashboard.lastImport.never')}
                      </span>
                      <span
                        onClick={isSyncLocked || isSyncingAll
                          ? undefined
                          : activeConnections.length === 0
                            ? () => { toast({ title: t('dashboard.syncAll.noConnections'), description: t('dashboard.syncAll.noConnectionsDesc') }); navigate('/integrations'); }
                            : handleSyncAll}
                        className={`text-sm font-bold select-none transition-all duration-200 ${
                          isSyncLocked || isSyncingAll
                            ? 'text-muted-foreground/40 cursor-not-allowed'
                            : 'text-indigo-500 hover:text-indigo-400 active:text-indigo-600 cursor-pointer'
                        }`}
                        data-testid="button-sync-all"
                      >
                        {isSyncingAll
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin inline-block" />
                          : isSyncLocked ? 'Resync' : 'Sync'}
                      </span>
                    </div>
                    <button
                      className={`flex items-center gap-1.5 text-xs font-medium select-none transition-all duration-200 ${
                        isCustomizing
                          ? 'text-indigo-500'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setIsCustomizing(!isCustomizing)}
                      data-testid="button-customize-widgets"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div data-testid="widget-kpi-locked">
                  <AnimatePresence>
                    {isCustomizing && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <Lock className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-xs font-medium text-muted-foreground flex-1">{WIDGET_LABELS.kpi}</span>
                          <span className="text-[10px] text-indigo-500 font-medium">{t('dashboard.widgets.locked')}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <motion.div
                    animate={{
                      outline: isCustomizing ? "1px dashed rgba(99,102,241,0.3)" : "0px dashed transparent",
                      borderRadius: isCustomizing ? 8 : 0,
                    }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 lg:gap-4">
                      {[
                        { label: t('dashboard.kpi.totalPnl'), value: formatPnl(totalProfit, totalSize), icon: TrendingUp, color: totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500', sub: `${accounts.length} ${t('dashboard.accounts')}` },
                        { label: t('dashboard.kpi.managedCapital'), value: formatCurrency(totalSize), icon: Briefcase, color: 'text-indigo-500', sub: formatCurrency(totalEquity) + ' ' + t('dashboard.kpi.equity') },
                        { label: t('dashboard.kpi.totalWithdrawals'), value: formatCurrency(totalWithdrawals), icon: CreditCard, color: 'text-purple-500', sub: `${pendingWithdrawals.length} ${t('dashboard.kpi.pending')}`, onClick: () => setIsWithdrawalListOpen(true) },
                      ].map((card, i) => (
                        <div key={i} onClick={card.onClick}
                          className={`bg-card p-3 lg:p-4 rounded-lg border border-border ${card.onClick ? 'cursor-pointer hover:border-indigo-500/30 transition-colors' : ''}`}
                          data-testid={`kpi-card-${i}`}>
                          <div className="flex items-center justify-between mb-1 lg:mb-2">
                            <span className="text-[9px] lg:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">{card.label}</span>
                            <card.icon className={`w-3.5 h-3.5 lg:w-4 lg:h-4 ${card.color} flex-shrink-0`} />
                          </div>
                          <p className={`text-base lg:text-xl font-bold font-mono ${card.color}`} dir="ltr">{card.value}</p>
                          <p className="text-[9px] lg:text-[10px] text-muted-foreground mt-0.5 lg:mt-1">{card.sub}</p>
                          {i === 2 && pendingWithdrawals.length > 0 && card.onClick && (
                            <Badge className="mt-1 lg:mt-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[9px]">{pendingWithdrawals.length} {t('dashboard.kpi.pending')}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>

                {tradeStats && tradeStats.totalTrades > 0 && (
                  <div className="grid grid-cols-4 gap-2 lg:gap-4" data-testid="trade-stats-row">
                    {[
                      { label: t('dashboard.stats.tradeWin'), value: tradeStats.tradeWinRate, sub: `${tradeStats.winTrades}/${tradeStats.totalTrades} ${t('dashboard.stats.trades')}`, isPercent: true, color: tradeStats.tradeWinRate >= 50 ? '#10b981' : '#ef4444' },
                      { label: t('dashboard.stats.profitFactor'), value: tradeStats.profitFactor, sub: `$${tradeStats.avgWin.toFixed(0)} / $${tradeStats.avgLoss.toFixed(0)}`, isPercent: false, color: tradeStats.profitFactor >= 1 ? '#10b981' : '#ef4444', max: 5 },
                      { label: t('dashboard.stats.dayWin'), value: tradeStats.dayWinRate, sub: `${tradeStats.winDays}/${tradeStats.totalDays} ${t('dashboard.stats.days')}`, isPercent: true, color: tradeStats.dayWinRate >= 50 ? '#10b981' : '#ef4444' },
                      { label: t('dashboard.stats.avgWinLoss'), value: tradeStats.avgLoss > 0 ? Math.round((tradeStats.avgWin / tradeStats.avgLoss) * 100) / 100 : 0, sub: `${t('dashboard.stats.win')}: $${tradeStats.avgWin.toFixed(0)} | ${t('dashboard.stats.loss')}: -$${tradeStats.avgLoss.toFixed(0)}`, isPercent: false, color: tradeStats.avgWin >= tradeStats.avgLoss ? '#10b981' : '#ef4444', max: 5 },
                    ].map((stat, i) => {
                      const pct = stat.isPercent ? stat.value / 100 : Math.min(stat.value / (stat.max || 5), 1);
                      const radius = 36;
                      const strokeWidth = 6;
                      const circumference = Math.PI * radius;
                      const dashOffset = circumference * (1 - pct);
                      return (
                        <div key={i} className="bg-card rounded-lg border border-border p-3 lg:p-4 flex flex-col items-center" data-testid={`stat-card-${i}`}>
                          <span className="text-[9px] lg:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{stat.label}</span>
                          <div className="relative w-[84px] h-[48px]">
                            <svg width="84" height="48" viewBox="0 0 84 48">
                              <path
                                d={`M ${42 - radius} 44 A ${radius} ${radius} 0 0 1 ${42 + radius} 44`}
                                fill="none"
                                stroke="currentColor"
                                className="text-muted/20"
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                              />
                              <path
                                d={`M ${42 - radius} 44 A ${radius} ${radius} 0 0 1 ${42 + radius} 44`}
                                fill="none"
                                stroke={stat.color}
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={dashOffset}
                                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-end justify-center pb-0">
                              <span className="text-sm lg:text-base font-bold" style={{ color: stat.color }} dir="ltr">
                                {stat.isPercent ? `${stat.value}%` : stat.value.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <span className="text-[9px] lg:text-[10px] text-muted-foreground mt-1 text-center" dir="ltr">{stat.sub}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div data-testid="widget-accounts-locked">
                  <AnimatePresence>
                    {isCustomizing && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <Lock className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-xs font-medium text-muted-foreground flex-1">{WIDGET_LABELS.accounts}</span>
                          <span className="text-[10px] text-indigo-500 font-medium">{t('dashboard.widgets.locked')}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <motion.div
                    animate={{
                      outline: isCustomizing ? "1px dashed rgba(99,102,241,0.3)" : "0px dashed transparent",
                      borderRadius: isCustomizing ? 8 : 0,
                    }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 sm:h-8 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-border" data-testid="button-filter">
                                <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                {(selectedFirms.length + selectedStages.length) > 0 && (
                                  <Badge className="bg-indigo-500/10 text-indigo-500 border-indigo-500/20 text-[9px] px-1.5">{selectedFirms.length + selectedStages.length}</Badge>
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56 bg-card border-border">
                              <DropdownMenuLabel>{t('dashboard.firms')}</DropdownMenuLabel>
                              {allFirms.map(firm => (
                                <DropdownMenuCheckboxItem key={firm} checked={selectedFirms.includes(firm)} onCheckedChange={() => setSelectedFirms(prev => prev.includes(firm) ? prev.filter(f => f !== firm) : [...prev, firm])}>{firm}</DropdownMenuCheckboxItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>{t('dashboard.stages')}</DropdownMenuLabel>
                              {STAGE_KEYS.map(key => (
                                <DropdownMenuCheckboxItem key={key} checked={selectedStages.includes(key)} onCheckedChange={() => setSelectedStages(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])}>{t(`phases.${key}`)}</DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {(selectedFirms.length + selectedStages.length) > 0 && (
                            <button onClick={() => { setSelectedFirms([]); setSelectedStages([]); setSelectedStatuses([]); }} className="text-[10px] sm:text-xs text-muted-foreground hover:text-foreground">{t('dashboard.clearAll')}</button>
                          )}
                          <Button variant="outline" size="sm" className="h-7 sm:h-8 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-border" onClick={cyclePnlMode} data-testid="button-pnl-mode">
                            <span className="font-semibold text-[10px] sm:text-[11px] w-4 sm:w-5 text-center">{pnlDisplayMode === 'usd' ? '$' : pnlDisplayMode === 'eur' ? '€' : '%'}</span>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 sm:h-8 text-[10px] sm:text-xs gap-1 sm:gap-1.5 border-border" data-testid="button-columns-toggle">
                                <Settings className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="bg-card border-border min-w-[160px]">
                              <DropdownMenuLabel>{t('dashboard.columns')}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {ALL_COLUMNS.filter(c => !ALWAYS_VISIBLE.includes(c)).map(col => (
                                <DropdownMenuCheckboxItem key={col} checked={isColVisible(col)} onCheckedChange={() => toggleColumn(col)}>
                                  {getColumnLabel(col, t)}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="bg-secondary/50 rounded-lg p-0.5 flex items-center border border-border">
                            <button onClick={() => setIsGroupedView(true)}
                              className={`px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors ${isGroupedView ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                              data-testid="button-grouped-view">{t('dashboard.byFirm')}</button>
                            <button onClick={() => setIsGroupedView(false)}
                              className={`px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-colors ${!isGroupedView ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                              data-testid="button-flat-view">{t('dashboard.list')}</button>
                          </div>
                        </div>
                      </div>

                      {filteredLiveAccounts.length > 0 && (
                        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-lg border-2 border-amber-400/40 overflow-hidden shadow-lg shadow-amber-400/10" data-testid="section-live-accounts">
                          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent border-b border-amber-400/20">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/30">
                              <Zap className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-xs sm:text-sm font-extrabold text-amber-600 dark:text-amber-300 tracking-wide">{t('dashboard.fundedLiveAccounts')}</span>
                            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-200 border-amber-400/40 text-[9px] sm:text-[10px] flex-shrink-0">
                              {filteredLiveAccounts.length}
                            </Badge>
                          </div>
                          <div className="px-2 sm:px-3 py-2 space-y-2">
                            {Object.entries(groupedLiveAccounts).map(([firm, data]) => (
                              <div key={firm} className="bg-background/50 rounded-lg border border-amber-400/20 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-amber-500/5">
                                  <Building className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                  <span className="text-[11px] sm:text-xs font-semibold text-muted-foreground truncate" dir="ltr">{firm}</span>
                                  <Badge variant="outline" className="text-[9px] border-amber-400/30 text-amber-600 dark:text-amber-300 flex-shrink-0">{data.accounts.length}</Badge>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="text-center min-w-[700px] w-full" style={{ tableLayout: 'fixed' }}>
                                    <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                                      <tr>
                                        {liveVisibleColumns.map(col => (
                                          <DraggableColumnHeader key={col} col={col} label={getColumnLabel(col, t)} width={getLiveColWidth(col)} onResize={handleColumnResize} onDragStart={handleColDragStart} onDragOver={handleColDragOver} onDrop={handleColDrop} dragOverCol={dragOverCol} />
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">{data.accounts.map(a => renderAccountRow(a, liveVisibleColumns, getLiveColWidth))}</tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}

                      {isGroupedView ? (
                        Object.entries(groupedAccounts).map(([firm, data]) => (
                          <motion.div key={firm} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-lg border border-border overflow-hidden">
                            <button onClick={() => setExpandedFirms(prev => ({ ...prev, [firm]: !prev[firm] }))}
                              className="w-full flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 hover:bg-secondary/30 transition-colors" data-testid={`button-expand-${firm}`}>
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <Building className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                                <span className="text-xs sm:text-sm font-semibold truncate" dir="ltr">{firm}</span>
                                <Badge variant="outline" className="text-[9px] sm:text-[10px] border-border flex-shrink-0">{data.accounts.length}</Badge>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                                <span className={`text-xs sm:text-sm font-mono font-semibold ${data.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">{formatPnl(data.totalProfit, data.totalSize)}</span>
                                {expandedFirms[firm] ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                              </div>
                            </button>
                            <AnimatePresence>
                              {expandedFirms[firm] && (
                                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                                 <div className="overflow-x-auto">
                                  <table className="text-center min-w-[700px]" style={{ tableLayout: 'fixed' }}>
                                    <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                                      <tr>
                                        {visibleColumns.map(col => (
                                          <DraggableColumnHeader key={col} col={col} label={getColumnLabel(col, t)} width={getColWidth(col)} onResize={handleColumnResize} onDragStart={handleColDragStart} onDragOver={handleColDragOver} onDrop={handleColDrop} dragOverCol={dragOverCol} />
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">{data.accounts.map(a => renderAccountRow(a))}</tbody>
                                  </table>
                                 </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        ))
                      ) : (
                        <div className="bg-card rounded-lg border border-border overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="text-center min-w-[700px]" style={{ tableLayout: 'fixed' }}>
                              <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                                <tr>
                                  {visibleColumns.map(col => (
                                    <DraggableColumnHeader key={col} col={col} label={getColumnLabel(col, t)} width={getColWidth(col)} onResize={handleColumnResize} onDragStart={handleColDragStart} onDragOver={handleColDragOver} onDrop={handleColDrop} dragOverCol={dragOverCol} />
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">{filteredAccounts.map(a => renderAccountRow(a))}</tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {filteredPassedAccounts.length > 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-lg border border-emerald-500/20 overflow-hidden">
                          <button onClick={() => setIsPassedSectionOpen(prev => !prev)}
                            className="w-full flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 hover:bg-emerald-500/5 transition-colors" data-testid="button-expand-passed">
                            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                              <Trophy className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                              <span className="text-xs sm:text-sm font-semibold text-emerald-500">{t('dashboard.completedEvaluations')}</span>
                              <Badge variant="outline" className="text-[9px] sm:text-[10px] border-emerald-500/30 text-emerald-500 flex-shrink-0">{filteredPassedAccounts.length}</Badge>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isPassedSectionOpen ? <ChevronUp className="w-4 h-4 text-emerald-400" /> : <ChevronDown className="w-4 h-4 text-emerald-400" />}
                            </div>
                          </button>
                          <AnimatePresence>
                            {isPassedSectionOpen && (
                              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                                <div className="border-t border-emerald-500/10 px-2 sm:px-3 py-2 space-y-2">
                                  {Object.entries(groupedPassedAccounts).map(([firm, data]) => (
                                    <div key={firm} className="bg-background/50 rounded-lg border border-border/50 overflow-hidden">
                                      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-secondary/20">
                                        <Building className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                        <span className="text-[11px] sm:text-xs font-semibold text-muted-foreground truncate" dir="ltr">{firm}</span>
                                        <Badge variant="outline" className="text-[9px] border-border flex-shrink-0">{data.accounts.length}</Badge>
                                        <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[9px] gap-1 ms-auto">
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          {t('dashboard.passedBadge')}
                                        </Badge>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="text-center min-w-[700px]" style={{ tableLayout: 'fixed' }}>
                                          <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                                            <tr>
                                              {visibleColumns.map(col => (
                                                <DraggableColumnHeader key={col} col={col} label={getColumnLabel(col, t)} width={getColWidth(col)} onResize={handleColumnResize} onDragStart={handleColDragStart} onDragOver={handleColDragOver} onDrop={handleColDrop} dragOverCol={dragOverCol} />
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border/30">{data.accounts.map(a => renderAccountRow(a))}</tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}

                      {filteredFailedAccounts.length > 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-lg border border-red-500/20 overflow-hidden">
                          <button onClick={() => setIsFailedSectionOpen(prev => !prev)}
                            className="w-full flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 hover:bg-red-500/5 transition-colors" data-testid="button-expand-failed">
                            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                              <span className="text-xs sm:text-sm font-semibold text-red-500">{t('dashboard.failedAccounts')}</span>
                              <Badge variant="outline" className="text-[9px] sm:text-[10px] border-red-500/30 text-red-500 flex-shrink-0">{filteredFailedAccounts.length}</Badge>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isFailedSectionOpen ? <ChevronUp className="w-4 h-4 text-red-400" /> : <ChevronDown className="w-4 h-4 text-red-400" />}
                            </div>
                          </button>
                          <AnimatePresence>
                            {isFailedSectionOpen && (
                              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                                <div className="border-t border-red-500/10 px-2 sm:px-3 py-2 space-y-2">
                                  {Object.entries(groupedFailedAccounts).map(([firm, data]) => (
                                    <div key={firm} className="bg-background/50 rounded-lg border border-border/50 overflow-hidden">
                                      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-secondary/20">
                                        <Building className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                        <span className="text-[11px] sm:text-xs font-semibold text-muted-foreground truncate" dir="ltr">{firm}</span>
                                        <Badge variant="outline" className="text-[9px] border-border flex-shrink-0">{data.accounts.length}</Badge>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="text-center min-w-[700px]" style={{ tableLayout: 'fixed' }}>
                                          <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                                            <tr>
                                              {visibleColumns.map(col => (
                                                <DraggableColumnHeader key={col} col={col} label={getColumnLabel(col, t)} width={getColWidth(col)} onResize={handleColumnResize} onDragStart={handleColDragStart} onDragOver={handleColDragOver} onDrop={handleColDrop} dragOverCol={dragOverCol} />
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border/30">{data.accounts.map(a => renderAccountRow(a))}</tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </div>

                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3 border-b border-border/50">
                    <CalendarDays className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold">{t('dashboard.widgets.calendar', { defaultValue: 'לוח שנה' })}</span>
                  </div>
                  <div className="p-2 sm:p-3">
                    <TradeCalendar accounts={allAccounts?.map((acc: any) => ({ id: acc.id, name: acc.name }))} />
                  </div>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={widgets.map(w => w.id)} strategy={verticalListSortingStrategy}>
                    {widgets.map(widget => {
                      if (widget.id === "pnlChart") {
                        const firmWidget = widgets.find(w => w.id === "firmDistribution");
                        const bothVisible = firmWidget && widget.visible && firmWidget.visible;
                        return (
                          <div key="pnl-firm-row" className={bothVisible ? "grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4" : "space-y-4"}>
                            <SortableWidget key={widget.id} id={widget.id} isCustomizing={isCustomizing} visible={widget.visible} label={WIDGET_LABELS[widget.id]} onToggleVisibility={toggleVisibility}>
                              <div className="bg-card p-2.5 sm:p-3 lg:p-5 rounded-lg border border-border h-full">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <div className="flex items-center bg-secondary rounded-lg p-0.5">
                                <button
                                  onClick={() => setChartDisplayMode("usd")}
                                  className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${chartDisplayMode === "usd" ? "bg-background shadow-sm text-indigo-500 dark:text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                  data-testid="chart-display-usd"
                                >$</button>
                                <button
                                  onClick={() => setChartDisplayMode("pct")}
                                  className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${chartDisplayMode === "pct" ? "bg-background shadow-sm text-indigo-500 dark:text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                  data-testid="chart-display-pct"
                                >%</button>
                              </div>
                              <div className="flex items-center bg-secondary rounded-lg p-0.5">
                                {(["1d", "1w", "1m", "3m"] as const).map(p => (
                                  <button key={p} onClick={() => setChartPeriod(p)} className={`px-1.5 sm:px-2 py-1 rounded-md text-[9px] sm:text-[10px] font-medium transition-all ${chartPeriod === p ? "bg-background text-indigo-500 dark:text-indigo-400" : "text-muted-foreground"}`} data-testid={`chart-period-${p}`}>
                                    {t(`dashboard.chart.period${p === "1d" ? "1D" : p === "1w" ? "1W" : p === "1m" ? "1M" : "3M"}`)}
                                  </button>
                                ))}
                              </div>
                              <button
                                onClick={() => setShowChartBoundaries(v => !v)}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all duration-200 ${
                                  showChartBoundaries
                                    ? "border-indigo-400/50 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400"
                                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                                }`}
                                data-testid="chart-boundaries-toggle"
                              >
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                                  showChartBoundaries ? "border-indigo-400 bg-indigo-500 dark:bg-indigo-500" : "border-muted-foreground/40"
                                }`}>
                                  {showChartBoundaries && (
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                                {t('dashboard.chart.boundaries')}
                              </button>
                            </div>

                            {equityCurveAccounts.length > 0 && (() => {
                              const current = equityCurveAccounts[pnlChartIndex] || equityCurveAccounts[0];
                              if (!current) return null;
                              const pnl = current.pnl;
                              const isUp = pnl >= 0;
                              const pnlPct = current.startSize > 0 ? Math.round((pnl / current.startSize) * 10000) / 100 : 0;
                              return (
                                <>
                                  <div className="flex items-center justify-between mb-3">
                                    <button data-testid="pnl-chart-prev" onClick={() => setPnlChartIndex(i => (i - 1 + equityCurveAccounts.length) % equityCurveAccounts.length)} className="p-1 rounded-md hover:bg-secondary transition-colors"><ChevronRight className="w-4 h-4 text-muted-foreground" /></button>
                                    <div className="text-center flex-1 min-w-0"><h3 className="text-xs lg:text-sm font-semibold text-foreground truncate" data-testid="pnl-chart-account-name">{current.accountName}</h3></div>
                                    <button data-testid="pnl-chart-next" onClick={() => setPnlChartIndex(i => (i + 1) % equityCurveAccounts.length)} className="p-1 rounded-md hover:bg-secondary transition-colors"><ChevronLeft className="w-4 h-4 text-muted-foreground" /></button>
                                  </div>
                                  <div className="flex justify-center gap-1 mb-3">
                                    {equityCurveAccounts.map((_, i) => (
                                      <button key={i} data-testid={`pnl-chart-dot-${i}`} onClick={() => setPnlChartIndex(i)} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === pnlChartIndex ? 'bg-indigo-400' : 'bg-muted-foreground/40'}`} />
                                    ))}
                                  </div>
                                  <EquityCurveChart
                                    key={`equity-${current.accountId}-${chartPeriod}-${resolvedTheme}-${chartDisplayMode}-${showChartBoundaries}`}
                                    data={current.data}
                                    startSize={current.startSize}
                                    target={current.target}
                                    maxDrawdown={current.maxDrawdown}
                                    isUp={isUp}
                                    period={chartPeriod}
                                    theme={resolvedTheme}
                                    showBoundaries={showChartBoundaries}
                                    displayMode={chartDisplayMode}
                                  />
                                  <div className="flex items-center justify-between mt-2 px-1">
                                    <div className="flex items-center gap-1.5">
                                      <div className={`w-2 h-2 rounded-full ${isUp ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                      <span className={`text-xs font-mono font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
                                        {chartDisplayMode === "pct"
                                          ? `${isUp ? '+' : ''}${pnlPct}%`
                                          : `$${current.currentBalance.toLocaleString()}`}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">{chartDisplayMode === "pct" ? t('dashboard.chart.pnlPercent') : t('dashboard.chart.balance')}</span>
                                    </div>
                                    <span className={`text-xs font-mono font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`} dir="ltr">
                                      {chartDisplayMode === "pct"
                                        ? `$${current.currentBalance.toLocaleString()}`
                                        : `${isUp ? '+' : ''}${pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}
                              </div>
                            </SortableWidget>
                            {firmWidget && (
                              <SortableWidget key={firmWidget.id} id={firmWidget.id} isCustomizing={isCustomizing} visible={firmWidget.visible} label={WIDGET_LABELS[firmWidget.id]} onToggleVisibility={toggleVisibility}>
                                <div className="bg-card p-3 lg:p-5 rounded-lg border border-border h-full lg:w-56 xl:w-64">
                                  <h3 className="text-xs lg:text-sm font-semibold mb-3 lg:mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-indigo-500" /> {t('dashboard.firmDistribution')}</h3>
                                  <div className="flex flex-col items-center gap-3">
                                    <div className="h-36 lg:h-44 w-36 lg:w-44 flex-shrink-0">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                          <Pie data={firmDistribution} cx="50%" cy="50%" outerRadius={50} innerRadius={20} dataKey="value" labelLine={false}>
                                            {firmDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                          </Pie>
                                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                                        </PieChart>
                                      </ResponsiveContainer>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                      {firmDistribution.map((item, i) => (
                                        <div key={item.name} className="flex items-center gap-2 text-[10px] lg:text-xs">
                                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                          <span className="text-muted-foreground truncate" dir="ltr">{item.name}</span>
                                          <span className="font-mono font-medium text-foreground mr-auto">{item.value}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </SortableWidget>
                            )}
                          </div>
                        );
                      }

                      if (widget.id === "firmDistribution") return null;

                      if (widget.id === "calendar") return null;

                      if (widget.id === "economicCalendar") return (
                        <SortableWidget key={widget.id} id={widget.id} isCustomizing={isCustomizing} visible={widget.visible} label={WIDGET_LABELS[widget.id]} onToggleVisibility={toggleVisibility}>
                          {(() => {
                            const now = new Date();
                            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                            const toLocalDateStr = (d: Date) =>
                              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                            const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                            const dayOfWeek = todayDate.getDay();
                            const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                            const thisMonday = new Date(todayDate);
                            thisMonday.setDate(todayDate.getDate() + mondayOffset);
                            const thisSunday = new Date(thisMonday);
                            thisSunday.setDate(thisMonday.getDate() + 6);
                            const nextMonday = new Date(thisMonday);
                            nextMonday.setDate(thisMonday.getDate() + 7);
                            const nextSunday = new Date(nextMonday);
                            nextSunday.setDate(nextMonday.getDate() + 6);

                            const thisWeekStart = toLocalDateStr(thisMonday);
                            const thisWeekEnd = toLocalDateStr(thisSunday);
                            const nextWeekStart = toLocalDateStr(nextMonday);
                            const nextWeekEnd = toLocalDateStr(nextSunday);

                            const countryFiltered = econEvents.filter(e => econCountries.has(e.country));
                            const periodFiltered = countryFiltered.filter(e => {
                              if (!e.date) return false;
                              const d = new Date(e.date);
                              if (isNaN(d.getTime())) return false;
                              const dateStr = toLocalDateStr(d);
                              if (econPeriod === "today") return dateStr === todayStr;
                              if (econPeriod === "nextWeek") return dateStr >= nextWeekStart && dateStr <= nextWeekEnd;
                              return dateStr >= thisWeekStart && dateStr <= thisWeekEnd;
                            });
                            const filtered = econFilter === "high"
                              ? periodFiltered.filter(e => e.impact === "High")
                              : periodFiltered;

                            const grouped: Record<string, EconEvent[]> = {};
                            for (const ev of filtered) {
                              if (!ev.date) continue;
                              const d = new Date(ev.date);
                              if (isNaN(d.getTime())) continue;
                              const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                              if (!grouped[dateKey]) grouped[dateKey] = [];
                              grouped[dateKey].push(ev);
                            }
                            const sortedDates = Object.keys(grouped).sort();

                            const impactDot = (impact: EconImpact) => {
                              switch (impact) {
                                case "High": return "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]";
                                case "Medium": return "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]";
                                case "Low": return "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]";
                                case "Holiday": return "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.4)]";
                              }
                            };

                            const impactBg = (impact: EconImpact) => {
                              switch (impact) {
                                case "High": return "bg-red-500/10 border-red-500/30 text-red-400";
                                case "Medium": return "bg-amber-500/10 border-amber-500/30 text-amber-400";
                                case "Low": return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
                                case "Holiday": return "bg-blue-400/10 border-blue-400/30 text-blue-400";
                              }
                            };

                            const impactLabel = (impact: EconImpact) => {
                              switch (impact) {
                                case "High": return t('dashboard.econ.high');
                                case "Medium": return t('dashboard.econ.medium');
                                case "Low": return t('dashboard.econ.low');
                                case "Holiday": return t('dashboard.econ.holiday');
                              }
                            };

                            const countryFlag = (country: string) => {
                              const found = ECON_COUNTRIES.find(c => c.code === country);
                              return found?.flag || "🌐";
                            };

                            const appLocale = i18n.language || 'en';
                            const formatEventTime = (dateStr: string) => {
                              try {
                                const d = new Date(dateStr);
                                if (isNaN(d.getTime())) return "";
                                return d.toLocaleTimeString(appLocale, { hour: '2-digit', minute: '2-digit' });
                              } catch { return ""; }
                            };

                            const formatDayLabel = (dateStr: string) => {
                              try {
                                const d = new Date(dateStr + "T12:00:00");
                                const dayName = d.toLocaleDateString(appLocale, { weekday: 'long' });
                                const dayNum = d.getDate();
                                const monthName = d.toLocaleDateString(appLocale, { month: 'short' });
                                return `${dayName}, ${dayNum} ${monthName}`;
                              } catch { return dateStr; }
                            };

                            const highCount = filtered.filter(e => e.impact === "High").length;

                            return (
                              <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                                <div className="p-4 pb-3 space-y-3 border-b border-border/50">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center flex-shrink-0">
                                        <Globe className="w-4 h-4 text-indigo-400" />
                                      </div>
                                      <div>
                                        <span className="text-sm font-semibold block">{t('dashboard.econ.title')}</span>
                                        <span className="text-[10px] text-muted-foreground">{filtered.length} {t('dashboard.econ.event')}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {highCount > 0 && (
                                        <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400 bg-red-500/10 animate-pulse">
                                          {highCount} {t('dashboard.econ.high')}
                                        </Badge>
                                      )}
                                      <div className="flex items-center bg-secondary/50 rounded-lg p-0.5">
                                        <button
                                          onClick={() => setEconFilter("all")}
                                          className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${econFilter === "all" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                          data-testid="econ-filter-all"
                                        >{t('dashboard.econ.allImpact')}</button>
                                        <button
                                          onClick={() => setEconFilter("high")}
                                          className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${econFilter === "high" ? "bg-background shadow-sm text-red-400" : "text-muted-foreground hover:text-foreground"}`}
                                          data-testid="econ-filter-high"
                                        >{t('dashboard.econ.highImpact')}</button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5" data-testid="econ-period-filters">
                                    <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 w-full">
                                      <button
                                        onClick={() => setEconPeriod("today")}
                                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "today" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                        data-testid="econ-period-today"
                                      >{t('dashboard.econ.today')}</button>
                                      <button
                                        onClick={() => setEconPeriod("week")}
                                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "week" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                        data-testid="econ-period-week"
                                      >{t('dashboard.econ.thisWeek')}</button>
                                      <button
                                        onClick={() => setEconPeriod("nextWeek")}
                                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "nextWeek" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`}
                                        data-testid="econ-period-next-week"
                                      >{t('dashboard.econ.nextWeek')}</button>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 flex-wrap" data-testid="econ-country-filters">
                                    {ECON_COUNTRIES.map(c => {
                                      const isActive = econCountries.has(c.code);
                                      return (
                                        <button
                                          key={c.code}
                                          onClick={() => toggleEconCountry(c.code)}
                                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all duration-200 ${
                                            isActive
                                              ? "bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border-indigo-500/30 text-foreground shadow-sm"
                                              : "bg-secondary/30 border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/60"
                                          }`}
                                          data-testid={`econ-country-${c.code}`}
                                        >
                                          <span className={`text-sm transition-transform duration-200 ${isActive ? "scale-110" : "scale-90 grayscale"}`}>{c.flag}</span>
                                          <span>{c.code}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="overflow-y-auto max-h-[420px]">
                                  {filtered.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                                      <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
                                        <Globe className="w-6 h-6 opacity-40" />
                                      </div>
                                      <p className="text-xs font-medium">{t('dashboard.econ.noEvents')}</p>
                                    </div>
                                  ) : (
                                    <div>
                                      {sortedDates.map(dateKey => {
                                        const isToday = dateKey === todayStr;
                                        const events = grouped[dateKey];
                                        return (
                                          <div key={dateKey}>
                                            <div className={`sticky top-0 z-10 px-4 py-2 flex items-center gap-2 backdrop-blur-md ${isToday ? 'bg-indigo-500/8 border-b border-indigo-500/20' : 'bg-secondary/30 border-b border-border/30'}`}>
                                              {isToday ? (
                                                <div className="flex items-center gap-2">
                                                  <span className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                                                  </span>
                                                  <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">{t('dashboard.econ.today')}</span>
                                                </div>
                                              ) : (
                                                <span className="text-[11px] font-semibold text-muted-foreground capitalize">{formatDayLabel(dateKey)}</span>
                                              )}
                                              <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">{events.length}</span>
                                            </div>
                                            <div>
                                              {events.map((e, i) => (
                                                <div
                                                  key={`${e.title}-${e.date}-${i}`}
                                                  className={`group px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 transition-all duration-200 text-xs border-b border-border/10 ${
                                                    e.impact === "High"
                                                      ? "hover:bg-red-500/5 bg-red-500/[0.02]"
                                                      : "hover:bg-secondary/30"
                                                  }`}
                                                  data-testid={`econ-event-${dateKey}-${i}`}
                                                >
                                                  <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                                                    <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border-2 transition-all duration-200 group-hover:scale-110 ${
                                                      e.impact === "High" ? "border-red-500/40 bg-red-500/5 shadow-[0_0_8px_rgba(239,68,68,0.15)]" :
                                                      e.impact === "Medium" ? "border-amber-500/30 bg-amber-500/5 shadow-[0_0_8px_rgba(245,158,11,0.1)]" :
                                                      e.impact === "Holiday" ? "border-blue-400/30 bg-blue-400/5 shadow-[0_0_8px_rgba(96,165,250,0.1)]" :
                                                      "border-border/40 bg-secondary/20"
                                                    }`}>
                                                      <span className="text-sm sm:text-base leading-none">{countryFlag(e.country)}</span>
                                                    </div>
                                                    <span className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide w-6 sm:w-7">{e.country}</span>
                                                  </div>
                                                  <span className="text-[9px] sm:text-[10px] font-mono text-muted-foreground/70 w-10 sm:w-12 flex-shrink-0 tabular-nums" dir="ltr">{formatEventTime(e.date)}</span>
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                      <span className="text-xs font-medium truncate" dir="ltr">{e.title}</span>
                                                    </div>
                                                    {(e.forecast || e.previous) && (
                                                      <div className="flex items-center gap-3 mt-0.5">
                                                        {e.forecast && (
                                                          <span className="text-[10px] text-muted-foreground/70">
                                                            {t('dashboard.econ.forecast')}: <span className="font-mono font-semibold text-foreground/80">{e.forecast}</span>
                                                          </span>
                                                        )}
                                                        {e.previous && (
                                                          <span className="text-[10px] text-muted-foreground/70">
                                                            {t('dashboard.econ.previous')}: <span className="font-mono font-medium text-muted-foreground">{e.previous}</span>
                                                          </span>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                  <Badge variant="outline" className={`text-[9px] h-5 px-1.5 border ${impactBg(e.impact)} flex-shrink-0 font-semibold`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${impactDot(e.impact)} mr-1`} />
                                                    {impactLabel(e.impact)}
                                                  </Badge>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </SortableWidget>
                      );

                      return null;
                    })}
                  </SortableContext>
                </DndContext>
              </>
            )}

            {activePage === 'dashboard' && (
              <div className="space-y-6 mt-6">
                <section>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3" data-testid="text-firms-title">
                    {t("home.recommendedFirms", { defaultValue: "חברות מסחר מומלצות" })}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {HOME_FIRMS.map(firm => (
                      <Card key={firm.name} className="bg-card border-border hover:border-indigo-500/20 transition-colors" data-testid={`card-firm-${firm.name}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400">
                                {firm.name.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{firm.name}</p>
                                <div className="flex items-center gap-1">
                                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                  <span className="text-xs text-muted-foreground">{firm.rating}/5</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">{t("home.maxFunding", { defaultValue: "מימון מקסימלי" })}</p>
                              <p className="font-semibold text-emerald-400">{firm.maxFunding}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">{t("home.profitSplit", { defaultValue: "חלוקת רווח" })}</p>
                              <p className="font-semibold">{firm.profitSplit}</p>
                            </div>
                          </div>
                          <div className="text-xs">
                            <p className="text-muted-foreground">{t("home.lowestCost", { defaultValue: "עלות מינימלית" })}</p>
                            <p className="font-semibold">{firm.trueCost}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {firm.tags.map(tag => (
                              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>

                <section>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3" data-testid="text-community-title">
                    {t("home.communityNow", { defaultValue: "קהילה עכשיו" })}
                  </h2>
                  <Card className="bg-card border-border">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-medium text-muted-foreground">{t("home.totalConnections", { defaultValue: "סה\"כ חיבורים" })}</span>
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 me-1.5 animate-pulse" />
                          LIVE
                        </Badge>
                      </div>
                      <p className="text-4xl font-bold font-mono" dir="ltr" data-testid="text-total-connections">
                        {totalConnections !== null ? totalConnections.toLocaleString() : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                        <Activity className="w-3 h-3" />
                        {t("home.uniqueAccounts", { defaultValue: "חשבונות ייחודיים שחוברו לפלטפורמה" })}
                      </p>
                    </CardContent>
                  </Card>
                </section>
              </div>
            )}

            {activePage === 'economicCalendar' && (() => {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
              const toLocalDateStr = (d: Date) =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const dayOfWeek = todayDate.getDay();
              const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
              const thisMonday = new Date(todayDate);
              thisMonday.setDate(todayDate.getDate() + mondayOffset);
              const thisSunday = new Date(thisMonday);
              thisSunday.setDate(thisMonday.getDate() + 6);
              const nextMonday = new Date(thisMonday);
              nextMonday.setDate(thisMonday.getDate() + 7);
              const nextSunday = new Date(nextMonday);
              nextSunday.setDate(nextMonday.getDate() + 6);
              const thisWeekStart = toLocalDateStr(thisMonday);
              const thisWeekEnd = toLocalDateStr(thisSunday);
              const nextWeekStart = toLocalDateStr(nextMonday);
              const nextWeekEnd = toLocalDateStr(nextSunday);
              const countryFiltered = econEvents.filter(e => econCountries.has(e.country));
              const periodFiltered = countryFiltered.filter(e => {
                if (!e.date) return false;
                const d = new Date(e.date);
                if (isNaN(d.getTime())) return false;
                const dateStr = toLocalDateStr(d);
                if (econPeriod === "today") return dateStr === todayStr;
                if (econPeriod === "nextWeek") return dateStr >= nextWeekStart && dateStr <= nextWeekEnd;
                return dateStr >= thisWeekStart && dateStr <= thisWeekEnd;
              });
              const filtered = econFilter === "high" ? periodFiltered.filter(e => e.impact === "High") : periodFiltered;
              const grouped: Record<string, EconEvent[]> = {};
              for (const ev of filtered) {
                if (!ev.date) continue;
                const d = new Date(ev.date);
                if (isNaN(d.getTime())) continue;
                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!grouped[dateKey]) grouped[dateKey] = [];
                grouped[dateKey].push(ev);
              }
              const sortedDates = Object.keys(grouped).sort();
              const impactDot = (impact: EconImpact) => {
                switch (impact) {
                  case "High": return "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]";
                  case "Medium": return "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]";
                  case "Low": return "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]";
                  case "Holiday": return "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.4)]";
                }
              };
              const impactBg = (impact: EconImpact) => {
                switch (impact) {
                  case "High": return "bg-red-500/10 border-red-500/30 text-red-400";
                  case "Medium": return "bg-amber-500/10 border-amber-500/30 text-amber-400";
                  case "Low": return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
                  case "Holiday": return "bg-blue-400/10 border-blue-400/30 text-blue-400";
                }
              };
              const impactLabel = (impact: EconImpact) => {
                switch (impact) {
                  case "High": return t('dashboard.econ.high');
                  case "Medium": return t('dashboard.econ.medium');
                  case "Low": return t('dashboard.econ.low');
                  case "Holiday": return t('dashboard.econ.holiday');
                }
              };
              const countryFlag = (country: string) => {
                const found = ECON_COUNTRIES.find(c => c.code === country);
                return found?.flag || "🌐";
              };
              const appLocale = i18n.language || 'en';
              const formatEventTime = (dateStr: string) => {
                try {
                  const d = new Date(dateStr);
                  if (isNaN(d.getTime())) return "";
                  return d.toLocaleTimeString(appLocale, { hour: '2-digit', minute: '2-digit' });
                } catch { return ""; }
              };
              const formatDayLabel = (dateStr: string) => {
                try {
                  const d = new Date(dateStr + "T12:00:00");
                  const dayName = d.toLocaleDateString(appLocale, { weekday: 'long' });
                  const dayNum = d.getDate();
                  const monthName = d.toLocaleDateString(appLocale, { month: 'short' });
                  return `${dayName}, ${dayNum} ${monthName}`;
                } catch { return dateStr; }
              };
              const highCount = filtered.filter(e => e.impact === "High").length;

              return (
                <div className="space-y-6">
                  <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                    <Globe className="w-5 h-5 text-indigo-500" /> {t('journal.economicCalendar', { defaultValue: 'יומן כלכלי' })}
                  </h2>
                  <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                    <div className="p-4 pb-3 space-y-3 border-b border-border/50">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center flex-shrink-0">
                            <Globe className="w-4 h-4 text-indigo-400" />
                          </div>
                          <div>
                            <span className="text-sm font-semibold block">{t('dashboard.econ.title')}</span>
                            <span className="text-[10px] text-muted-foreground">{filtered.length} {t('dashboard.econ.event')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {highCount > 0 && (
                            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400 bg-red-500/10 animate-pulse">
                              {highCount} {t('dashboard.econ.high')}
                            </Badge>
                          )}
                          <div className="flex items-center bg-secondary/50 rounded-lg p-0.5">
                            <button onClick={() => setEconFilter("all")} className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${econFilter === "all" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`} data-testid="econ-page-filter-all">{t('dashboard.econ.allImpact')}</button>
                            <button onClick={() => setEconFilter("high")} className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${econFilter === "high" ? "bg-background shadow-sm text-red-400" : "text-muted-foreground hover:text-foreground"}`} data-testid="econ-page-filter-high">{t('dashboard.econ.highImpact')}</button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5" data-testid="econ-page-period-filters">
                        <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 w-full">
                          <button onClick={() => setEconPeriod("today")} className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "today" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`} data-testid="econ-page-period-today">{t('dashboard.econ.today')}</button>
                          <button onClick={() => setEconPeriod("week")} className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "week" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`} data-testid="econ-page-period-week">{t('dashboard.econ.thisWeek')}</button>
                          <button onClick={() => setEconPeriod("nextWeek")} className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${econPeriod === "nextWeek" ? "bg-background shadow-sm text-indigo-400" : "text-muted-foreground hover:text-foreground"}`} data-testid="econ-page-period-next-week">{t('dashboard.econ.nextWeek')}</button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap" data-testid="econ-page-country-filters">
                        {ECON_COUNTRIES.map(c => {
                          const isActive = econCountries.has(c.code);
                          return (
                            <button key={c.code} onClick={() => toggleEconCountry(c.code)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all duration-200 ${isActive ? "bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border-indigo-500/30 text-foreground shadow-sm" : "bg-secondary/30 border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/60"}`} data-testid={`econ-page-country-${c.code}`}>
                              <span className={`text-sm transition-transform duration-200 ${isActive ? "scale-110" : "scale-90 grayscale"}`}>{c.flag}</span>
                              <span>{c.code}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
                      {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                          <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
                            <Globe className="w-6 h-6 opacity-40" />
                          </div>
                          <p className="text-xs font-medium">{t('dashboard.econ.noEvents')}</p>
                        </div>
                      ) : (
                        <div>
                          {sortedDates.map(dateKey => {
                            const isToday = dateKey === todayStr;
                            const events = grouped[dateKey];
                            return (
                              <div key={dateKey}>
                                <div className={`sticky top-0 z-10 px-4 py-2 flex items-center gap-2 backdrop-blur-md ${isToday ? 'bg-indigo-500/8 border-b border-indigo-500/20' : 'bg-secondary/30 border-b border-border/30'}`}>
                                  {isToday ? (
                                    <div className="flex items-center gap-2">
                                      <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                                      </span>
                                      <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">{t('dashboard.econ.today')}</span>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-muted-foreground capitalize">{formatDayLabel(dateKey)}</span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">{events.length}</span>
                                </div>
                                <div>
                                  {events.map((e, i) => (
                                    <div key={`${e.title}-${e.date}-${i}`} className={`group px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 transition-all duration-200 text-xs border-b border-border/10 ${e.impact === "High" ? "hover:bg-red-500/5 bg-red-500/[0.02]" : "hover:bg-secondary/30"}`} data-testid={`econ-page-event-${dateKey}-${i}`}>
                                      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                                        <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border-2 transition-all duration-200 group-hover:scale-110 ${e.impact === "High" ? "border-red-500/40 bg-red-500/5 shadow-[0_0_8px_rgba(239,68,68,0.15)]" : e.impact === "Medium" ? "border-amber-500/30 bg-amber-500/5 shadow-[0_0_8px_rgba(245,158,11,0.1)]" : e.impact === "Holiday" ? "border-blue-400/30 bg-blue-400/5 shadow-[0_0_8px_rgba(96,165,250,0.1)]" : "border-border/40 bg-secondary/20"}`}>
                                          <span className="text-sm sm:text-base leading-none">{countryFlag(e.country)}</span>
                                        </div>
                                        <span className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide w-6 sm:w-7">{e.country}</span>
                                      </div>
                                      <span className="text-[9px] sm:text-[10px] font-mono text-muted-foreground/70 w-10 sm:w-12 flex-shrink-0 tabular-nums" dir="ltr">{formatEventTime(e.date)}</span>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs font-medium truncate" dir="ltr">{e.title}</span>
                                        </div>
                                        {(e.forecast || e.previous) && (
                                          <div className="flex items-center gap-3 mt-0.5">
                                            {e.forecast && (<span className="text-[10px] text-muted-foreground/70">{t('dashboard.econ.forecast')}: <span className="font-mono font-semibold text-foreground/80">{e.forecast}</span></span>)}
                                            {e.previous && (<span className="text-[10px] text-muted-foreground/70">{t('dashboard.econ.previous')}: <span className="font-mono font-medium text-muted-foreground">{e.previous}</span></span>)}
                                          </div>
                                        )}
                                      </div>
                                      <Badge variant="outline" className={`text-[9px] h-5 px-1.5 border ${impactBg(e.impact)} flex-shrink-0 font-semibold`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${impactDot(e.impact)} mr-1`} />
                                        {impactLabel(e.impact)}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* What To Trade Today Page */}
            {activePage === 'priorities' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> {t('nav.priorities')}</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('priorities.subtitle')}</p>
                  </div>
                </div>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                 <div className="overflow-x-auto">
                  <table className="w-full text-right min-w-[700px]">
                    <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t('dashboard.account')}</th>
                        <th className="px-5 py-3 font-medium">{t('dashboard.firm')}</th>
                        <th className="px-5 py-3 font-medium text-left">{t('dashboard.profit')}</th>
                        <th className="px-5 py-3 font-medium text-left">{t('priorities.distanceToTarget')}</th>
                        <th className="px-5 py-3 font-medium">{t('priorities.consistencyRisk')}</th>
                        <th className="px-5 py-3 font-medium">{t('priorities.drawdownRisk')}</th>
                        <th className="px-5 py-3 font-medium">{t('priorities.score')}</th>
                        <th className="px-5 py-3 font-medium">{t('priorities.recommendation')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {tradingPriorities.map((p, i) => {
                        const rec = RECOMMENDATION_INFO[p.recommendation] || RECOMMENDATION_INFO.trade;
                        return (
                          <tr key={p.id} className="hover:bg-secondary/40 transition-colors cursor-pointer" onClick={() => navigate(`/account/${p.id}`)}
                            data-testid={`priority-row-${p.id}`}>
                            <td className="px-5 py-4">
                              <div>
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">{p.accountId}</p>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-sm" dir="ltr">{p.firm}</td>
                            <td className="px-5 py-4 text-left" dir="ltr">
                              <span className={`text-sm font-mono font-semibold ${p.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{formatPnl(p.profit, accounts.find(a => a.id === p.id)?.size || 0)}</span>
                            </td>
                            <td className="px-5 py-4 text-left" dir="ltr">
                              <span className="text-sm font-mono text-muted-foreground">{p.distanceToTarget > 0 ? formatCurrency(p.distanceToTarget) : '—'}</span>
                            </td>
                            <td className="px-5 py-4">
                              <span className={`text-sm font-mono ${p.consistencyRisk > 30 ? 'text-red-500' : p.consistencyRisk > 20 ? 'text-amber-500' : 'text-emerald-500'}`}>{p.consistencyRisk}%</span>
                            </td>
                            <td className="px-5 py-4">
                              <span className={`text-sm font-mono ${p.drawdownRisk > 50 ? 'text-red-500' : p.drawdownRisk > 30 ? 'text-amber-500' : 'text-emerald-500'}`}>{p.drawdownRisk}%</span>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${p.score >= 70 ? 'bg-emerald-500' : p.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.score}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground">{p.score}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${rec.bg} ${rec.color}`}>{t(`priorities.${p.recommendation}`)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                 </div>
                </div>
              </div>
            )}

            {/* Withdrawals Page */}
            {activePage === 'withdrawals' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-purple-500" /> {t('withdrawal.management')}</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('withdrawal.trackingDesc')}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                  {[
                    { label: t('dashboard.kpi.totalWithdrawals'), value: formatCurrency(totalWithdrawals), color: 'text-emerald-500' },
                    { label: t('dashboard.kpi.pending'), value: String(pendingWithdrawals.length), color: 'text-amber-500' },
                    { label: t('withdrawal.statusPaid'), value: String(withdrawalsList.filter(w => w.status === 'paid').length), color: 'text-blue-500' },
                    { label: t('withdrawal.thisMonth'), value: formatCurrency(withdrawalsList.filter(w => w.dateRequested?.startsWith('2026-03')).reduce((s, w) => s + w.amount, 0)), color: 'text-indigo-500' },
                  ].map((s, i) => (
                    <div key={i} className="bg-card p-3 sm:p-4 rounded-lg border border-border">
                      <p className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase">{s.label}</p>
                      <p className={`text-lg sm:text-2xl font-bold font-mono mt-1 ${s.color}`} dir="ltr">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                 <div className="overflow-x-auto">
                  <table className="w-full text-right min-w-[700px]">
                    <thead className="bg-secondary/30 text-muted-foreground text-[10px] uppercase font-semibold">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t('dashboard.account')}</th>
                        <th className="px-5 py-3 font-medium">{t('dashboard.firm')}</th>
                        <th className="px-5 py-3 font-medium text-left">{t('withdrawal.amount')}</th>
                        <th className="px-5 py-3 font-medium">{t('withdrawal.dateRequested')}</th>
                        <th className="px-5 py-3 font-medium">{t('withdrawal.dateApproved')}</th>
                        <th className="px-5 py-3 font-medium">{t('withdrawal.datePaid')}</th>
                        <th className="px-5 py-3 font-medium text-center">{t('withdrawal.status')}</th>
                        <th className="px-5 py-3 font-medium">{t('withdrawal.notes')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {withdrawalsList.map(w => {
                        const statusStyles: Record<string, string> = {
                          pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                          approved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
                          paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                          rejected: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                        };
                        return (
                          <tr key={w.id} className="hover:bg-secondary/40 transition-colors group">
                            <td className="px-5 py-3 text-sm font-medium">{w.accountName}</td>
                            <td className="px-5 py-3 text-sm text-muted-foreground" dir="ltr">{w.firm}</td>
                            <td className="px-5 py-3 text-left" dir="ltr"><span className="text-sm font-mono font-semibold text-emerald-500">+{formatCurrency(w.amount)}</span></td>
                            <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.dateRequested}</td>
                            <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.dateApproved || '—'}</td>
                            <td className="px-5 py-3 text-xs text-muted-foreground font-mono" dir="ltr">{w.datePaid || '—'}</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusStyles[w.status]}`}>
                                {t(`withdrawal.status${w.status.charAt(0).toUpperCase() + w.status.slice(1)}`)}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{w.notes || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                 </div>
                </div>
              </div>
            )}

            {/* Analytics Page — Advanced Analytics + Drawdown Evaluator */}
            {activePage === 'analytics' && (
              <div className="space-y-8">
                <AnalyticsDashboard />
                <div className="border-t border-border pt-6">
                  <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2 mb-4"><Activity className="w-5 h-5 text-amber-500" /> {t('drawdownEvaluator.title', 'מעריך Drawdown')}</h3>
                  <DrawdownEvaluatorWidget />
                </div>
              </div>
            )}

            {/* Settings Page */}
            {activePage === 'settings' && <SettingsPage
              firmsList={firmsList} handleExport={handleExport}
              createFirmMutation={createFirmMutation} updateFirmMutation={updateFirmMutation} deleteFirmMutation={deleteFirmMutation}
              createTierMutation={createTierMutation} updateTierMutation={updateTierMutation} deleteTierMutation={deleteTierMutation}
            />}
          </div>

          {/* Mobile Sidebar Overlay */}
          <AnimatePresence>
            {isMobileSidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                  onClick={() => setIsMobileSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: dir === 'rtl' ? 300 : -300 }}
                  animate={{ x: 0 }}
                  exit={{ x: dir === 'rtl' ? 300 : -300 }}
                  transition={{ type: "tween", duration: 0.25 }}
                  className={`fixed top-0 ${dir === 'rtl' ? 'right-0' : 'left-0'} bottom-0 w-72 z-50 lg:hidden flex flex-col shadow-2xl ${dir === 'rtl' ? 'border-l' : 'border-r'} border-border bg-card`}
                  dir={dir}
                >
                  <div className="h-14 flex items-center justify-between px-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <img src="/logo.png" alt="Vertex Command" className="w-8 h-8 rounded-lg object-contain" />
                      <h1 className="text-base font-semibold text-foreground">{t('app.name')}</h1>
                    </div>
                    <button onClick={() => setIsMobileSidebarOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" data-testid="button-close-sidebar">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                        {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-semibold text-foreground truncate">{user?.name || t('common.user')}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{user?.email || ''}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
                    <div>
                      <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('sidebar.platform')}</p>
                      {[
                        { key: 'dashboard', icon: BarChart3, label: t('nav.dashboard') },
                        { key: 'priorities', icon: Zap, label: t('nav.priorities'), feature: 'priority_engine', requiredPlan: 'pro' },
                        { key: 'withdrawals', icon: CreditCard, label: t('nav.withdrawals') },
                        { key: 'economicCalendar', icon: Globe, label: t('journal.economicCalendar', { defaultValue: 'יומן כלכלי' }) },
                      ].map(item => {
                        const mLocked = item.feature && !hasFeature(item.feature);
                        return (
                        <button key={item.key} onClick={() => { if (mLocked) { setIsMobileSidebarOpen(false); handleLockedFeature(item.feature!, item.requiredPlan!); } else { setActivePage(item.key); setIsMobileSidebarOpen(false); } }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${activePage === item.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} ${mLocked ? 'opacity-50' : ''}`}
                          data-testid={`mobile-sidebar-${item.key}`}>
                          <item.icon className={`w-4.5 h-4.5 ${activePage === item.key ? 'text-primary' : ''}`} />
                          {item.label}
                          {mLocked && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                        </button>
                      );})}
                    </div>

                    {(() => { const mExpired = billingStatus?.status === 'expired'; return (<>
                    <div>
                      <button onClick={() => { if (mExpired) return; navigate('/get-started'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-get-started">
                        <Zap className="w-4.5 h-4.5" /> {t('nav.getStarted', { defaultValue: 'התחל כאן' })}
                      </button>
                    </div>

                    <div>
                      <button onClick={() => { if (mExpired) return; navigate('/journal'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-journal">
                        <LayoutDashboard className="w-4.5 h-4.5" /> {t('nav.journaling', { defaultValue: 'יומן מסחר' })}
                      </button>
                    </div>

                    <div>
                      <button onClick={() => { if (mExpired) return; navigate('/reports'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-reports">
                        <BarChart3 className="w-4.5 h-4.5" />
                        {t('nav.reports')}
                        {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                    </div>

                    <div>
                      <button onClick={() => { if (mExpired) return; navigate('/affiliates'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-affiliates">
                        <Gift className="w-4.5 h-4.5" />
                        {t('nav.affiliates')}
                        {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                      <button onClick={() => { if (mExpired) return; navigate('/partners'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-partners">
                        <Handshake className="w-4.5 h-4.5" />
                        {t('nav.partners')}
                        {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                    </div>

                    <div>
                      <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('sidebar.tools')}</p>
                      <button onClick={() => { if (mExpired) return; if (hasFeature('integrations')) { navigate('/integrations'); setIsMobileSidebarOpen(false); } else { setIsMobileSidebarOpen(false); handleLockedFeature('integrations', 'pro'); } }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${!hasFeature('integrations') || mExpired ? 'opacity-50' : ''} ${mExpired ? 'pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-integrations">
                        <Plug className="w-4.5 h-4.5" />
                        {t('nav.integrations')}
                        {(!hasFeature('integrations') || mExpired) && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                      <button onClick={() => { navigate('/billing'); setIsMobileSidebarOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        data-testid="mobile-sidebar-billing">
                        <Crown className="w-4.5 h-4.5" />
                        {t('nav.billing')}
                      </button>
                      {user?.role === 'admin' && (
                        <button onClick={() => { if (mExpired) return; navigate('/admin'); setIsMobileSidebarOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                          data-testid="mobile-sidebar-admin">
                          <Shield className="w-4.5 h-4.5" />
                          {t('nav.admin')}
                          {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                        </button>
                      )}
                      {(user?.role === 'admin' || userPlanKey === 'unlimited' || userPlanKey === 'desk') && (
                        <button onClick={() => { if (mExpired) return; navigate('/latency-monitor'); setIsMobileSidebarOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                          data-testid="mobile-sidebar-latency-monitor">
                          <Activity className="w-4.5 h-4.5" />
                          Latency Monitor
                          {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                        </button>
                      )}
                      {user?.role === 'admin' && (
                        <button onClick={() => { if (mExpired) return; navigate('/system-health'); setIsMobileSidebarOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                          data-testid="mobile-sidebar-system-health">
                          <HeartPulse className="w-4.5 h-4.5" />
                          {t('nav.systemHealth')}
                          {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                        </button>
                      )}
                      <button onClick={() => { if (mExpired) return; navigate('/help'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-help">
                        <HelpCircle className="w-4.5 h-4.5" />
                        {t('nav.helpCenter')}
                        {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                      <button onClick={() => { if (mExpired) return; setActivePage('settings'); setIsMobileSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${activePage === 'settings' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} ${mExpired ? 'opacity-50 pointer-events-none' : ''}`}
                        data-testid="mobile-sidebar-settings">
                        <Settings className="w-4.5 h-4.5" />
                        {t('nav.settings')}
                        {mExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
                      </button>
                    </div>
                    </>); })()}
                  </div>

                  {billingStatus?.status === 'trialing' && billingStatus.daysLeft != null && (
                    <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                      <Timer className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-xs text-amber-400 font-medium flex-1">
                        {billingStatus.daysLeft <= 1 ? t('trial.bannerLastDay') : t('trial.banner', { days: billingStatus.daysLeft })}
                      </span>
                    </div>
                  )}

                  <div className="p-3 border-t border-border">
                    <button onClick={() => { logout.mutate(); setIsMobileSidebarOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      data-testid="mobile-sidebar-logout">
                      <LogOut className="w-4.5 h-4.5" />
                      {t('auth.logout')}
                    </button>
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {planLimitModal && (
        <Dialog open={true} onOpenChange={() => setPlanLimitModal(null)}>
          <DialogContent className="sm:max-w-md" dir={dir}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-500" />
                {t('planLimit.title')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {t(`planLimit.features.${planLimitModal.feature}`)}
              </p>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <Crown className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-medium">
                  {t('planLimit.requiredPlan', { plan: planLimitModal.requiredPlan.charAt(0).toUpperCase() + planLimitModal.requiredPlan.slice(1) })}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPlanLimitModal(null)} data-testid="button-plan-limit-close">
                  {t('common.close')}
                </Button>
                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => { setPlanLimitModal(null); navigate('/billing'); }} data-testid="button-plan-limit-upgrade">
                  <Crown className="w-4 h-4 me-2" />
                  {t('planLimit.upgrade')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
