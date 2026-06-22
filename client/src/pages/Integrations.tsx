import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import { useTranslation } from "react-i18next";
import { isRTL, getDateLocale } from "@/i18n";
import { useTradingStream } from "@/hooks/useTradingStream";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import {
  Plug, Wifi, WifiOff, RefreshCw, Trash2,
  Loader2, CheckCircle2, XCircle, Clock, AlertTriangle,
  User, Lock, Eye, EyeOff, Zap, FileSpreadsheet, Shield,
  ChevronDown, ChevronUp, ExternalLink, Radio,
  Monitor, Globe, ArrowLeft
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/apiBase";

interface Provider {
  id: number; key: string; name: string; category: string;
  supportsOauth: boolean; supportsApiKey: boolean; supportsWebsocket: boolean;
  active: boolean;
}

interface Connection {
  id: number; userId: number; providerId: number; connectionName: string;
  authType: string; integrationMode: string; status: string; lastSuccessAt: string | null;
  lastErrorAt: string | null; lastErrorMessage: string | null;
  settings: Record<string, any> | null;
  provider: Provider | null;
}

const STATUS_STYLE: Record<string, { color: string; bg: string; icon: any }> = {
  connected: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle2 },
  pending: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Clock },
  error: { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  expired: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  disconnected: { color: 'text-muted-foreground', bg: 'bg-neutral-500/10', icon: WifiOff },
};

interface PlatformConfig {
  key: string;
  name: string;
  descKey: string;
  gradient: string;
  iconBg: string;
  fields: { key: string; labelKey: string; placeholderKey: string; type: string; dir?: string }[];
  autoConnect: boolean;
  hintKey: string;
  useOAuth?: boolean;
}

function getPlatforms(): PlatformConfig[] {
  return [
    {
      key: "tradovate",
      name: "Tradovate",
      descKey: "integrations.tradovateDesc",
      gradient: "from-emerald-600 to-emerald-800",
      iconBg: "bg-emerald-500",
      fields: [],
      autoConnect: false,
      hintKey: "integrations.tradovateOAuthHint",
      useOAuth: true,
    },
    {
      key: "topstepx",
      name: "TopstepX",
      descKey: "integrations.topstepDesc",
      gradient: "from-blue-600 to-blue-800",
      iconBg: "bg-blue-500",
      fields: [
        { key: "username", labelKey: "integrations.username", placeholderKey: "integrations.emailPlaceholder", type: "text", dir: "ltr" },
        { key: "apiKey", labelKey: "integrations.apiKeyLabel", placeholderKey: "integrations.apiKeyPlaceholder", type: "password", dir: "ltr" },
      ],
      autoConnect: true,
      hintKey: "integrations.autoConnectHint",
    },
    {
      key: "csv_import",
      name: "CSV",
      descKey: "integrations.csvDesc",
      gradient: "from-neutral-600 to-neutral-700",
      iconBg: "bg-neutral-500",
      fields: [
        { key: "filename", labelKey: "integrations.filename", placeholderKey: "integrations.filename", type: "text", dir: "ltr" },
      ],
      autoConnect: false,
      hintKey: "integrations.csvImportDesc",
    },
  ];
}

export default function IntegrationsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const queryClient = useQueryClient();
  const { isConnectionLive, getConnectionState, isExecConnectionLive } = useTradingStream();
  const PLATFORMS = getPlatforms();
  const [connectPlatform, setConnectPlatform] = useState<PlatformConfig | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [connectStep, setConnectStep] = useState<"form" | "auth-method" | "credentials" | "connecting" | "discovering" | "selecting" | "creating" | "done">("form");
  const [tradovateEnv, setTradovateEnv] = useState<"demo" | "live">("demo");
  const [discoveredAccounts, setDiscoveredAccounts] = useState<{ accountId: string; name: string; firm: string; tier?: string; stage: string; size: number; balance: number; maxDrawdown?: number; drawdownType?: string; trailingDrawdown?: number; consistencyRule?: number; target?: number; externalId?: string; tradingDays?: number; topDayProfit?: number }[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [expandedConnections, setExpandedConnections] = useState<Set<number>>(new Set());
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [pendingConnectionId, setPendingConnectionId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthError = params.get("oauth_error");
    const imported = params.get("imported");
    const broker = params.get("broker");
    const env = params.get("env");

    if (oauthSuccess) {
      toast({
        title: "✓",
        description: t("broker.oauthSuccess", { count: imported || "0", broker: broker || "Tradovate", env: env || "" }),
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      window.history.replaceState({}, "", "/integrations");
    } else if (oauthError) {
      toast({
        title: t("broker.error"),
        description: t("broker.oauthError", { error: oauthError }),
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ["/api/v1/integrations/providers"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: connections = [], isLoading } = useQuery<Connection[]>({
    queryKey: ["/api/v1/integrations/connections"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (connections.length > 0 && expandedConnections.size === 0) {
      setExpandedConnections(new Set(connections.map(c => c.id)));
    }
  }, [connections]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/integrations/connections", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
    },
    onError: (err: any) => {
      toast({ title: t('integrations.createError'), description: err?.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/v1/integrations/connections/${id}/sync`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: t('integrations.syncStarted'), variant: "success" });
    },
    onError: (err: any) => {
      toast({ title: t('integrations.syncError'), description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v1/integrations/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/balance-history"] });
      toast({ title: t('integrations.connectionDeleted'), variant: "success" });
    },
    onError: () => {
      toast({ title: t('integrations.deleteError'), variant: "destructive" });
    },
  });

  const toggleModeMutation = useMutation({
    mutationFn: async ({ id, mode }: { id: number; mode: string }) => {
      const res = await apiRequest("PATCH", `/api/v1/integrations/connections/${id}/mode`, { integrationMode: mode });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: vars.mode === 'full' ? t('integrations.fullModeEnabled') : t('integrations.syncModeEnabled'), variant: "success" });
    },
    onError: (err: any) => {
      toast({ title: t('integrations.modeError'), description: err?.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/v1/integrations/connections/${id}/test`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: t('integrations.testSuccess'), variant: "success" });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });
      toast({ title: t('integrations.testError'), description: err?.message, variant: "destructive" });
    },
  });

  const fetchTradesMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/v1/integrations/connections/${id}/fetch-trades`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
      const totalTrades = data.results?.reduce((sum: number, r: any) => sum + r.tradesFromApi, 0) || 0;
      const newTrades = data.results?.reduce((sum: number, r: any) => sum + r.newTradesSaved, 0) || 0;
      toast({ title: t('integrations.tradesFetched'), description: `${totalTrades} ${t('integrations.tradesFound')}, ${newTrades} ${t('integrations.newTradesSaved')}`, variant: "success" });
    },
    onError: (err: any) => {
      toast({ title: t('integrations.fetchTradesError'), description: err?.message, variant: "destructive" });
    },
  });


  const handleTradovateOAuth = useCallback(async (environment: "demo" | "live") => {
    try {
      const res = await fetch(apiUrl("/api/v1/integrations/tradovate/oauth/status"), { credentials: "include" });
      if (!res.ok) {
        toast({ title: t('common.error'), description: "Tradovate OAuth is not available", variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (!data.configured) {
        toast({ title: t('common.error'), description: t("integrations.oauthNotConfigured", { defaultValue: "Tradovate OAuth is not configured. Please contact the administrator." }), variant: "destructive" });
        return;
      }
      window.location.href = apiUrl(`/api/v1/integrations/tradovate/oauth/start?environment=${environment}`);
    } catch {
      toast({ title: t('common.error'), description: "Failed to start OAuth", variant: "destructive" });
    }
  }, [toast, t]);

  const openConnect = useCallback((platform: PlatformConfig) => {
    if (platform.useOAuth) {
      setConnectPlatform(platform);
      setFormValues({});
      setConnectStep("form");
      setDiscoveredAccounts([]);
      setCreatedCount(0);
      return;
    }
    setConnectPlatform(platform);
    setFormValues({});
    setShowPasswords({});
    setConnectStep("form");
    setDiscoveredAccounts([]);
    setCreatedCount(0);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!connectPlatform) {
      toast({
        title: t('integrations.connectionError'),
        description: t('integrations.checkDetails'),
        variant: "destructive",
      });
      return;
    }
    const provider = providers.find(p => p.key === connectPlatform.key);
    if (!provider) {
      toast({
        title: t('integrations.connectionError'),
        description: `Provider "${connectPlatform.key}" is not registered. The integration_providers table may be missing seed data — run scripts/seed-providers.ts.`,
        variant: "destructive",
      });
      return;
    }

    setConnectStep("connecting");

    const credentials = JSON.stringify(formValues);
    const connName = `${connectPlatform.name} - ${formValues.username || formValues.filename || t('integrations.connection')}`;

    try {
      const platformsWithRealApi = ["topstepx", "tradovate"];

      if (platformsWithRealApi.includes(connectPlatform.key)) {
        let apiEndpoint = "";
        let apiBody: Record<string, any> = {};
        let firmName = connectPlatform.name;

        if (connectPlatform.key === "tradovate") {
          apiEndpoint = "/api/v1/integrations/connect-tradovate";
          apiBody = {
            username: formValues.username,
            password: formValues.password,
            cid: formValues.cid,
            secret: formValues.secret,
            environment: tradovateEnv,
          };
          firmName = "Tradovate";
        } else if (connectPlatform.key === "topstepx") {
          apiEndpoint = "/api/v1/integrations/connect-topstepx";
          apiBody = {
            username: formValues.username,
            apiKey: formValues.apiKey,
          };
          firmName = "TopstepX";
        }

        const discoverRes = await apiRequest("POST", apiEndpoint, apiBody);
        const discoverData = await discoverRes.json();

        if (!discoverData.success) {
          throw new Error(discoverData.message || t('integrations.connectionError'));
        }

        setConnectStep("discovering");

        const realAccounts = discoverData.accounts.map((a: any) => ({
          accountId: a.accountId,
          name: a.name,
          firm: firmName,
          stage: "evaluation_1",
          size: a.size || 50000,
          balance: a.balance || 0,
          maxDrawdown: a.maxDrawdown || null,
          drawdownType: a.drawdownType || "trailing",
          trailingDrawdown: a.trailingDrawdown || null,
          target: a.target || null,
          consistencyRule: a.consistencyRule || null,
          externalId: a.externalId,
          tradingDays: 0,
          topDayProfit: null,
        }));

        setDiscoveredAccounts(realAccounts);
        setSelectedAccounts(new Set(realAccounts.map((a: any) => a.accountId)));

        const newConn = await createMutation.mutateAsync({
          providerId: provider.id,
          connectionName: connName,
          authType: "credentials",
          encryptedCredentials: credentials,
          status: "connected",
        });

        setPendingConnectionId(newConn.id);
        setConnectStep("creating");
        try {
          const createRes = await apiRequest("POST", `/api/v1/integrations/connections/${newConn.id}/auto-create-accounts`, {
            accounts: realAccounts,
          });
          const result = await createRes.json();
          setCreatedCount(result.created || realAccounts.length);
          queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/v1/trades/monthly-pnl"] });
        } catch (autoErr: any) {
          console.error("Auto-create accounts error:", autoErr);
        }
        setConnectStep("done");
      } else {
        const newConn = await createMutation.mutateAsync({
          providerId: provider.id,
          connectionName: connName,
          authType: connectPlatform.key === "csv_import" ? "file" : "credentials",
          encryptedCredentials: credentials,
          status: "connected",
        });

        if (connectPlatform.autoConnect) {
          setConnectStep("discovering");
          await new Promise(r => setTimeout(r, 1500));
          setDiscoveredAccounts([]);
          setConnectStep("creating");
        }
      }

      setConnectStep("done");
    } catch (err: any) {
      setConnectStep(connectPlatform.key === "tradovate" ? "credentials" : "form");
      toast({ title: t('integrations.connectionError'), description: err?.message || t('integrations.checkDetails'), variant: "destructive" });
    }
  }, [connectPlatform, formValues, tradovateEnv, providers, createMutation, toast, queryClient, t]);

  const handleConfirmSelection = useCallback(async () => {
    if (!pendingConnectionId) return;
    const accountsToCreate = discoveredAccounts.filter(a => selectedAccounts.has(a.accountId));
    if (accountsToCreate.length === 0) {
      setConnectStep("done");
      setCreatedCount(0);
      return;
    }
    setConnectStep("creating");
    try {
      const createRes = await apiRequest("POST", `/api/v1/integrations/connections/${pendingConnectionId}/auto-create-accounts`, {
        accounts: accountsToCreate,
      });
      const result = await createRes.json();
      setCreatedCount(result.created || accountsToCreate.length);
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      setConnectStep("done");
    } catch (err: any) {
      toast({ title: t('integrations.createError'), description: err?.message, variant: "destructive" });
      setConnectStep("selecting");
    }
  }, [pendingConnectionId, discoveredAccounts, selectedAccounts, queryClient, toast, t]);

  const isFormValid = connectPlatform?.fields.every(f => formValues[f.key]?.trim());

  const getConnectionsForPlatform = (key: string) =>
    connections.filter(c => c.provider?.key === key);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between rtl:sm:flex-row-reverse mb-4 sm:mb-8 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
              <Plug className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="text-page-title">{t('integrations.title')}</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">{t('integrations.connectPlatforms')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <LanguageSwitcher />
          </div>
        </div>

        <div className="space-y-4 mb-10">
          {PLATFORMS.map(platform => {
            const platformConns = getConnectionsForPlatform(platform.key);
            const isConnected = platformConns.some(c => c.status === "connected");

            return (
              <Card key={platform.key} className="bg-card border-border overflow-hidden" data-testid={`card-platform-${platform.key}`}>
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-5">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${platform.gradient} flex items-center justify-center shrink-0`}>
                      {platform.key === "csv_import"
                        ? <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                        : <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base sm:text-lg font-bold text-foreground">{platform.name}</h3>
                        {isConnected && (
                          <Badge className="bg-emerald-500/10 text-emerald-400 border-0 text-[10px] gap-1">
                            <CheckCircle2 className="w-3 h-3" /> {t('integrations.connected')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{t(platform.descKey)}</p>
                      {platform.autoConnect && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Shield className="w-3 h-3 text-indigo-400" />
                          <span className="text-[11px] text-indigo-400">{t('integrations.autoConnectHint')}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      {platformConns.length > 0 && (
                        <Button variant="ghost" size="sm"
                          onClick={() => setExpandedConnections(prev => {
                            const next = new Set(prev);
                            if (next.has(platformConns[0].id)) {
                              platformConns.forEach(c => next.delete(c.id));
                            } else {
                              platformConns.forEach(c => next.add(c.id));
                            }
                            return next;
                          })}
                          className="text-muted-foreground hover:text-foreground gap-1 text-xs"
                          data-testid={`button-toggle-${platform.key}`}>
                          {platformConns.length} {t('integrations.connections')}
                          {expandedConnections.has(platformConns[0]?.id)
                            ? <ChevronUp className="w-3.5 h-3.5" />
                            : <ChevronDown className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => openConnect(platform)}
                        className={`gap-2 ${isConnected ? 'bg-neutral-700 hover:bg-neutral-600' : `bg-gradient-to-r ${platform.gradient} hover:opacity-90`}`}
                        data-testid={`button-connect-${platform.key}`}>
                        {isConnected ? t('integrations.anotherConnection') : t('integrations.connectNow')}
                      </Button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {platformConns.length > 0 && expandedConnections.has(platformConns[0]?.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden">
                        <div className="border-t border-border bg-muted/30 px-5 py-3 space-y-2">
                          {platformConns.map(conn => {
                            const statusInfo = STATUS_STYLE[conn.status] || STATUS_STYLE.pending;
                            const StatusIcon = statusInfo.icon;
                            return (
                              <div key={conn.id} className="rounded-lg bg-card border border-border/50 py-2 px-3" data-testid={`card-connection-${conn.id}`}>
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0 flex-wrap">
                                  <div className="relative shrink-0">
                                    <Wifi className={`w-4 h-4 ${statusInfo.color}`} />
                                    <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#1a1a1a] ${conn.status === 'connected' ? 'bg-emerald-500' : conn.status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium text-foreground truncate">{conn.connectionName}</span>
                                      <Badge
                                        className={`text-[9px] border-0 ${isDemo ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} shrink-0 ${conn.integrationMode === 'full' ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-neutral-500/20 text-muted-foreground hover:bg-neutral-500/30'}`}
                                        onClick={() => { if (!isDemo) toggleModeMutation.mutate({ id: conn.id, mode: conn.integrationMode === 'full' ? 'sync' : 'full' }); }}
                                        data-testid={`badge-mode-${conn.id}`}
                                      >
                                        {conn.integrationMode === 'full' ? t('integrations.fullMode') : t('integrations.syncMode')}
                                      </Badge>
                                    </div>
                                    {conn.lastSuccessAt && (
                                      <div className="text-[10px] text-muted-foreground">
                                        {t('integrations.lastSync')}: {new Date(conn.lastSuccessAt).toLocaleDateString(getDateLocale(i18n.language))}
                                      </div>
                                    )}
                                  </div>
                                  <Badge className={`${statusInfo.color} ${statusInfo.bg} border-0 text-[10px] gap-1 shrink-0`}>
                                    <StatusIcon className="w-3 h-3" />
                                    {t(`integrations.${conn.status}`)}
                                  </Badge>
                                  {isConnectionLive(conn.id) && (
                                    <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[9px] gap-1 animate-pulse shrink-0" data-testid={`badge-data-live-${conn.id}`}>
                                      <Radio className="w-2.5 h-2.5" />
                                      Data
                                    </Badge>
                                  )}
                                  {isExecConnectionLive(conn.id) && (
                                    <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[9px] gap-1 animate-pulse shrink-0" data-testid={`badge-exec-live-${conn.id}`}>
                                      <Radio className="w-2.5 h-2.5" />
                                      Exec
                                    </Badge>
                                  )}
                                  {getConnectionState(conn.id) === "reconnecting" && (
                                    <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[9px] gap-1 shrink-0" data-testid={`badge-reconnecting-${conn.id}`}>
                                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                      Reconnecting
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex gap-1.5 items-center shrink-0 self-end sm:self-auto">
                                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-emerald-400" onClick={() => testConnectionMutation.mutate(conn.id)} disabled={isDemo || testConnectionMutation.isPending} data-testid={`button-test-${conn.id}`} title={t('integrations.test')}>
                                    <Zap className={`w-3.5 h-3.5 ${testConnectionMutation.isPending ? 'animate-pulse' : ''}`} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-foreground" onClick={() => syncMutation.mutate(conn.id)} disabled={isDemo || syncMutation.isPending} data-testid={`button-sync-${conn.id}`} title={t('integrations.syncNow')}>
                                    <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                                  </Button>
                                  {conn.provider?.key === "topstepx" && (
                                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-amber-400" onClick={() => fetchTradesMutation.mutate(conn.id)} disabled={isDemo || fetchTradesMutation.isPending} data-testid={`button-fetch-trades-${conn.id}`} title={t('integrations.fetchTrades')}>
                                      <FileSpreadsheet className={`w-3.5 h-3.5 ${fetchTradesMutation.isPending ? 'animate-pulse' : ''}`} />
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-400" onClick={() => deleteMutation.mutate(conn.id)} disabled={isDemo} data-testid={`button-delete-${conn.id}`} title={t('integrations.disconnect')}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>

                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {connections.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">{t('integrations.connectionSummary')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{connections.length}</div>
                <div className="text-[11px] text-muted-foreground">{t('integrations.totalConnections')}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{connections.filter(c => c.status === "connected").length}</div>
                <div className="text-[11px] text-muted-foreground">{t('integrations.active')}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{connections.filter(c => c.status === "error").length}</div>
                <div className="text-[11px] text-muted-foreground">{t('integrations.errors')}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-indigo-400">{new Set(connections.map(c => c.provider?.key).filter(Boolean)).size}</div>
                <div className="text-[11px] text-muted-foreground">{t('integrations.platforms')}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!connectPlatform} onOpenChange={open => { if (!open) setConnectPlatform(null); }}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md max-h-[85vh] overflow-y-auto" dir={dir} onOpenAutoFocus={e => e.preventDefault()}>
          {connectPlatform && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${connectPlatform.gradient} flex items-center justify-center`}>
                    {connectPlatform.key === "csv_import"
                      ? <FileSpreadsheet className="w-5 h-5 text-white" />
                      : <Zap className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <DialogTitle className="text-foreground text-lg">
                      {connectStep === "done" ? t('integrations.connectionSuccess') : `${t('integrations.connect')} ${connectPlatform.name}`}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                      {connectStep === "done" ? t('integrations.accountsCreated') : t(connectPlatform.hintKey)}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {connectStep === "form" && connectPlatform.useOAuth && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-4">
                  <div className="text-center space-y-2 mb-4">
                    <Shield className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-sm text-foreground">{t('broker.chooseEnvironment')}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={() => { setTradovateEnv("demo"); setConnectStep("auth-method"); }}
                      className="h-20 flex-col gap-2 bg-neutral-700/50 hover:bg-neutral-600/50 border border-neutral-600 text-white"
                      data-testid="button-tradovate-demo">
                      <Monitor className="w-5 h-5 text-foreground" />
                      <span className="text-sm font-medium">Demo</span>
                      <span className="text-[10px] text-muted-foreground">demo.tradovateapi.com</span>
                    </Button>
                    <Button
                      onClick={() => { setTradovateEnv("live"); setConnectStep("auth-method"); }}
                      className="h-20 flex-col gap-2 bg-emerald-700/30 hover:bg-emerald-600/30 border border-emerald-600/50 text-white"
                      data-testid="button-tradovate-live">
                      <Globe className="w-5 h-5 text-emerald-400" />
                      <span className="text-sm font-medium">Live</span>
                      <span className="text-[10px] text-emerald-400/70">live.tradovateapi.com</span>
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">{t('broker.tradovateApiNote')}</p>
                </motion.div>
              )}

              {connectStep === "auth-method" && connectPlatform?.key === "tradovate" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-4">
                  <button
                    onClick={() => setConnectStep("form")}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
                    data-testid="button-auth-method-back"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {t("broker.back")}
                  </button>
                  <div className="text-center space-y-1 mb-2">
                    <p className="text-sm text-foreground">{t('broker.chooseAuthMethod')}</p>
                    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${tradovateEnv === "live" ? "bg-emerald-600/20 text-emerald-400" : "bg-neutral-600/30 text-muted-foreground"}`}>
                      {tradovateEnv === "live" ? "Live" : "Demo"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={() => { setFormValues({}); setConnectStep("credentials"); }}
                      className="w-full rounded-xl border border-border/50 hover:border-indigo-500/50 bg-gradient-to-r from-indigo-900/10 to-indigo-900/20 p-4 text-start transition-all duration-200 hover:scale-[1.01]"
                      data-testid="button-auth-api"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-lg shrink-0">
                          <Lock className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm text-white">{t("broker.authApiTitle")}</h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{t("broker.authApiDesc")}</p>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleTradovateOAuth(tradovateEnv)}
                      disabled
                      className="relative w-full rounded-xl border border-border/50 bg-gradient-to-r from-emerald-900/10 to-emerald-900/20 p-4 text-start transition-all duration-200 opacity-60 cursor-not-allowed"
                      data-testid="button-auth-oauth"
                    >
                      <span className="absolute -top-2 -right-2 rotate-12 bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-md shadow-lg border border-red-400/50 uppercase tracking-wide">
                        Coming Soon
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white shadow-lg shrink-0">
                          <Globe className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm text-white">{t("broker.authOauthTitle")}</h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{t("broker.authOauthDesc")}</p>
                        </div>
                      </div>
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">{t('broker.authMethodNote')}</p>
                </motion.div>
              )}

              {connectStep === "credentials" && connectPlatform?.key === "tradovate" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-2">
                  <button
                    onClick={() => setConnectStep("auth-method")}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
                    data-testid="button-credentials-back"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {t("broker.back")}
                  </button>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${tradovateEnv === "live" ? "bg-emerald-600/20 text-emerald-400" : "bg-neutral-600/30 text-muted-foreground"}`}>
                      {tradovateEnv === "live" ? "Live" : "Demo"}
                    </span>
                    <span className="text-[10px] text-indigo-400">{t("broker.authApiTitle")}</span>
                  </div>
                  {[
                    { key: "username", type: "text", labelKey: "broker.username", placeholderKey: "broker.usernamePlaceholder" },
                    { key: "password", type: "password", labelKey: "broker.password", placeholderKey: "broker.passwordPlaceholder" },
                    { key: "cid", type: "text", labelKey: "broker.clientId", placeholderKey: "broker.clientIdPlaceholder" },
                    { key: "secret", type: "password", labelKey: "broker.clientSecret", placeholderKey: "broker.clientSecretPlaceholder" },
                  ].map(field => (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        {field.type === "password" ? <Lock className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {t(field.labelKey)}
                      </Label>
                      <div className="relative">
                        <Input
                          type={field.type === "password" && !showPasswords[field.key] ? "password" : "text"}
                          value={formValues[field.key] || ""}
                          onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={t(field.placeholderKey)}
                          className="bg-secondary border-border focus:border-indigo-500/50 h-11 text-sm"
                          dir="ltr"
                          data-testid={`input-tradovate-${field.key}`}
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showPasswords[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    onClick={handleConnect}
                    disabled={!formValues.username?.trim() || !formValues.password?.trim() || !formValues.cid?.trim() || !formValues.secret?.trim()}
                    className="w-full h-11 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-medium gap-2"
                    data-testid="button-tradovate-api-connect"
                  >
                    <Zap className="w-4 h-4" />
                    {t('integrations.connect')} Tradovate
                  </Button>
                </motion.div>
              )}

              {connectStep === "form" && !connectPlatform.useOAuth && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-2">
                  {connectPlatform.fields.map(field => (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        {field.type === "password" ? <Lock className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {t(field.labelKey)}
                      </Label>
                      <div className="relative">
                        <Input
                          type={field.type === "password" && !showPasswords[field.key] ? "password" : "text"}
                          value={formValues[field.key] || ""}
                          onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={t(field.placeholderKey)}
                          className="bg-secondary border-border focus:border-indigo-500/50 h-11 text-sm"
                          dir={field.dir || "rtl"}
                          data-testid={`input-${field.key}`}
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            data-testid={`toggle-password-${field.key}`}>
                            {showPasswords[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    onClick={handleConnect}
                    disabled={!isFormValid || createMutation.isPending}
                    className={`w-full h-11 gap-2 bg-gradient-to-r ${connectPlatform.gradient} hover:opacity-90 text-white font-medium`}
                    data-testid="button-submit-connect">
                    <Zap className="w-4 h-4" />
                    {t('integrations.connect')} {connectPlatform.name}
                  </Button>
                </motion.div>
              )}

              {connectStep === "connecting" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-8 text-center space-y-4">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${connectPlatform.gradient} flex items-center justify-center mx-auto`}>
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('integrations.connecting')}</p>
                  </div>
                </motion.div>
              )}

              {connectStep === "discovering" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-8 text-center space-y-4">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${connectPlatform.gradient} flex items-center justify-center mx-auto`}>
                    <RefreshCw className="w-8 h-8 text-white animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('integrations.discoveringAccounts')}</p>
                  </div>
                </motion.div>
              )}

              {connectStep === "selecting" && discoveredAccounts.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 space-y-4">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{t('integrations.connectionSuccess')}</p>
                    <p className="text-xs text-emerald-400 mt-1">{t('integrations.accountsCreated')}</p>
                  </div>

                  <div className="bg-muted/30 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Wifi className="w-3 h-3 text-emerald-400" />
                        {t('integrations.discoveredAccounts')}
                      </p>
                      <button
                        onClick={() => {
                          if (selectedAccounts.size === discoveredAccounts.length) {
                            setSelectedAccounts(new Set());
                          } else {
                            setSelectedAccounts(new Set(discoveredAccounts.map(a => a.accountId)));
                          }
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                        data-testid="button-toggle-all-accounts"
                      >
                        {selectedAccounts.size === discoveredAccounts.length ? t('integrations.deselectAll') : t('integrations.selectAll')}
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-[35vh] overflow-y-auto">
                      {discoveredAccounts.map((acc, i) => {
                        const isSelected = selectedAccounts.has(acc.accountId);
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedAccounts(prev => {
                              const next = new Set(prev);
                              if (next.has(acc.accountId)) next.delete(acc.accountId);
                              else next.add(acc.accountId);
                              return next;
                            })}
                            className={`w-full flex items-center justify-between py-2 px-3 rounded-md border transition-colors text-start ${isSelected ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-card border-border/50 opacity-50'}`}
                            data-testid={`button-select-account-${i}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-indigo-400 bg-indigo-500' : 'border-neutral-600 bg-transparent'}`}>
                                {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm text-foreground font-medium truncate" dir="ltr">{acc.accountId}</div>
                                <div className="text-[10px] text-muted-foreground">{acc.tier || acc.stage} · ${acc.size.toLocaleString()}</div>
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0" dir="ltr">${acc.balance.toLocaleString()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Button
                    onClick={handleConfirmSelection}
                    disabled={selectedAccounts.size === 0}
                    className={`w-full h-11 gap-2 bg-gradient-to-r ${connectPlatform.gradient} hover:opacity-90 text-white font-medium`}
                    data-testid="button-confirm-sync"
                  >
                    <Zap className="w-4 h-4" />
                    {t('integrations.syncSelected')} ({selectedAccounts.size})
                  </Button>
                </motion.div>
              )}

              {connectStep === "creating" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-8 text-center space-y-4">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${connectPlatform.gradient} flex items-center justify-center mx-auto`}>
                    <Zap className="w-8 h-8 text-white animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('integrations.creatingAccounts')}</p>
                  </div>
                </motion.div>
              )}

              {connectStep === "done" && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-4 space-y-4">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{t('integrations.connectionSuccess')}</p>
                    {createdCount > 0 && (
                      <p className="text-xs text-emerald-400 mt-1">{t('integrations.accountsCreated')}</p>
                    )}
                  </div>

                  {discoveredAccounts.length > 0 && (
                    <div className="bg-muted/30 border border-border rounded-lg p-4">
                      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Wifi className="w-3 h-3 text-emerald-400" />
                        {t('integrations.discoveredAccounts')}
                      </p>
                      <div className="space-y-1.5">
                        {discoveredAccounts.map((acc, i) => (
                          <div key={i} className="flex items-center justify-between py-2 px-3 bg-card rounded-md border border-border/50">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <div>
                                <div className="text-sm text-foreground font-medium" dir="ltr">{acc.accountId}</div>
                                <div className="text-[10px] text-muted-foreground">{acc.tier || acc.stage} · ${acc.size.toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={() => { setConnectPlatform(null); navigate("/"); }}
                      className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 gap-2"
                      data-testid="button-go-dashboard">
                      <ExternalLink className="w-3.5 h-3.5" /> {t('nav.dashboard')}
                    </Button>
                    <Button
                      onClick={() => setConnectPlatform(null)}
                      variant="outline"
                      className="flex-1 h-10 border-border text-foreground hover:text-foreground"
                      data-testid="button-done">
                      {t('integrations.done')}
                    </Button>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
