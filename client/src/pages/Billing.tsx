import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useIsDemo } from "@/hooks/useDemoMode";
import { useTranslation } from "react-i18next";
import { isRTL, getDateLocale } from "@/i18n";
import {
  CreditCard, Crown, Zap, Shield, Users, Check, X,
  Loader2, FileText, Star, Sparkles, TrendingUp, BarChart3,
  RefreshCw, Download, Bell, Link2, Bot, Clock, ChevronDown,
  AlertTriangle, BadgeCheck
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

interface Plan {
  id: number; key: string; name: string;
  monthlyPrice: number; yearlyPrice: number;
  maxAccounts: number; maxConnections: number;
  hasIntegrations: boolean; hasAutoSync: boolean;
  hasExports: boolean; hasPriorityEngine: boolean; hasTeamSupport: boolean;
}

interface SubscriptionInfo {
  planKey: string; planName: string; status: string;
  plan: Plan | null; billingCycle?: string; amount?: number;
  cancelAtPeriodEnd?: boolean; currentPeriodEnd?: string;
}

interface PlanMeta {
  gradient: string; border: string; glow: string;
  icon: any; popular?: boolean; taglineKey: string;
  featureKeys: { textKey: string; icon: any }[];
  limitsKey: string;
  limitsParams?: Record<string, any>;
}

const PLAN_META: Record<string, PlanMeta> = {
  free: {
    gradient: "from-neutral-600 to-neutral-800",
    border: "border-neutral-700",
    glow: "",
    icon: Shield,
    taglineKey: "billing.quickStart",
    limitsKey: "billing.upToAccounts",
    limitsParams: { count: 2 },
    featureKeys: [
      { textKey: "billing.basicDashboard", icon: BarChart3 },
      { textKey: "billing.manualManagement", icon: CreditCard },
      { textKey: "billing.balanceTracking", icon: TrendingUp },
    ],
  },
  basic: {
    gradient: "from-blue-600 to-indigo-800",
    border: "border-blue-500",
    glow: "",
    icon: Zap,
    taglineKey: "billing.forPrivateTrader",
    limitsKey: "billing.upToAccounts",
    limitsParams: { count: 5 },
    featureKeys: [
      { textKey: "billing.basicCopyTrading", icon: RefreshCw },
      { textKey: "billing.basicJournal", icon: FileText },
      { textKey: "billing.csvExport", icon: Download },
      { textKey: "billing.features.priorityEngine", icon: Star },
    ],
  },
  pro: {
    gradient: "from-violet-600 to-purple-900",
    border: "border-violet-500",
    glow: "shadow-violet-500/20 shadow-lg",
    icon: Crown,
    popular: true,
    taglineKey: "billing.mostPopular",
    limitsKey: "billing.upToAccounts",
    limitsParams: { count: 15 },
    featureKeys: [
      { textKey: "billing.proCopyTrading", icon: RefreshCw },
      { textKey: "billing.proJournal", icon: FileText },
      { textKey: "billing.features.aiChatbot", icon: Bot },
      { textKey: "billing.features.autoSync", icon: RefreshCw },
      { textKey: "billing.allBasicFeatures", icon: Check },
    ],
  },
  unlimited: {
    gradient: "from-amber-600 to-orange-900",
    border: "border-amber-500",
    glow: "",
    icon: Users,
    taglineKey: "billing.forTeams",
    limitsKey: "billing.unlimitedAccounts",
    featureKeys: [
      { textKey: "billing.unlimitedCopyTrading", icon: RefreshCw },
      { textKey: "billing.unlimitedJournal", icon: FileText },
      { textKey: "billing.features.teamSupport", icon: Users },
      { textKey: "billing.allProFeatures", icon: Check },
      { textKey: "billing.features.prioritySupport", icon: BadgeCheck },
    ],
  },
};

const COMPARE_FEATURE_KEYS = [
  { labelKey: "billing.features.tradingAccounts", free: "2", basic: "5", pro: "15", unlimited: "∞" },
  { labelKey: "billing.features.integrations", free: "1", basic: "3", pro: "10", unlimited: "100" },
  { labelKey: "billing.features.autoSync", free: false, basic: true, pro: true, unlimited: true },
  { labelKey: "billing.features.dataExport", free: false, basic: true, pro: true, unlimited: true },
  { labelKey: "billing.features.priorityEngine", free: false, basic: true, pro: true, unlimited: true },
  { labelKey: "billing.features.smartAlerts", free: false, basic: true, pro: true, unlimited: true },
  { labelKey: "billing.features.aiChatbot", free: false, basic: false, pro: true, unlimited: true },
  { labelKey: "billing.features.monthlyReports", free: false, basic: false, pro: true, unlimited: true },
  { labelKey: "billing.features.teamSupport", free: false, basic: false, pro: false, unlimited: true },
  { labelKey: "billing.features.fullApi", free: false, basic: false, pro: false, unlimited: true },
  { labelKey: "billing.features.prioritySupport", free: false, basic: false, pro: false, unlimited: true },
];

export default function BillingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isDemo = useIsDemo();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';
  const queryClient = useQueryClient();
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [showCompare, setShowCompare] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<string | null>(null);

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/v1/billing/subscription"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["/api/v1/billing/plans"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["/api/v1/billing/invoices"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (data: { planKey: string; billingCycle: string }) => {
      const res = await apiRequest("POST", "/api/v1/billing/create-checkout", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/billing/subscription"] });
        toast({ title: t('billing.planUpdated') });
        setConfirmPlan(null);
      }
    },
    onError: (err: any) => {
      toast({ title: err?.message || t('billing.checkoutError'), variant: "destructive" });
      setConfirmPlan(null);
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async (data: { planKey: string; billingCycle: string }) => {
      const res = await apiRequest("POST", "/api/v1/billing/change-plan", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/billing/subscription"] });
      toast({ title: t('billing.planUpdated') });
      setConfirmPlan(null);
    },
    onError: () => {
      toast({ title: t('billing.changePlanError'), variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v1/billing/cancel");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/billing/subscription"] });
      toast({ title: t('billing.cancelSuccess') });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v1/billing/resume");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/billing/subscription"] });
      toast({ title: t('billing.resumeSuccess') });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      const plan = params.get("plan");
      toast({ title: t('billing.paymentSuccess'), description: plan ? t('billing.planActivated', { plan }) : undefined });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/billing/subscription"] });
      window.history.replaceState({}, "", "/billing");
    } else if (params.get("canceled") === "true") {
      toast({ title: t('billing.paymentCanceled'), description: t('billing.noCharge'), variant: "destructive" });
      window.history.replaceState({}, "", "/billing");
    }
  }, []);

  const currentPlanKey = subscription?.planKey || "free";

  function getPrice(plan: Plan) {
    return billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
  }

  function getMonthlyEquiv(plan: Plan) {
    if (billingCycle === "yearly" && plan.yearlyPrice) {
      return Math.round((plan.yearlyPrice / 12) * 100) / 100;
    }
    return plan.monthlyPrice;
  }

  function getSavings(plan: Plan) {
    if (!plan.monthlyPrice || !plan.yearlyPrice) return 0;
    const yearlyCost = plan.yearlyPrice;
    const monthlyCost = plan.monthlyPrice * 12;
    return Math.round(((monthlyCost - yearlyCost) / monthlyCost) * 100);
  }

  const planOrder = ["free", "basic", "pro", "unlimited"];

  function isUpgrade(targetKey: string) {
    return planOrder.indexOf(targetKey) > planOrder.indexOf(currentPlanKey);
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        <div className="flex flex-col sm:flex-row sm:items-center justify-between rtl:sm:flex-row-reverse mb-8 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-neutral-100" data-testid="text-page-title">{t('billing.title')}</h1>
              <p className="text-xs sm:text-sm text-neutral-500">{t('billing.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
          </div>
        </div>

        <Card className="bg-gradient-to-r from-[#1a1a1a] to-[#252525] border-neutral-800 mb-8">
          <CardContent className="p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                {(() => {
                  const meta = PLAN_META[currentPlanKey];
                  const Icon = meta?.icon || Shield;
                  return (
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${meta?.gradient || 'from-neutral-600 to-neutral-800'} flex items-center justify-center`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  );
                })()}
                <div>
                  <div className="text-xs text-neutral-500 mb-0.5">{t('billing.currentPlan')}</div>
                  <div className="text-xl font-bold text-neutral-100" data-testid="text-current-plan">
                    {subscription?.planName || t('billing.free')}
                  </div>
                  {subscription?.amount ? (
                    <div className="text-sm text-neutral-400">
                      ${subscription.amount}/{subscription.billingCycle === "yearly" ? t('billing.perYear') : t('billing.perMonth')}
                    </div>
                  ) : (
                    <div className="text-sm text-emerald-400">{t('billing.free')}</div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {subscription?.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-amber-400">{t('billing.cancelAtEnd')}</span>
                  </div>
                )}
                {subscription?.currentPeriodEnd && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800/50">
                    <Clock className="w-4 h-4 text-neutral-500" />
                    <span className="text-sm text-neutral-400">
                      {t('billing.renewalDate')}: {new Date(subscription.currentPeriodEnd).toLocaleDateString(getDateLocale(i18n.language))}
                    </span>
                  </div>
                )}
                {subscription?.cancelAtPeriodEnd ? (
                  <Button onClick={() => resumeMutation.mutate()} disabled={isDemo || resumeMutation.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-resume">
                    {resumeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('billing.resumeSubscription')}
                  </Button>
                ) : currentPlanKey !== "free" ? (
                  <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate()} disabled={isDemo || cancelMutation.isPending} className="border-red-800/50 text-red-400 hover:bg-red-900/20" data-testid="button-cancel">
                    {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('billing.cancelSubscription')}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
          <h2 className="text-base sm:text-lg font-semibold text-neutral-200">{t('billing.choosePlan')}</h2>
          <div className="flex items-center gap-1 p-1 bg-neutral-900 rounded-xl border border-neutral-800">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                billingCycle === "monthly"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
              data-testid="button-toggle-monthly"
            >
              {t('billing.monthly')}
            </button>
            <button
              onClick={() => setBillingCycle("yearly")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                billingCycle === "yearly"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
              data-testid="button-toggle-yearly"
            >
              {t('billing.yearly')}
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">
                {t('billing.save20')}
              </Badge>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {plans.map((plan, idx) => {
            const meta = PLAN_META[plan.key];
            if (!meta) return null;
            const PlanIcon = meta.icon;
            const isCurrentPlan = plan.key === currentPlanKey;
            const price = getMonthlyEquiv(plan);
            const savings = getSavings(plan);
            const upgrading = isUpgrade(plan.key);

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.4 }}
                className="relative"
              >
                {meta.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-gradient-to-r from-violet-600 to-purple-600 text-white border-0 px-3 py-1 text-xs shadow-lg shadow-purple-500/30">
                      <Sparkles className="w-3 h-3 ml-1" />
                      {t('billing.mostPopular')}
                    </Badge>
                  </div>
                )}
                <Card
                  className={`h-full bg-[#1a1a1a] transition-all duration-300 hover:translate-y-[-2px] ${
                    isCurrentPlan
                      ? `${meta.border} border-2 ${meta.glow}`
                      : meta.popular
                      ? `${meta.border} border ${meta.glow}`
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  data-testid={`card-plan-${plan.key}`}
                >
                  {isCurrentPlan && (
                    <div className={`h-1 bg-gradient-to-r ${meta.gradient}`} />
                  )}
                  <CardContent className="p-6 flex flex-col h-full">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center mb-4`}>
                      <PlanIcon className="w-5 h-5 text-white" />
                    </div>

                    <div className="text-lg font-bold text-neutral-100">{t(`billing.plans.${plan.key}.name`, { defaultValue: plan.name })}</div>
                    <div className="text-xs text-neutral-500 mb-4">{t(meta.taglineKey)}</div>

                    <div className="flex items-baseline gap-1 mb-1">
                      {price === 0 ? (
                        <span className="text-3xl font-bold text-neutral-100">{t('billing.free')}</span>
                      ) : (
                        <>
                          <span className="text-3xl font-bold text-neutral-100">${price}</span>
                          <span className="text-sm text-neutral-500">/{t('billing.perMonth')}</span>
                        </>
                      )}
                    </div>
                    {billingCycle === "yearly" && savings > 0 && (
                      <div className="text-xs text-emerald-400 mb-3">
                        {t('billing.savingsPercent', { percent: savings })} • {t('billing.perYearPrice', { price: getPrice(plan) })}
                      </div>
                    )}
                    {billingCycle === "monthly" && price > 0 && (
                      <div className="text-xs text-neutral-600 mb-3">&nbsp;</div>
                    )}

                    <div className="text-xs font-medium text-neutral-400 mb-3 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-neutral-500" />
                      {t(meta.limitsKey, meta.limitsParams)}
                    </div>

                    <div className="space-y-2.5 mb-6 flex-1">
                      {meta.featureKeys.map((f, i) => (
                        <div key={i} className="flex items-center gap-2.5 text-sm text-neutral-400">
                          <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                            <f.icon className="w-3 h-3 text-emerald-400" />
                          </div>
                          {t(f.textKey)}
                        </div>
                      ))}
                    </div>

                    {isCurrentPlan ? (
                      <div className="w-full py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-center">
                        <span className="text-sm font-medium text-indigo-400 flex items-center justify-center gap-2">
                          <BadgeCheck className="w-4 h-4" />
                          {t('billing.currentPlanLabel')}
                        </span>
                      </div>
                    ) : confirmPlan === plan.key ? (
                      <div className="space-y-2">
                        <div className="text-xs text-center text-neutral-400 mb-1">
                          {upgrading ? t('billing.upgradeOrChange') : t('billing.changePlan')} {plan.name}?
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              if (plan.monthlyPrice > 0 && upgrading) {
                                checkoutMutation.mutate({ planKey: plan.key, billingCycle });
                              } else {
                                changePlanMutation.mutate({ planKey: plan.key, billingCycle });
                              }
                            }}
                            disabled={checkoutMutation.isPending || changePlanMutation.isPending}
                            className={`flex-1 ${upgrading ? "bg-indigo-600 hover:bg-indigo-700" : "bg-neutral-700 hover:bg-neutral-600"}`}
                            size="sm"
                            data-testid={`button-confirm-plan-${plan.key}`}
                          >
                            {(checkoutMutation.isPending || changePlanMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : upgrading && plan.monthlyPrice > 0 ? t('billing.goToPayment') : t('common.confirm')}
                          </Button>
                          <Button
                            onClick={() => setConfirmPlan(null)}
                            variant="outline"
                            className="flex-1 border-neutral-700 text-neutral-400"
                            size="sm"
                          >
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setConfirmPlan(plan.key)}
                        className={`w-full ${
                          upgrading
                            ? `bg-gradient-to-r ${meta.gradient} hover:opacity-90 text-white`
                            : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                        }`}
                        data-testid={`button-select-plan-${plan.key}`}
                      >
                        {upgrading ? (
                          <>
                            <Zap className="w-4 h-4 ml-2" />
                            {t('billing.upgradeNow')}
                          </>
                        ) : plan.monthlyPrice === 0 ? (
                          t('billing.switchToFree')
                        ) : (
                          t('billing.changePlan')
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <div className="mb-8">
          <button
            onClick={() => setShowCompare(!showCompare)}
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors mx-auto"
            data-testid="button-toggle-compare"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showCompare ? "rotate-180" : ""}`} />
            {showCompare ? t('billing.hideCompare') : t('billing.showCompare')}
          </button>

          <AnimatePresence>
            {showCompare && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <Card className="bg-[#1a1a1a] border-neutral-800 mt-4">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-compare">
                        <thead>
                          <tr className="border-b border-neutral-800">
                            <th className="text-right p-4 text-neutral-400 font-medium w-[200px]">{t('billing.feature')}</th>
                            {["free", "basic", "pro", "unlimited"].map(key => {
                              const p = plans.find(pp => pp.key === key);
                              return (
                                <th key={key} className={`p-4 text-center font-medium ${key === currentPlanKey ? "text-indigo-400" : "text-neutral-400"}`}>
                                  {p?.name || key}
                                  {key === currentPlanKey && (
                                    <div className="text-[10px] text-indigo-500 mt-0.5">{t('billing.currentPlanBadge')}</div>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {COMPARE_FEATURE_KEYS.map((feat, i) => (
                            <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/20">
                              <td className="p-4 text-neutral-300">{t(feat.labelKey)}</td>
                              {(["free", "basic", "pro", "unlimited"] as const).map(key => {
                                const val = (feat as any)[key];
                                return (
                                  <td key={key} className="p-4 text-center">
                                    {val === true ? (
                                      <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                                    ) : val === false ? (
                                      <X className="w-4 h-4 text-neutral-700 mx-auto" />
                                    ) : (
                                      <span className="text-neutral-300 font-medium">{val}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {invoices.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            <h2 className="text-lg font-semibold text-neutral-200 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-neutral-500" />
              {t('billing.invoices.title')}
            </h2>
            <Card className="bg-[#1a1a1a] border-neutral-800">
              <CardContent className="p-0">
                <div className="divide-y divide-neutral-800">
                  {invoices.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between p-3 sm:p-4 hover:bg-neutral-800/20 transition-colors gap-2" data-testid={`row-invoice-${inv.id}`}>
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-neutral-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-300 font-medium truncate">${inv.amount} {inv.currency?.toUpperCase()}</div>
                          <div className="text-xs text-neutral-500">{new Date(inv.createdAt).toLocaleDateString(getDateLocale(i18n.language))}</div>
                        </div>
                      </div>
                      <Badge className={`flex-shrink-0 ${inv.status === "paid"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`
                      }>
                        {inv.status === "paid" ? t('withdrawal.statusPaid') : inv.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}
