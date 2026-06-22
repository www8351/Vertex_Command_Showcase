import { useState, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { isRTL, getDateLocale } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import {
  BarChart3, Zap, CreditCard, Globe, Plug, LayoutDashboard, Gift, Handshake,
  Crown, Shield, Activity, HeartPulse, HelpCircle, Settings, LogOut, Lock, LineChart,
  Search, Sun, Moon, Bell, Menu, X, Timer, AlertTriangle, CheckCircle2,
  XCircle, Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Alert = {
  id: number;
  message: string;
  read: boolean;
  severity: string;
  createdAt: string | null;
  type?: string;
};

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { resolvedTheme, setMode } = useTheme();
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAlertsPanelOpen, setIsAlertsPanelOpen] = useState(false);
  const [selectedAlerts, setSelectedAlerts] = useState<Set<number>>(new Set());
  const [planLimitModal, setPlanLimitModal] = useState<{ feature: string; requiredPlan: string } | null>(null);

  const { data: subscription } = useQuery<any>({ queryKey: ["/api/v1/billing/subscription"] });
  const { data: billingStatus } = useQuery<{ status: string; daysLeft: number | null }>({
    queryKey: ["/api/v1/billing/status"],
    staleTime: 30000,
  });
  const { data: rawAlertsList = [] } = useQuery<Alert[]>({ queryKey: ["/api/v1/alerts"] });
  const alertsList = useMemo(
    () => rawAlertsList.filter(a => a.type !== "sync_update"),
    [rawAlertsList],
  );
  const unreadAlerts = useMemo(() => alertsList.filter(a => !a.read), [alertsList]);

  const userPlanKey = subscription?.plan?.key || "free";
  const isAdmin = user?.role === "admin";
  const isExpired = billingStatus?.status === "expired";

  const hasFeature = (feature: string) => {
    if (isAdmin) return true;
    const plan = subscription?.plan;
    if (!plan) return false;
    const featureMap: Record<string, string> = {
      integrations: "hasIntegrations",
      copy_trading: "hasCopyTrading",
      ai_chatbot: "hasAiChatbot",
      priority_engine: "hasPriorityEngine",
      exports: "hasExports",
    };
    return !!plan[featureMap[feature]];
  };

  const handleLockedFeature = (feature: string, requiredPlan: string) => {
    setPlanLimitModal({ feature, requiredPlan });
  };

  const markAlertReadMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/v1/alerts/${id}/read`, {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); },
  });
  const markAllAlertsReadMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/v1/alerts/read-all", {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); },
  });
  const deleteAlertMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/v1/alerts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); toast({ title: t("dashboard.alertsDeleted") }); },
  });
  const deleteBulkAlertsMutation = useMutation({
    mutationFn: async (ids: number[]) => { await apiRequest("POST", "/api/v1/alerts/delete-bulk", { ids }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] }); setSelectedAlerts(new Set()); toast({ title: t("dashboard.alertsDeleted") }); },
  });

  const goDashboardTab = (tab: string) => {
    navigate(tab === "dashboard" ? "/" : `/?tab=${tab}`);
    setIsMobileSidebarOpen(false);
  };

  const handleSearchSubmit = () => {
    const q = searchInput.trim();
    if (!q) return;
    navigate(`/?search=${encodeURIComponent(q)}`);
  };

  const isActive = (path: string) => location === path;

  const platformItems = [
    { key: "dashboard", icon: BarChart3, label: t("nav.dashboard") },
    { key: "priorities", icon: Zap, label: t("nav.priorities"), feature: "priority_engine", requiredPlan: "pro" },
    { key: "withdrawals", icon: CreditCard, label: t("nav.withdrawals") },
    { key: "economicCalendar", icon: Globe, label: t("journal.economicCalendar", { defaultValue: "יומן כלכלי" }) },
  ];

  const navBtnClass = (active: boolean, locked = false) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
      active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
    } ${locked || isExpired ? "opacity-50" : ""} ${isExpired ? "pointer-events-none" : ""}`;

  const renderRouteBtn = (
    path: string, icon: any, label: string,
    opts: { feature?: string; requiredPlan?: string; testid: string; show?: boolean } = { testid: "" },
  ) => {
    if (opts.show === false) return null;
    const Icon = icon;
    const locked = opts.feature ? !hasFeature(opts.feature) : false;
    const handleClick = () => {
      if (isExpired) return;
      if (locked && opts.requiredPlan) {
        setIsMobileSidebarOpen(false);
        handleLockedFeature(opts.feature!, opts.requiredPlan);
        return;
      }
      navigate(path);
      setIsMobileSidebarOpen(false);
    };
    return (
      <button
        onClick={handleClick}
        className={navBtnClass(isActive(path), locked)}
        data-testid={opts.testid}
      >
        <Icon className="w-4 h-4" />
        {label}
        {(locked || isExpired) && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
      </button>
    );
  };

  const sidebarPlatformSection = (
    <div className="px-4 py-6 space-y-1" dir={dir}>
      <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {t("nav.platform")}
      </p>
      {platformItems.map(item => {
        const locked = item.feature ? !hasFeature(item.feature) : false;
        const active = location === "/" && (
          item.key === "dashboard"
            ? !new URLSearchParams(window.location.search).get("tab")
            : new URLSearchParams(window.location.search).get("tab") === item.key
        );
        return (
          <button
            key={item.key}
            onClick={() => locked && item.requiredPlan ? handleLockedFeature(item.feature!, item.requiredPlan) : goDashboardTab(item.key)}
            className={navBtnClass(active, locked)}
            data-testid={`nav-${item.key}`}
          >
            <item.icon className={`w-4 h-4 ${active ? "text-primary" : ""}`} />
            {item.label}
            {locked && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
          </button>
        );
      })}
    </div>
  );

  const sidebarToolsSection = (
    <div className="p-4 border-t border-border" dir={dir}>
      {renderRouteBtn("/get-started", Zap, t("nav.getStarted", { defaultValue: "התחל כאן" }), { testid: "nav-get-started" })}
      {renderRouteBtn("/integrations", Plug, t("nav.integrations"), { feature: "integrations", requiredPlan: "pro", testid: "nav-integrations" })}
      {renderRouteBtn("/copy-trading", Handshake, t("nav.copyTrading", { defaultValue: "Copy Trading" }), { feature: "copy_trading", requiredPlan: "pro", testid: "nav-copy-trading" })}
      {renderRouteBtn("/trading-monitor", LineChart, t("nav.tradingMonitor", { defaultValue: "Trading Monitor" }), { testid: "nav-trading-monitor" })}
      {renderRouteBtn("/journal", LayoutDashboard, t("nav.journaling", { defaultValue: "יומן מסחר" }), { testid: "nav-journal" })}
      {renderRouteBtn("/reports", BarChart3, t("nav.reports"), { testid: "nav-reports" })}
      {renderRouteBtn("/affiliates", Gift, t("nav.affiliates"), { testid: "nav-affiliates" })}
      {renderRouteBtn("/partners", Handshake, t("nav.partners"), { testid: "nav-partners" })}
      {renderRouteBtn("/billing", Crown, t("nav.billing"), { testid: "nav-billing" })}
      {renderRouteBtn("/admin", Shield, t("nav.admin"), { testid: "nav-admin", show: user?.role === "admin" })}
      {renderRouteBtn("/latency-monitor", Activity, "Latency Monitor", {
        testid: "nav-latency-monitor",
        show: user?.role === "admin" || userPlanKey === "unlimited" || userPlanKey === "desk",
      })}
      {renderRouteBtn("/system-health", HeartPulse, t("nav.systemHealth"), { testid: "nav-system-health", show: user?.role === "admin" })}
      {renderRouteBtn("/help", HelpCircle, t("nav.helpCenter"), { testid: "nav-help" })}
      <button
        onClick={() => !isExpired && goDashboardTab("settings")}
        className={navBtnClass(false)}
        data-testid="nav-settings"
      >
        <Settings className="w-4 h-4" /> {t("nav.settings")}
        {isExpired && <Lock className="w-3 h-3 ms-auto text-muted-foreground/50" />}
      </button>
      <button
        onClick={() => logout.mutate()}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-1"
        data-testid="nav-logout"
      >
        <LogOut className="w-4 h-4" /> {t("auth.logout")}
      </button>
      <div className="mt-4 flex items-center gap-3 px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-semibold text-foreground">
          {user?.name?.charAt(0) || "U"}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="text-sm font-medium text-foreground truncate">{user?.name || t("common.user")}</p>
          <p className="text-[10px] text-muted-foreground truncate">{user?.email || ""}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full bg-background text-foreground font-sans" dir={dir}>
      <div className="flex h-full overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="w-60 border-e border-border hidden lg:flex flex-col bg-card" dir="ltr">
          <div className="h-16 flex items-center px-6 border-b border-border shrink-0">
            <button onClick={() => navigate("/")} className="flex items-center gap-3" data-testid="link-home">
              <img src="/logo.png" alt="Vertex Command" className="w-7 h-7 rounded-md object-contain" />
              <h1 className="text-base font-semibold text-foreground">{t("app.name").toUpperCase()}</h1>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {sidebarPlatformSection}
            {sidebarToolsSection}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          {/* Header */}
          <header className="h-12 lg:h-14 flex items-center justify-between px-3 lg:px-6 border-b border-border bg-card sticky top-0 z-20">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                data-testid="button-mobile-menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <img src="/logo.png" alt="Vertex Command" className="w-6 h-6 rounded object-contain" />
              <h1 className="text-sm font-semibold">{t("app.name").toUpperCase()}</h1>
            </div>
            <div className="hidden lg:flex items-center relative w-72">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSearchSubmit(); }}
                placeholder={t("dashboard.searchPlaceholder")}
                className="w-full bg-secondary/50 border border-border rounded-full pr-9 pl-4 py-1.5 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-muted-foreground"
                data-testid="input-search"
              />
            </div>
            <div className="flex items-center gap-1.5 lg:gap-3">
              <button
                onClick={() => setMode(resolvedTheme === "dark" ? "light" : "dark")}
                className="w-7 h-7 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                data-testid="button-theme-toggle"
              >
                {resolvedTheme === "dark" ? <Sun className="w-3.5 h-3.5 lg:w-4 lg:h-4" /> : <Moon className="w-3.5 h-3.5 lg:w-4 lg:h-4" />}
              </button>
              <LanguageSwitcher />
              <button
                onClick={() => setIsAlertsPanelOpen(!isAlertsPanelOpen)}
                className="w-7 h-7 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors relative"
                data-testid="button-alerts"
              >
                <Bell className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                {unreadAlerts.length > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                    {unreadAlerts.length}
                  </span>
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
                  <div
                    className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full ${isOpen ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}
                    data-testid="indicator-market-status"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isOpen ? "bg-emerald-400" : "bg-red-400"} opacity-75`} />
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isOpen ? "bg-emerald-500" : "bg-red-500"}`} />
                    </span>
                    <span className={`text-[10px] font-medium ${isOpen ? "text-emerald-400" : "text-red-400"}`}>
                      {isOpen ? "Live Market" : "Market Closed"}
                    </span>
                  </div>
                );
              })()}
            </div>
          </header>

          {/* Trial Banner */}
          {billingStatus?.status === "trialing" && billingStatus.daysLeft != null && (
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 gap-2 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border-b border-amber-500/20" data-testid="trial-banner">
              <div className="flex items-center gap-2 min-w-0">
                <Timer className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-[11px] sm:text-xs font-medium text-amber-600 dark:text-amber-400">
                  {billingStatus.daysLeft <= 1 ? t("trial.bannerLastDay") : t("trial.banner", { days: billingStatus.daysLeft })}
                </span>
              </div>
              <button onClick={() => navigate("/billing")} className="text-[11px] sm:text-xs font-semibold text-indigo-500 hover:text-indigo-400 transition-colors flex-shrink-0 whitespace-nowrap" data-testid="button-upgrade-now">
                {t("trial.upgradeNow")} →
              </button>
            </div>
          )}

          {/* Alerts Panel */}
          <AnimatePresence>
            {isAlertsPanelOpen && (
              <motion.div
                initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }}
                transition={{ type: "tween", duration: 0.2 }}
                className="fixed top-14 left-0 bottom-0 w-full sm:w-80 bg-card border-r border-border z-30 shadow-lg flex flex-col" dir={dir}
              >
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Bell className="w-4 h-4 text-indigo-500" /> {t("dashboard.alerts")}
                  </h3>
                  <div className="flex items-center gap-2">
                    {unreadAlerts.length > 0 && (
                      <button onClick={() => markAllAlertsReadMutation.mutate()} className="text-[10px] text-indigo-500 hover:underline" data-testid="button-mark-all-read">
                        {t("dashboard.markAllRead")}
                      </button>
                    )}
                    <button onClick={() => { setIsAlertsPanelOpen(false); setSelectedAlerts(new Set()); }} className="text-muted-foreground hover:text-foreground">
                      <XCircle className="w-4 h-4" />
                    </button>
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
                      {selectedAlerts.size === alertsList.length ? t("dashboard.deselectAll") : t("dashboard.selectAll")}
                    </button>
                    {selectedAlerts.size > 0 && (
                      <button
                        onClick={() => deleteBulkAlertsMutation.mutate(Array.from(selectedAlerts))}
                        className="text-[10px] text-red-500 hover:text-red-400 flex items-center gap-1 font-medium transition-colors"
                        data-testid="button-delete-selected-alerts"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t("dashboard.deleteSelected")} ({selectedAlerts.size})
                      </button>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {alertsList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <CheckCircle2 className="w-8 h-8 mb-2" />
                      <p className="text-sm">{t("dashboard.noAlerts")}</p>
                    </div>
                  ) : alertsList.map(alert => {
                    const severityColors: Record<string, string> = {
                      low: "border-blue-500/20", medium: "border-amber-500/20",
                      high: "border-orange-500/20", critical: "border-red-500/20",
                    };
                    const isSelected = selectedAlerts.has(alert.id);
                    return (
                      <div
                        key={alert.id}
                        className={`p-3 rounded-lg border ${severityColors[alert.severity] || ""} ${isSelected ? "ring-1 ring-indigo-500/40 bg-indigo-500/5" : !alert.read ? "bg-secondary/50" : "bg-transparent"} transition-colors hover:bg-secondary/30 group`}
                        data-testid={`alert-${alert.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAlerts(prev => {
                                const next = new Set(prev);
                                if (next.has(alert.id)) next.delete(alert.id); else next.add(alert.id);
                                return next;
                              });
                            }}
                            className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${isSelected ? "border-indigo-500 bg-indigo-500" : "border-muted-foreground/40 hover:border-indigo-400"}`}
                          >
                            {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </button>
                          <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${alert.severity === "high" || alert.severity === "critical" ? "text-red-500" : alert.severity === "medium" ? "text-amber-500" : "text-blue-500"}`} />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { if (!alert.read) markAlertReadMutation.mutate(alert.id); }}>
                            <p className="text-xs text-foreground leading-relaxed">{alert.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 font-mono" dir="ltr">
                              {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString(getDateLocale(i18n.language)) : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {!alert.read && <div className="w-2 h-2 bg-indigo-500 rounded-full mt-1" />}
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteAlertMutation.mutate(alert.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all"
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

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>

          {/* Mobile Sidebar Drawer */}
          <AnimatePresence>
            {isMobileSidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                  onClick={() => setIsMobileSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: dir === "rtl" ? 280 : -280 }}
                  animate={{ x: 0 }}
                  exit={{ x: dir === "rtl" ? 280 : -280 }}
                  transition={{ type: "tween", duration: 0.2 }}
                  className={`fixed top-0 ${dir === "rtl" ? "right-0" : "left-0"} bottom-0 w-72 bg-card border-${dir === "rtl" ? "l" : "r"} border-border z-50 lg:hidden flex flex-col`}
                  dir={dir}
                >
                  <div className="h-16 flex items-center justify-between px-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-3">
                      <img src="/logo.png" alt="Vertex Command" className="w-8 h-8 rounded-lg object-contain" />
                      <h1 className="text-base font-semibold text-foreground">{t("app.name")}</h1>
                    </div>
                    <button
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      data-testid="button-close-sidebar"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {sidebarPlatformSection}
                    {sidebarToolsSection}
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
                {t("planLimit.title")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {t(`planLimit.features.${planLimitModal.feature}`)}
              </p>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <Crown className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-medium">
                  {t("planLimit.requiredPlan", { plan: planLimitModal.requiredPlan.charAt(0).toUpperCase() + planLimitModal.requiredPlan.slice(1) })}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPlanLimitModal(null)}>
                  {t("common.close")}
                </Button>
                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => { setPlanLimitModal(null); navigate("/billing"); }}>
                  <Crown className="w-4 h-4 me-2" />
                  {t("planLimit.upgrade")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
