import { useState, useEffect, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, onPlanLimit, onDemoBlock } from "./lib/queryClient";
import type { PlanLimitInfo } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { DemoContext } from "@/hooks/useDemoMode";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import AccountDetail from "@/pages/AccountDetail";
import TradingPriority from "@/pages/TradingPriority";
import Integrations from "@/pages/Integrations";
import Billing from "@/pages/Billing";
import Admin from "@/pages/Admin";
import Help from "@/pages/Help";
import CopyTrading from "@/pages/CopyTrading";
import AuthPage from "@/pages/AuthPage";
import InvestorShowcase from "@/pages/InvestorShowcase";
import Reports from "@/pages/Reports";
import PublicReport from "@/pages/PublicReport";
import Affiliates from "@/pages/Affiliates";
import Partners from "@/pages/Partners";
import LatencyMonitor from "@/pages/LatencyMonitor";
import TradingMonitor from "@/pages/TradingMonitor";
import SystemHealth from "@/pages/SystemHealth";
import GetStarted from "@/pages/GetStarted";
import Journal from "@/pages/Journal";
import WebGL3D from "@/pages/WebGL3D";
import DailyJournal from "@/pages/DailyJournal";
import WeeklyJournal from "@/pages/WeeklyJournal";
import StrategyManagement from "@/pages/StrategyManagement";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { ThemeProvider } from "@/hooks/useTheme";
import { Loader2, ShieldAlert, CreditCard, Lock, Crown, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import FloatingHelpChat from "@/components/FloatingHelpChat";
import AppShell from "@/components/AppShell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import "./i18n";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: unknown }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-lg font-bold">שגיאה בלתי צפויה</h2>
            <p className="text-sm text-muted-foreground">משהו השתבש. נסה לרענן את הדף.</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              רענון
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function TrialExpiredScreen() {
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';

  return (
    <div className="h-full bg-background flex items-center justify-center p-6" dir={dir}>
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-trial-expired-title">{t('trial.expired')}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed" data-testid="text-trial-expired-desc">{t('trial.expiredDesc')}</p>
        <button
          onClick={() => navigate('/billing')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors"
          data-testid="button-choose-plan"
        >
          <CreditCard className="w-4 h-4" />
          {t('trial.choosePlan')}
        </button>
      </div>
    </div>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin";
  useEffect(() => {
    if (!isAdmin) navigate("/");
  }, [isAdmin, navigate]);
  if (!isAdmin) return null;
  return <>{children}</>;
}

function TrialGuard({ children }: { children: React.ReactNode }) {
  const { data: billingStatus, isLoading } = useQuery<{ status: string; daysLeft: number | null }>({
    queryKey: ["/api/v1/billing/status"],
    staleTime: 30000,
  });

  if (isLoading) return null;

  if (billingStatus?.status === 'expired') {
    return <TrialExpiredScreen />;
  }

  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/">{() => <TrialGuard><Dashboard /></TrialGuard>}</Route>
      <Route path="/get-started">{() => <TrialGuard><Shell><GetStarted /></Shell></TrialGuard>}</Route>
      <Route path="/account/:id">{() => <TrialGuard><Shell><AccountDetail /></Shell></TrialGuard>}</Route>
      <Route path="/trading-priority">{() => <TrialGuard><Shell><TradingPriority /></Shell></TrialGuard>}</Route>
      <Route path="/integrations">{() => <TrialGuard><Shell><Integrations /></Shell></TrialGuard>}</Route>
      <Route path="/copy-trading">{() => <TrialGuard><Shell><CopyTrading /></Shell></TrialGuard>}</Route>
      <Route path="/journal">{() => <TrialGuard><Shell><Journal /></Shell></TrialGuard>}</Route>
      <Route path="/trades/daily">{() => <TrialGuard><Shell><DailyJournal /></Shell></TrialGuard>}</Route>
      <Route path="/trades/weekly">{() => <TrialGuard><Shell><WeeklyJournal /></Shell></TrialGuard>}</Route>
      <Route path="/trades/strategy">{() => <TrialGuard><Shell><StrategyManagement /></Shell></TrialGuard>}</Route>
      <Route path="/billing">{() => <Shell><Billing /></Shell>}</Route>
      <Route path="/admin">{() => <TrialGuard><Shell><Admin /></Shell></TrialGuard>}</Route>
      <Route path="/help">{() => <TrialGuard><Shell><Help /></Shell></TrialGuard>}</Route>
      <Route path="/reports">{() => <TrialGuard><Shell><Reports /></Shell></TrialGuard>}</Route>
      <Route path="/affiliates">{() => <TrialGuard><Shell><Affiliates /></Shell></TrialGuard>}</Route>
      <Route path="/partners">{() => <TrialGuard><Shell><Partners /></Shell></TrialGuard>}</Route>
      <Route path="/latency-monitor">{() => <TrialGuard><Shell><LatencyMonitor /></Shell></TrialGuard>}</Route>
      <Route path="/trading-monitor">{() => <TrialGuard><Shell><TradingMonitor /></Shell></TrialGuard>}</Route>
      <Route path="/system-health">{() => <AdminGuard><TrialGuard><Shell><SystemHealth /></Shell></TrialGuard></AdminGuard>}</Route>
      <Route path="/webgl-3d">{() => <TrialGuard><Shell><WebGL3D /></Shell></TrialGuard>}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function GlobalPlanLimitModal() {
  const [info, setInfo] = useState<PlanLimitInfo | null>(null);
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';

  useEffect(() => {
    return onPlanLimit((limitInfo) => {
      setInfo(limitInfo);
    });
  }, []);

  if (!info) return null;

  return (
    <Dialog open={true} onOpenChange={() => setInfo(null)}>
      <DialogContent className="sm:max-w-md" dir={dir}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-amber-500" />
            {t('planLimit.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {t(`planLimit.features.${info.feature}`)}
          </p>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <Crown className="w-5 h-5 text-indigo-500" />
            <span className="text-sm font-medium">
              {t('planLimit.requiredPlan', { plan: info.requiredPlan.charAt(0).toUpperCase() + info.requiredPlan.slice(1) })}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setInfo(null)} data-testid="button-global-plan-limit-close">
              {t('common.close')}
            </Button>
            <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => { setInfo(null); navigate('/billing'); }} data-testid="button-global-plan-limit-upgrade">
              <Crown className="w-4 h-4 me-2" />
              {t('planLimit.upgrade')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DemoBanner() {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 bg-amber-500/90 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 z-50" data-testid="banner-demo-readonly">
      <Lock className="w-4 h-4" />
      {t('demo.readonlyBanner', 'מצב צפייה בלבד — חשבון דמו למשקיעים')}
    </div>
  );
}

function DemoBlockToaster() {
  const { toast } = useToast();

  useEffect(() => {
    return onDemoBlock((msg) => {
      toast({
        title: "מצב צפייה בלבד",
        description: msg,
        variant: "destructive",
      });
    });
  }, [toast]);

  return null;
}

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  const isDemo = !!user?.isDemo;

  return (
    <DemoContext.Provider value={isDemo}>
      {isDemo && <DemoBanner />}
      <AuthenticatedRouter />
      <FloatingHelpChat />
      <GlobalPlanLimitModal />
      {isDemo && <DemoBlockToaster />}
    </DemoContext.Provider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <CurrencyProvider>
            <TooltipProvider>
              <Toaster />
              <Switch>
                <Route path="/investor" component={InvestorShowcase} />
                <Route path="/report/:token" component={PublicReport} />
                <Route>
                  <AppContent />
                </Route>
              </Switch>
            </TooltipProvider>
          </CurrencyProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
