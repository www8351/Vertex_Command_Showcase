import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  TrendingUp, Users, DollarSign, BarChart3, Zap,
  Target, Globe, ArrowRight, CheckCircle2, Star, Layers,
  Bot, Bell, RefreshCw, Crown,
  Activity, Briefcase, LineChart,
  Copy, BookOpen, Lock, Award, Rocket, Mail,
  Shield
} from "lucide-react";
import { motion, useInView } from "framer-motion";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Line, ComposedChart
} from "recharts";
import { apiUrl } from "@/lib/apiBase";

interface Metrics {
  totalUsers: number;
  activeSubscriptions: number;
  totalMRR: number;
}

const PRICING_TIERS = [
  { key: "free", monthly: 0, yearly: 0, accounts: 2 },
  { key: "basic", monthly: 29, yearly: 278, accounts: 5 },
  { key: "pro", monthly: 79, yearly: 758, accounts: 15 },
  { key: "unlimited", monthly: 199, yearly: 1910, accounts: -1 },
];

const DEFAULT_PROJECTIONS = {
  month1Users: 50, month3Users: 200, month6Users: 800,
  month12Users: 3000, month18Users: 8000, month24Users: 20000,
  conversionRate: 15, avgRevPerUser: 55,
};

function AnimatedSection({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function InvestorShowcase() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { formatCurrency } = useCurrency();

  const [projections, setProjections] = useState(DEFAULT_PROJECTIONS);
  const [editingProjections, setEditingProjections] = useState(false);
  const [pricingCycle, setPricingCycle] = useState<"monthly" | "yearly">("monthly");

  const { data: metrics } = useQuery<Metrics>({
    queryKey: ["/api/v1/public/metrics"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/public/metrics"));
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    staleTime: 60000,
  });

  const toggleLang = () => {
    const current = i18n.language.split("-")[0];
    i18n.changeLanguage(current === "he" ? "en" : "he");
  };

  const growthData = [
    { month: t("investor.months.m1"), users: projections.month1Users, revenue: Math.round(projections.month1Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
    { month: t("investor.months.m3"), users: projections.month3Users, revenue: Math.round(projections.month3Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
    { month: t("investor.months.m6"), users: projections.month6Users, revenue: Math.round(projections.month6Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
    { month: t("investor.months.m12"), users: projections.month12Users, revenue: Math.round(projections.month12Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
    { month: t("investor.months.m18"), users: projections.month18Users, revenue: Math.round(projections.month18Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
    { month: t("investor.months.m24"), users: projections.month24Users, revenue: Math.round(projections.month24Users * projections.conversionRate / 100 * projections.avgRevPerUser) },
  ];

  const revenueData = growthData.map(d => ({
    month: d.month,
    mrr: d.revenue,
    arr: d.revenue * 12,
  }));

  return (
    <div dir={dir} className="min-h-screen bg-[#0a0a0a] text-neutral-200 overflow-x-hidden">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-neutral-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent" data-testid="text-brand-name">
              Vertex Command
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLang}
              className="px-3 py-1.5 rounded-lg text-sm border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors flex items-center gap-2"
              data-testid="button-lang-toggle"
            >
              <Globe className="w-4 h-4" />
              {i18n.language.split("-")[0] === "he" ? "EN" : "עב"}
            </button>
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 px-4 sm:px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/20 via-transparent to-transparent" />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-40 right-1/4 w-72 h-72 bg-purple-600/10 rounded-full blur-[100px]" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm mb-6">
              <Rocket className="w-4 h-4" />
              {t("investor.hero.badge")}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              <span className="bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
                {t("investor.hero.title")}
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-neutral-400 max-w-3xl mx-auto mb-8 leading-relaxed">
              {t("investor.hero.subtitle")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a href="#market" className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity flex items-center gap-2" data-testid="link-learn-more">
                {t("investor.hero.cta")}
                <ArrowRight className="w-4 h-4" />
              </a>
              <a href="#projections" className="px-6 py-3 rounded-xl border border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:text-white transition-colors" data-testid="link-projections">
                {t("investor.hero.ctaSecondary")}
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-16 grid grid-cols-3 gap-4 sm:gap-8 max-w-2xl mx-auto"
          >
            {[
              { value: "$14B+", label: t("investor.hero.stat1") },
              { value: "500K+", label: t("investor.hero.stat2") },
              { value: "40%", label: t("investor.hero.stat3") },
            ].map((stat, idx) => (
              <div key={idx} className="text-center" data-testid={`text-hero-stat-${idx}`}>
                <div className="text-2xl sm:text-3xl font-bold text-white">{stat.value}</div>
                <div className="text-xs sm:text-sm text-neutral-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <AnimatedSection className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto" id="problem">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.problem.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.problem.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-gradient-to-br from-red-900/20 to-red-950/10 border border-red-800/30 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-red-400 mb-6 flex items-center gap-3">
                <Target className="w-6 h-6" />
                {t("investor.problem.painTitle")}
              </h3>
              <div className="space-y-4">
                {(t("investor.problem.pains", { returnObjects: true }) as string[]).map((pain, idx) => (
                  <div key={idx} className="flex items-start gap-3" data-testid={`text-pain-${idx}`}>
                    <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-400 text-xs font-bold">{idx + 1}</span>
                    </div>
                    <p className="text-neutral-300 text-sm leading-relaxed">{pain}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 border border-emerald-800/30 rounded-2xl p-8">
              <h3 className="text-xl font-bold text-emerald-400 mb-6 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6" />
                {t("investor.problem.solutionTitle")}
              </h3>
              <div className="space-y-4">
                {(t("investor.problem.solutions", { returnObjects: true }) as string[]).map((solution, idx) => (
                  <div key={idx} className="flex items-start gap-3" data-testid={`text-solution-${idx}`}>
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <p className="text-neutral-300 text-sm leading-relaxed">{solution}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6 bg-[#0a0a0a]/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.product.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.product.subtitle")}</p>
          </div>
          <div className="space-y-12">
            {[
              {
                icon: BarChart3, gradient: "from-indigo-600 to-blue-600",
                titleKey: "investor.product.dashboard", descKey: "investor.product.dashboardDesc",
                mockupElements: [
                  { label: "Total P&L", value: "+$12,450", color: "text-emerald-400" },
                  { label: "Managed Capital", value: "$485,000", color: "text-blue-400" },
                  { label: "Active Accounts", value: "12", color: "text-indigo-400" },
                  { label: "At Risk", value: "2", color: "text-red-400" },
                ],
              },
              {
                icon: Shield, gradient: "from-red-600 to-orange-600",
                titleKey: "investor.product.riskEngine", descKey: "investor.product.riskEngineDesc",
                mockupElements: [
                  { label: "Max Drawdown", value: "$2,500", color: "text-red-400" },
                  { label: "Daily DD Used", value: "38%", color: "text-amber-400" },
                  { label: "Consistency", value: "92%", color: "text-emerald-400" },
                  { label: "Buffer", value: "$1,200", color: "text-blue-400" },
                ],
              },
              {
                icon: Copy, gradient: "from-blue-600 to-cyan-600",
                titleKey: "investor.product.copyTrading", descKey: "investor.product.copyTradingDesc",
                mockupElements: [
                  { label: "Master → 4 Followers", value: "Active", color: "text-emerald-400" },
                  { label: "Orders Copied", value: "156", color: "text-blue-400" },
                  { label: "Avg Latency", value: "120ms", color: "text-indigo-400" },
                  { label: "Success Rate", value: "99.2%", color: "text-emerald-400" },
                ],
              },
              {
                icon: BookOpen, gradient: "from-pink-600 to-rose-600",
                titleKey: "investor.product.journal", descKey: "investor.product.journalDesc",
                mockupElements: [
                  { label: "Win Rate", value: "64%", color: "text-emerald-400" },
                  { label: "Profit Factor", value: "2.1", color: "text-blue-400" },
                  { label: "Mood → P&L", value: "+18%", color: "text-indigo-400" },
                  { label: "Best Setup", value: "Breakout", color: "text-amber-400" },
                ],
              },
              {
                icon: Target, gradient: "from-purple-600 to-pink-600",
                titleKey: "investor.product.priority", descKey: "investor.product.priorityDesc",
                mockupElements: [
                  { label: "FTMO 100K #1", value: "Score: 92", color: "text-emerald-400" },
                  { label: "TopStep 50K #3", value: "Score: 78", color: "text-amber-400" },
                  { label: "E8 200K #2", value: "Score: 65", color: "text-orange-400" },
                  { label: "MFF 50K #4", value: "Score: 31", color: "text-red-400" },
                ],
              },
              {
                icon: Layers, gradient: "from-emerald-600 to-teal-600",
                titleKey: "investor.product.integrations", descKey: "investor.product.integrationsDesc",
                mockupElements: [
                  { label: "Tradovate", value: "Connected", color: "text-emerald-400" },
                  { label: "TopstepX", value: "Connected", color: "text-emerald-400" },
                  { label: "CSV Import", value: "Available", color: "text-neutral-400" },
                ],
              },
              {
                icon: Bot, gradient: "from-cyan-600 to-blue-600",
                titleKey: "investor.product.aiAssistant", descKey: "investor.product.aiAssistantDesc",
                mockupElements: [
                  { label: "Question", value: "\"DD left?\"", color: "text-neutral-300" },
                  { label: "Answer", value: "$1,200", color: "text-emerald-400" },
                  { label: "Suggestion", value: "Light trade", color: "text-amber-400" },
                  { label: "Status", value: "Online", color: "text-emerald-400" },
                ],
              },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
              >
                <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 items-center ${idx % 2 === 1 ? "lg:flex-row-reverse" : ""}`} data-testid={`card-product-${idx}`}>
                  <div className={idx % 2 === 1 ? "lg:order-2" : ""}>
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mb-4`}>
                      <item.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-3">{t(item.titleKey)}</h3>
                    <p className="text-neutral-400 leading-relaxed">{t(item.descKey)}</p>
                  </div>
                  <div className={`bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-1 ${idx % 2 === 1 ? "lg:order-1" : ""}`}>
                    <div className="bg-[#1a1a1a] rounded-xl overflow-hidden">
                      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-neutral-800/50">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                        <span className="text-[10px] text-neutral-600 ml-2">vertex-command.app</span>
                      </div>
                      <div className="p-5">
                        <div className="grid grid-cols-2 gap-3">
                          {item.mockupElements.map((el, mi) => (
                            <div key={mi} className="bg-[#1a1a1a] border border-neutral-800/50 rounded-lg p-3">
                              <div className="text-[10px] text-neutral-500 mb-1">{el.label}</div>
                              <div className={`text-lg font-bold ${el.color}`} dir="ltr">{el.value}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 h-16 bg-[#1a1a1a] border border-neutral-800/50 rounded-lg flex items-end px-3 pb-2 gap-1">
                          {[40, 55, 35, 70, 60, 80, 65, 90, 75, 85, 95, 88].map((h, i) => (
                            <div key={i} className={`flex-1 rounded-sm bg-gradient-to-t ${item.gradient} opacity-60`} style={{ height: `${h}%` }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.features.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.features.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Briefcase, color: "text-indigo-400", bg: "bg-indigo-500/10", key: "multiAccount" },
              { icon: Shield, color: "text-red-400", bg: "bg-red-500/10", key: "ruleEngine" },
              { icon: Star, color: "text-amber-400", bg: "bg-amber-500/10", key: "priorityScoring" },
              { icon: RefreshCw, color: "text-emerald-400", bg: "bg-emerald-500/10", key: "autoSync" },
              { icon: Copy, color: "text-blue-400", bg: "bg-blue-500/10", key: "copyTrading" },
              { icon: BookOpen, color: "text-pink-400", bg: "bg-pink-500/10", key: "tradingJournal" },
              { icon: Bot, color: "text-cyan-400", bg: "bg-cyan-500/10", key: "aiAssistant" },
              { icon: Bell, color: "text-orange-400", bg: "bg-orange-500/10", key: "smartAlerts" },
            ].map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <div className="bg-[#1a1a1a] border border-neutral-800 rounded-xl p-5 hover:border-neutral-700 transition-all duration-300" data-testid={`card-feature-${feature.key}`}>
                  <div className={`w-10 h-10 rounded-lg ${feature.bg} flex items-center justify-center mb-3`}>
                    <feature.icon className={`w-5 h-5 ${feature.color}`} />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">{t(`investor.features.${feature.key}`)}</h4>
                  <p className="text-xs text-neutral-500 leading-relaxed">{t(`investor.features.${feature.key}Desc`)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6 bg-[#0a0a0a]/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.pricing.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto mb-6">{t("investor.pricing.subtitle")}</p>
            <div className="inline-flex items-center gap-1 p-1 bg-neutral-900 rounded-xl border border-neutral-800">
              <button
                onClick={() => setPricingCycle("monthly")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  pricingCycle === "monthly"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
                data-testid="button-pricing-monthly"
              >
                {t("investor.pricing.monthlyLabel")}
              </button>
              <button
                onClick={() => setPricingCycle("yearly")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                  pricingCycle === "yearly"
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
                data-testid="button-pricing-yearly"
              >
                {t("investor.pricing.yearlyLabel")}
                <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {t("investor.pricing.save20")}
                </span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PRICING_TIERS.map((tier, idx) => {
              const isPopular = tier.key === "pro";
              const price = pricingCycle === "yearly" ? tier.yearly : tier.monthly;
              const monthlyEquiv = pricingCycle === "yearly" && tier.yearly > 0 ? Math.round(tier.yearly / 12) : tier.monthly;
              return (
                <motion.div
                  key={tier.key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, duration: 0.4 }}
                  viewport={{ once: true }}
                  className="relative"
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-violet-600 to-purple-600 text-white">
                        {t("investor.pricing.popular")}
                      </span>
                    </div>
                  )}
                  <div
                    className={`bg-[#1a1a1a] rounded-2xl p-6 h-full border transition-all ${
                      isPopular ? "border-violet-500 shadow-lg shadow-violet-500/10" : "border-neutral-800"
                    }`}
                    data-testid={`card-pricing-${tier.key}`}
                  >
                    <h3 className="text-lg font-bold text-white mb-1">{t(`investor.pricing.plans.${tier.key}`)}</h3>
                    <p className="text-xs text-neutral-500 mb-4">{t(`investor.pricing.planDesc.${tier.key}`)}</p>
                    <div className="flex items-baseline gap-1 mb-1">
                      {tier.monthly === 0 ? (
                        <span className="text-3xl font-bold text-white">{t("investor.pricing.free")}</span>
                      ) : (
                        <>
                          <span className="text-3xl font-bold text-white">${monthlyEquiv}</span>
                          <span className="text-sm text-neutral-500">/{t("investor.pricing.month")}</span>
                        </>
                      )}
                    </div>
                    {pricingCycle === "yearly" && tier.yearly > 0 && (
                      <div className="text-xs text-emerald-400 mb-3">${price}/{t("investor.pricing.year")}</div>
                    )}
                    {(pricingCycle === "monthly" || tier.monthly === 0) && (
                      <div className="text-xs text-neutral-600 mb-3">&nbsp;</div>
                    )}
                    <div className="text-xs text-neutral-400 mb-4 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-neutral-500" />
                      {tier.accounts === -1
                        ? t("investor.pricing.unlimited")
                        : t("investor.pricing.upTo", { count: tier.accounts })}
                    </div>
                    <div className="border-t border-neutral-800 pt-4">
                      {(t(`investor.pricing.tierFeatures.${tier.key}`, { returnObjects: true }) as string[]).map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2 text-xs text-neutral-400 mb-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
          <div className="text-center mt-8">
            <p className="text-sm text-neutral-500">{t("investor.pricing.yearlyNote")}</p>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6" id="market">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.market.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.market.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              { value: "$14B", label: t("investor.market.tam"), desc: t("investor.market.tamDesc"), icon: Globe, color: "from-indigo-600 to-blue-600" },
              { value: "$3.2B", label: t("investor.market.sam"), desc: t("investor.market.samDesc"), icon: Target, color: "from-purple-600 to-pink-600" },
              { value: "$480M", label: t("investor.market.som"), desc: t("investor.market.somDesc"), icon: Zap, color: "from-emerald-600 to-teal-600" },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
              >
                <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6 text-center" data-testid={`card-market-${idx}`}>
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center mx-auto mb-4`}>
                    <item.icon className="w-7 h-7 text-white" />
                  </div>
                  <div className="text-3xl font-bold text-white mb-1">{item.value}</div>
                  <div className="text-sm font-medium text-neutral-300 mb-2">{item.label}</div>
                  <div className="text-xs text-neutral-500">{item.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-400" />
                {t("investor.market.trendsTitle")}
              </h3>
              <div className="space-y-3">
                {(t("investor.market.trends", { returnObjects: true }) as string[]).map((trend, idx) => (
                  <div key={idx} className="flex items-start gap-3" data-testid={`text-trend-${idx}`}>
                    <ArrowRight className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-neutral-400">{trend}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                {t("investor.market.audienceTitle")}
              </h3>
              <div className="space-y-3">
                {(t("investor.market.audience", { returnObjects: true }) as string[]).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3" data-testid={`text-audience-${idx}`}>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-neutral-400">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6 bg-[#0a0a0a]/50" id="projections">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-12 flex-wrap gap-4">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.projections.title")}</h2>
              <p className="text-lg text-neutral-400 max-w-2xl">{t("investor.projections.subtitle")}</p>
            </div>
            <button
              onClick={() => setEditingProjections(!editingProjections)}
              className="px-4 py-2 rounded-lg text-sm border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors flex items-center gap-2"
              data-testid="button-edit-projections"
            >
              <LineChart className="w-4 h-4" />
              {editingProjections ? t("investor.projections.hideEditor") : t("investor.projections.editProjections")}
            </button>
          </div>

          {editingProjections && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6 mb-8"
            >
              <h3 className="text-sm font-bold text-white mb-4">{t("investor.projections.configTitle")}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {[
                  { label: t("investor.months.m1"), field: "month1Users" as const },
                  { label: t("investor.months.m3"), field: "month3Users" as const },
                  { label: t("investor.months.m6"), field: "month6Users" as const },
                  { label: t("investor.months.m12"), field: "month12Users" as const },
                  { label: t("investor.months.m18"), field: "month18Users" as const },
                  { label: t("investor.months.m24"), field: "month24Users" as const },
                ].map(({ label, field }) => (
                  <div key={field}>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">{label} {t("investor.projections.users")}</label>
                    <input
                      type="number"
                      value={projections[field]}
                      onChange={(e) => setProjections({ ...projections, [field]: parseInt(e.target.value) || 0 })}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white"
                      dir="ltr"
                      data-testid={`input-projection-${field}`}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">{t("investor.projections.conversionRate")} (%)</label>
                  <input
                    type="number"
                    value={projections.conversionRate}
                    onChange={(e) => setProjections({ ...projections, conversionRate: parseInt(e.target.value) || 0 })}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white"
                    dir="ltr"
                    data-testid="input-conversion-rate"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">{t("investor.projections.avgRevenue")} ($)</label>
                  <input
                    type="number"
                    value={projections.avgRevPerUser}
                    onChange={(e) => setProjections({ ...projections, avgRevPerUser: parseInt(e.target.value) || 0 })}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white"
                    dir="ltr"
                    data-testid="input-avg-revenue"
                  />
                </div>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6" data-testid="chart-user-growth">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                {t("investor.projections.userGrowth")}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={growthData}>
                  <defs>
                    <linearGradient id="userGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
                  <XAxis dataKey="month" stroke="#8c8c8c" fontSize={12} />
                  <YAxis stroke="#8c8c8c" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#e5e5e5" }}
                  />
                  <Area type="monotone" dataKey="users" stroke="#6366f1" fill="url(#userGradient)" strokeWidth={2} name={t("investor.projections.users")} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6" data-testid="chart-revenue-growth">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                {t("investor.projections.revenueGrowth")}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={revenueData}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
                  <XAxis dataKey="month" stroke="#8c8c8c" fontSize={12} />
                  <YAxis stroke="#8c8c8c" fontSize={12} tickFormatter={(v) => formatCurrency(v, true)} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#e5e5e5" }}
                    formatter={(value: number) => [formatCurrency(value), ""]}
                  />
                  <Bar dataKey="mrr" fill="#6366f1" radius={[4, 4, 0, 0]} name="MRR" />
                  <Line type="monotone" dataKey="arr" stroke="#10b981" strokeWidth={2} dot={false} name="ARR" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.competitive.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.competitive.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Lock, color: "text-indigo-400", bg: "from-indigo-600 to-blue-600", key: "moat1" },
              { icon: Zap, color: "text-purple-400", bg: "from-purple-600 to-pink-600", key: "moat2" },
              { icon: Award, color: "text-emerald-400", bg: "from-emerald-600 to-teal-600", key: "moat3" },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
              >
                <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6 h-full" data-testid={`card-competitive-${idx}`}>
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.bg} flex items-center justify-center mb-4`}>
                    <item.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{t(`investor.competitive.${item.key}`)}</h3>
                  <p className="text-sm text-neutral-400 leading-relaxed">{t(`investor.competitive.${item.key}Desc`)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6 bg-[#0a0a0a]/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.traction.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.traction.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { value: metrics?.totalUsers ?? 0, label: t("investor.traction.totalUsers"), icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
              { value: metrics?.activeSubscriptions ?? 0, label: t("investor.traction.activeSubs"), icon: Crown, color: "text-indigo-400", bg: "bg-indigo-500/10" },
              { value: formatCurrency(metrics?.totalMRR ?? 0), label: t("investor.traction.mrr"), icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            ].map((kpi, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6 text-center" data-testid={`card-traction-${idx}`}>
                  <div className={`w-12 h-12 rounded-xl ${kpi.bg} flex items-center justify-center mx-auto mb-4`}>
                    <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
                  </div>
                  <div className="text-3xl font-bold text-white mb-1" dir="ltr">{kpi.value}</div>
                  <div className="text-sm text-neutral-500">{kpi.label}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.team.title")}</h2>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">{t("investor.team.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {(t("investor.team.members", { returnObjects: true }) as { name: string; role: string; bio: string }[]).map((member, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
              >
                <div className="bg-[#1a1a1a] border border-neutral-800 rounded-2xl p-6 text-center h-full" data-testid={`card-team-${idx}`}>
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center mx-auto mb-4">
                    <Users className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{member.name}</h3>
                  <p className="text-sm text-indigo-400 mb-3">{member.role}</p>
                  <p className="text-xs text-neutral-500 leading-relaxed">{member.bio}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection className="py-20 px-4 sm:px-6 bg-[#0a0a0a]/50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-br from-indigo-900/30 to-purple-900/20 border border-indigo-800/30 rounded-3xl p-10 sm:p-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t("investor.cta.title")}</h2>
            <p className="text-lg text-neutral-400 mb-8 max-w-xl mx-auto">{t("investor.cta.subtitle")}</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:invest@vertexcommand.com"
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
                data-testid="link-contact-invest"
              >
                <Mail className="w-5 h-5" />
                {t("investor.cta.contactUs")}
              </a>
            </div>
            <p className="text-xs text-neutral-600 mt-6">{t("investor.cta.disclaimer")}</p>
          </div>
        </div>
      </AnimatedSection>

      <footer className="py-8 px-4 sm:px-6 border-t border-neutral-800/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-neutral-500 text-sm">
            <Activity className="w-4 h-4" />
            <span>Vertex Command</span>
          </div>
          <div className="text-xs text-neutral-600">
            © {new Date().getFullYear()} Vertex Command. {t("investor.footer.rights")}
          </div>
        </div>
      </footer>
    </div>
  );
}
