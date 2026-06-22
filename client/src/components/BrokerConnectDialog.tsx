import { useState, useCallback, memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, safeBrokerFetch } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import {
  Plug, Loader2, CheckCircle2, ArrowLeft, ArrowRight, Shield,
  Zap, RefreshCw, ChevronRight, ChevronLeft, AlertTriangle, Lock, Monitor, Globe, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/apiBase";

type BrokerKey = "tradovate" | "topstepx";
type ConnectStep = "select" | "environment" | "auth-method" | "credentials" | "validating" | "connecting" | "discovering" | "importing" | "done" | "error";

interface BrokerConfig {
  key: BrokerKey;
  name: string;
  logoSrc: string;
  color: string;
  gradient: string;
  fields: { key: string; type: string; labelKey: string; placeholderKey: string }[];
}

const BROKERS: BrokerConfig[] = [
  {
    key: "tradovate",
    name: "Tradovate",
    logoSrc: "/assets/tradovate-logo.svg",
    color: "text-blue-400",
    gradient: "from-blue-600/20 to-blue-900/20",
    fields: [
      { key: "username", type: "text", labelKey: "broker.username", placeholderKey: "broker.usernamePlaceholder" },
      { key: "password", type: "password", labelKey: "broker.password", placeholderKey: "broker.passwordPlaceholder" },
      { key: "cid", type: "text", labelKey: "broker.clientId", placeholderKey: "broker.clientIdPlaceholder" },
      { key: "secret", type: "password", labelKey: "broker.clientSecret", placeholderKey: "broker.clientSecretPlaceholder" },
    ],
  },
  {
    key: "topstepx",
    name: "TopStepX",
    logoSrc: "/assets/topstepx-logo.svg",
    color: "text-emerald-400",
    gradient: "from-emerald-600/20 to-emerald-900/20",
    fields: [
      { key: "username", type: "text", labelKey: "broker.username", placeholderKey: "broker.usernamePlaceholder" },
      { key: "apiKey", type: "password", labelKey: "broker.apiKey", placeholderKey: "broker.apiKeyPlaceholder" },
    ],
  },
];

export const BrokerConnectDialog = memo(function BrokerConnectDialog() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const rtl = dir === "rtl";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<ConnectStep>("select");
  const [selectedBroker, setSelectedBroker] = useState<BrokerConfig | null>(null);
  const [tradovateEnv, setTradovateEnv] = useState<"demo" | "live">("demo");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [importedCount, setImportedCount] = useState(0);

  const { data: providers = [] } = useQuery<any[]>({ queryKey: ["/api/v1/integrations/providers"] });

  const createConnectionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/v1/integrations/connections", data);
      return res.json();
    },
  });

  const resetDialog = useCallback(() => {
    setStep("select");
    setSelectedBroker(null);
    setTradovateEnv("demo");
    setFormValues({});
    setErrorMessage("");
    setImportedCount(0);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) resetDialog();
  }, [resetDialog]);

  const handleTradovateOAuth = useCallback(async (environment: "demo" | "live") => {
    try {
      const res = await fetch(apiUrl("/api/v1/integrations/tradovate/oauth/status"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to check OAuth status");
      const data = await res.json();
      if (!data.configured) {
        toast({
          title: t("broker.error"),
          description: t("broker.oauthNotConfigured", { defaultValue: "Tradovate OAuth is not configured. Please contact the administrator." }),
          variant: "destructive",
        });
        return;
      }
      window.location.href = apiUrl(`/api/v1/integrations/tradovate/oauth/start?environment=${environment}`);
    } catch {
      toast({
        title: t("broker.error"),
        description: t("broker.connectionError"),
        variant: "destructive",
      });
    }
  }, [toast, t]);

  const handleSelectBroker = useCallback((broker: BrokerConfig) => {
    setSelectedBroker(broker);
    setFormValues({});
    if (broker.key === "tradovate") {
      setStep("environment");
    } else {
      setStep("credentials");
    }
  }, []);

  const handleConnect = useCallback(async () => {
    if (!selectedBroker) return;

    setErrorMessage("");

    if (selectedBroker.key === "tradovate") {
      setStep("validating");
      try {
        const validateRes = await safeBrokerFetch("/api/v1/integrations/validate-tradovate", {
          username: formValues.username,
          password: formValues.password,
          cid: formValues.cid,
          secret: formValues.secret,
          environment: tradovateEnv,
        });
        if (!validateRes.ok) {
          throw new Error(validateRes.message || t("broker.validationFailed"));
        }
      } catch (validateErr: any) {
        setErrorMessage(validateErr?.message || t("broker.validationFailed"));
        setStep("error");
        return;
      }
    }

    setStep("connecting");

    try {
      let apiEndpoint = "";
      let apiBody: Record<string, any> = {};
      let firmName = selectedBroker.name;

      if (selectedBroker.key === "tradovate") {
        apiEndpoint = "/api/v1/integrations/connect-tradovate";
        apiBody = {
          username: formValues.username,
          password: formValues.password,
          cid: formValues.cid,
          secret: formValues.secret,
          environment: tradovateEnv,
        };
        firmName = "Tradovate";
      } else if (selectedBroker.key === "topstepx") {
        apiEndpoint = "/api/v1/integrations/connect-topstepx";
        apiBody = {
          username: formValues.username,
          apiKey: formValues.apiKey,
        };
        firmName = "TopstepX";
      }

      const result = await safeBrokerFetch(apiEndpoint, apiBody);

      if (!result.ok) {
        throw new Error(result.message || t("broker.connectionError"));
      }

      setStep("discovering");

      const discoverData = result.data;
      const realAccounts = discoverData.accounts.map((a: any) => ({
        accountId: a.accountId,
        name: a.name,
        firm: firmName,
        stage: "evaluation_1",
        size: a.size || Math.abs(a.balance) || 50000,
        balance: a.balance || 0,
        maxDrawdown: null,
        drawdownType: "trailing",
        trailingDrawdown: null,
        target: null,
        externalId: a.externalId,
        tradingDays: 0,
        topDayProfit: null,
      }));

      const provider = providers.find((p: any) => p.key === selectedBroker.key);
      if (!provider) throw new Error("Provider not found");

      const connName = `${selectedBroker.name} - ${formValues.username || "Connection"}`;
      let newConnId: number | null = null;

      const newConn = await createConnectionMutation.mutateAsync({
        providerId: provider.id,
        connectionName: connName,
        authType: "credentials",
        encryptedCredentials: JSON.stringify(formValues),
        status: "connected",
      });
      newConnId = newConn.id;

      setStep("importing");

      try {
        const createRes = await apiRequest(
          "POST",
          `/api/v1/integrations/connections/${newConn.id}/auto-create-accounts`,
          { accounts: realAccounts }
        );
        const result = await createRes.json();
        setImportedCount(result.created || realAccounts.length);
      } catch (importErr: any) {
        if (newConnId) {
          try {
            await apiRequest("PATCH", `/api/v1/integrations/connections/${newConnId}`, { status: "error" });
          } catch {}
        }
        throw importErr;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/integrations/connections"] });

      setStep("done");
    } catch (err: any) {
      setErrorMessage(err?.message || t("broker.connectionError"));
      setStep("error");
    }
  }, [selectedBroker, formValues, tradovateEnv, providers, createConnectionMutation, queryClient, t]);

  const isFormValid = selectedBroker?.fields
    .every(f => formValues[f.key]?.trim());

  const BackArrow = rtl ? ArrowRight : ArrowLeft;
  const ForwardChevron = rtl ? ChevronLeft : ChevronRight;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="h-7 lg:h-8 text-[11px] lg:text-xs gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-0 shadow-lg shadow-indigo-500/25"
          data-testid="button-connect-broker"
        >
          <Plug className="w-3.5 h-3.5" />
          {t("broker.connectBroker")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[480px] bg-[#1a1a1a] border-indigo-500/20 text-white p-0 overflow-hidden"
        dir={dir}
      >
        <AnimatePresence mode="wait">
          {step === "select" && (
            <motion.div
              key="select"
              initial={{ opacity: 0, x: rtl ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: rtl ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              className="p-6"
            >
              <DialogHeader className="mb-6">
                <DialogTitle className="text-xl font-bold text-center">
                  {t("broker.connectTitle")}
                </DialogTitle>
                <p className="text-sm text-gray-400 text-center mt-1">
                  {t("broker.selectBroker")}
                </p>
              </DialogHeader>

              <div className="space-y-3">
                {BROKERS.map((broker, idx) => (
                  <button
                    key={broker.key}
                    onClick={() => handleSelectBroker(broker)}
                    className={`w-full relative group rounded-xl border border-gray-700/50 hover:border-indigo-500/50 bg-gradient-to-r ${broker.gradient} p-5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-indigo-500/10 text-start`}
                    data-testid={`button-broker-${broker.key}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
                        <img src={broker.logoSrc} alt={broker.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-base text-white">{broker.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {t(`broker.${broker.key}Desc`)}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 gap-1 px-1.5">
                            <Shield className="w-2.5 h-2.5" /> {t("broker.fullAccess")}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 gap-1 px-1.5">
                            <RefreshCw className="w-2.5 h-2.5" /> {t("broker.liveSync")}
                          </Badge>
                        </div>
                      </div>
                      <ForwardChevron className="w-5 h-5 text-gray-500 group-hover:text-indigo-400 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>

            </motion.div>
          )}

          {step === "environment" && selectedBroker?.key === "tradovate" && (
            <motion.div
              key="environment"
              initial={{ opacity: 0, x: rtl ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: rtl ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              className="p-6"
            >
              <DialogHeader className="mb-5">
                <button
                  onClick={() => { setSelectedBroker(null); setStep("select"); }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors mb-2"
                  data-testid="button-env-back"
                >
                  <BackArrow className="w-3.5 h-3.5" />
                  {t("broker.back")}
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold shadow-lg">
                    T
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-bold">Tradovate</DialogTitle>
                    <p className="text-xs text-gray-400">{t("broker.chooseEnvironment")}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3 mb-4">
                <button
                  onClick={() => { setTradovateEnv("demo"); setStep("auth-method"); }}
                  className="w-full rounded-xl border border-gray-700/50 hover:border-blue-500/50 bg-gradient-to-r from-neutral-800/40 to-neutral-900/40 p-4 text-start transition-all duration-200 hover:scale-[1.02]"
                  data-testid="button-env-demo"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neutral-600 to-neutral-800 flex items-center justify-center text-white shadow-lg">
                      <Monitor className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-white">{t("broker.demoAccount")}</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">{t("broker.demoAccountDesc")}</p>
                      <Badge variant="outline" className="text-[10px] border-neutral-500/30 text-neutral-400 mt-2 px-1.5">
                        demo.tradovateapi.com
                      </Badge>
                    </div>
                    <ForwardChevron className="w-5 h-5 text-gray-500" />
                  </div>
                </button>

                <button
                  onClick={() => { setTradovateEnv("live"); setStep("auth-method"); }}
                  className="w-full rounded-xl border border-gray-700/50 hover:border-emerald-500/50 bg-gradient-to-r from-emerald-900/10 to-emerald-900/20 p-4 text-start transition-all duration-200 hover:scale-[1.02]"
                  data-testid="button-env-live"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white shadow-lg">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-white">{t("broker.liveAccount")}</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">{t("broker.liveAccountDesc")}</p>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 mt-2 px-1.5">
                        live.tradovateapi.com
                      </Badge>
                    </div>
                    <ForwardChevron className="w-5 h-5 text-gray-500" />
                  </div>
                </button>
              </div>

              <div className="mt-3 flex items-start gap-2 px-1">
                <Shield className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {t("broker.tradovateApiNote")}
                </p>
              </div>
            </motion.div>
          )}

          {step === "auth-method" && selectedBroker?.key === "tradovate" && (
            <motion.div
              key="auth-method"
              initial={{ opacity: 0, x: rtl ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: rtl ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              className="p-6"
            >
              <DialogHeader className="mb-5">
                <button
                  onClick={() => setStep("environment")}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors mb-2"
                  data-testid="button-auth-method-back"
                >
                  <BackArrow className="w-3.5 h-3.5" />
                  {t("broker.back")}
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold shadow-lg">
                    T
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-bold">
                      Tradovate
                      <Badge className={`ms-2 text-[10px] px-1.5 py-0 border-0 ${tradovateEnv === "live" ? "bg-emerald-600 text-white" : "bg-neutral-600 text-white"}`}>
                        {tradovateEnv === "live" ? "Live" : "Demo"}
                      </Badge>
                    </DialogTitle>
                    <p className="text-xs text-gray-400">{t("broker.chooseAuthMethod")}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3 mb-4">
                <button
                  onClick={() => { setFormValues({}); setStep("credentials"); }}
                  className="w-full rounded-xl border border-gray-700/50 hover:border-indigo-500/50 bg-gradient-to-r from-indigo-900/10 to-indigo-900/20 p-4 text-start transition-all duration-200 hover:scale-[1.02]"
                  data-testid="button-auth-api"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-lg">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-white">{t("broker.authApiTitle")}</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">{t("broker.authApiDesc")}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-400 gap-1 px-1.5">
                          <Shield className="w-2.5 h-2.5" /> {t("broker.fullAccess")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 gap-1 px-1.5">
                          {t("broker.apiRequired")}
                        </Badge>
                      </div>
                    </div>
                    <ForwardChevron className="w-5 h-5 text-gray-500 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => handleTradovateOAuth(tradovateEnv)}
                  className="w-full rounded-xl border border-gray-700/50 hover:border-emerald-500/50 bg-gradient-to-r from-emerald-900/10 to-emerald-900/20 p-4 text-start transition-all duration-200 hover:scale-[1.02]"
                  data-testid="button-auth-oauth"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white shadow-lg">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-white">{t("broker.authOauthTitle")}</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">{t("broker.authOauthDesc")}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 gap-1 px-1.5">
                          <Shield className="w-2.5 h-2.5" /> {t("broker.noApiRequired")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 gap-1 px-1.5">
                          {t("broker.recommended")}
                        </Badge>
                      </div>
                    </div>
                    <ForwardChevron className="w-5 h-5 text-gray-500 group-hover:text-emerald-400 transition-colors" />
                  </div>
                </button>
              </div>

              <div className="mt-3 flex items-start gap-2 px-1">
                <Shield className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  {t("broker.authMethodNote")}
                </p>
              </div>
            </motion.div>
          )}

          {step === "credentials" && selectedBroker && (
            <motion.div
              key="credentials"
              initial={{ opacity: 0, x: rtl ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: rtl ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              className="p-6"
            >
              <DialogHeader className="mb-5">
                <button
                  onClick={() => setStep(selectedBroker.key === "tradovate" ? "auth-method" : "select")}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors mb-2"
                  data-testid="button-broker-back"
                >
                  <BackArrow className="w-3.5 h-3.5" />
                  {t("broker.back")}
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
                    <img src={selectedBroker.logoSrc} alt={selectedBroker.name} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-bold">
                      {selectedBroker.name}
                      {selectedBroker.key === "tradovate" && (
                        <Badge className={`ms-2 text-[10px] px-1.5 py-0 border-0 ${tradovateEnv === "live" ? "bg-emerald-600 text-white" : "bg-neutral-600 text-white"}`}>
                          {tradovateEnv === "live" ? "Live" : "Demo"}
                        </Badge>
                      )}
                    </DialogTitle>
                    <p className="text-xs text-gray-400">{t("broker.connectSubtitle")}</p>
                  </div>
                </div>
              </DialogHeader>

              {selectedBroker.key === "tradovate" && (
                <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <h4 className="text-xs font-semibold text-blue-400 mb-2">{t("broker.apiKeyInstructions")}</h4>
                  <ol className="text-[11px] text-gray-400 space-y-1.5 list-decimal ps-4">
                    <li>{t("broker.apiStep1")}</li>
                    <li>{t("broker.apiStep2")}</li>
                    <li>{t("broker.apiStep3")}</li>
                    <li>{t("broker.apiStep4")}</li>
                  </ol>
                  <a
                    href="https://trader.tradovate.com/settings/api-access"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2.5 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline underline-offset-2"
                    data-testid="link-tradovate-api-settings"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t("broker.openApiSettings")}
                  </a>
                </div>
              )}

              <div className="space-y-4">
                {selectedBroker.fields.map(field => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-sm text-gray-300">{t(field.labelKey)}</Label>
                    <Input
                      type={field.type}
                      value={formValues[field.key] || ""}
                      onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={t(field.placeholderKey)}
                      className="bg-[#2a2a2a] border-gray-700/50 text-white placeholder:text-gray-500 h-11 focus:border-indigo-500/50 focus:ring-indigo-500/20"
                      data-testid={`input-broker-${field.key}`}
                    />
                    {field.key === "cid" && selectedBroker.key === "tradovate" && (
                      <p className="text-[10px] text-gray-500">
                        {t("broker.cidHelp")}{" "}
                        <a
                          href="https://trader.tradovate.com/settings/api-access"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 underline"
                          data-testid="link-tradovate-api-access"
                        >
                          {t("broker.openApiAccess")}
                        </a>
                      </p>
                    )}
                    {field.key === "secret" && selectedBroker.key === "tradovate" && (
                      <p className="text-[10px] text-gray-500">{t("broker.secretHelp")}</p>
                    )}
                  </div>
                ))}

              </div>

              <Button
                onClick={handleConnect}
                disabled={!isFormValid}
                className="w-full mt-6 h-12 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-indigo-500/25 disabled:opacity-50"
                data-testid="button-broker-login"
              >
                <Zap className="w-4 h-4 me-2" />
                {t("broker.loginButton")}
              </Button>

            </motion.div>
          )}

          {(step === "validating" || step === "connecting" || step === "discovering" || step === "importing") && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="p-8 flex flex-col items-center justify-center min-h-[300px]"
            >
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-600/20 to-purple-600/20 flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                  <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${selectedBroker?.key === "tradovate" ? "from-blue-500 to-blue-700" : selectedBroker?.key === "topstepx" ? "from-emerald-500 to-emerald-700" : "from-orange-500 to-orange-700"} flex items-center justify-center text-white text-[10px] font-bold`}>
                    {selectedBroker?.logo}
                  </div>
                </div>
              </div>
              <h3 className="text-lg font-semibold mt-6 text-white">
                {step === "validating" && t("broker.validatingCredentials")}
                {step === "connecting" && t("broker.connecting")}
                {step === "discovering" && t("broker.discovering")}
                {step === "importing" && t("broker.importing")}
              </h3>
              <p className="text-sm text-gray-400 mt-1">{selectedBroker?.name}</p>

              <div className="flex items-center gap-2 mt-6">
                {(selectedBroker?.key === "tradovate" ? ["validating", "connecting", "discovering", "importing"] : ["connecting", "discovering", "importing"]).map((s, i) => {
                  const steps = selectedBroker?.key === "tradovate" ? ["validating", "connecting", "discovering", "importing"] : ["connecting", "discovering", "importing"];
                  return (
                    <div
                      key={s}
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        steps.indexOf(step) >= i
                          ? "w-8 bg-indigo-500"
                          : "w-4 bg-gray-700"
                      }`}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}

          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, type: "spring" }}
              className="p-8 flex flex-col items-center justify-center min-h-[300px]"
            >
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold mt-5 text-white">
                {t("broker.connectionSuccess")}
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                {t("broker.accountsImported", { count: importedCount })}
              </p>

              <div className="flex items-center gap-3 mt-3">
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  <Shield className="w-3 h-3 me-1" /> {t("broker.fullAccess")}
                </Badge>
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                  <RefreshCw className="w-3 h-3 me-1" /> {t("broker.liveSync")}
                </Badge>
              </div>

              <Button
                onClick={() => handleOpenChange(false)}
                className="mt-8 px-8 h-11 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold"
                data-testid="button-broker-done"
              >
                {t("broker.done")}
              </Button>
            </motion.div>
          )}

          {step === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="p-8 flex flex-col items-center justify-center min-h-[300px]"
            >
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500/20 to-red-600/20 flex items-center justify-center">
                <AlertTriangle className="w-12 h-12 text-red-400" />
              </div>
              <h3 className="text-lg font-bold mt-5 text-white">
                {t("broker.connectionError")}
              </h3>
              <p className="text-sm text-red-400/80 mt-2 text-center max-w-xs">
                {errorMessage}
              </p>

              <div className="flex items-center gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setStep(selectedBroker?.key === "tradovate" ? "auth-method" : "credentials")}
                  className="border-gray-700 text-gray-300 hover:text-white"
                  data-testid="button-broker-try-again"
                >
                  {t("broker.tryAgain")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  className="text-gray-400"
                >
                  {t("broker.done")}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
});
