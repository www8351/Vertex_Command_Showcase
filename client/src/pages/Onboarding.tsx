import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Check, Loader2, TrendingUp, Building2, BarChart3, BookOpen, Repeat2, GraduationCap, Zap } from "lucide-react";

const EXPERIENCE_OPTIONS = [
  { key: "newbie", icon: "🐣", labelKey: "onboarding.newbie", descKey: "onboarding.newbieDesc" },
  { key: "intermediate", icon: "📈", labelKey: "onboarding.intermediate", descKey: "onboarding.intermediateDesc" },
  { key: "advanced", icon: "🥷", labelKey: "onboarding.advanced", descKey: "onboarding.advancedDesc" },
  { key: "expert", icon: "🧘", labelKey: "onboarding.expert", descKey: "onboarding.expertDesc" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { key: "personal", labelKey: "onboarding.personal" },
  { key: "prop_firm", labelKey: "onboarding.propFirm" },
  { key: "not_started", labelKey: "onboarding.notStarted" },
];

const INSTRUMENT_OPTIONS = [
  { key: "futures", icon: "📊", labelKey: "onboarding.futures" },
  { key: "forex", icon: "💱", labelKey: "onboarding.forex" },
  { key: "stocks", icon: "📈", labelKey: "onboarding.stocks" },
  { key: "options", icon: "🎯", labelKey: "onboarding.options" },
  { key: "crypto", icon: "₿", labelKey: "onboarding.crypto" },
  { key: "cfd", icon: "📉", labelKey: "onboarding.cfd" },
  { key: "other", icon: "•••", labelKey: "onboarding.other" },
];

const GOAL_OPTIONS = [
  { key: "journal", icon: BookOpen, labelKey: "onboarding.goalJournal", descKey: "onboarding.goalJournalDesc" },
  { key: "analytics", icon: BarChart3, labelKey: "onboarding.goalAnalytics", descKey: "onboarding.goalAnalyticsDesc" },
  { key: "copy_trading", icon: Repeat2, labelKey: "onboarding.goalCopyTrading", descKey: "onboarding.goalCopyTradingDesc" },
  { key: "risk_management", icon: Zap, labelKey: "onboarding.goalRisk", descKey: "onboarding.goalRiskDesc" },
];

const REFERRAL_OPTIONS = [
  { key: "twitter", icon: "𝕏", labelKey: "Twitter (X)" },
  { key: "instagram", icon: "📸", labelKey: "Instagram" },
  { key: "youtube", icon: "▶️", labelKey: "YouTube" },
  { key: "tiktok", icon: "🎵", labelKey: "TikTok" },
  { key: "discord", icon: "💬", labelKey: "Discord" },
  { key: "reddit", icon: "🔴", labelKey: "Reddit" },
  { key: "google", icon: "🔍", labelKey: "Google" },
  { key: "friend", icon: "👤", labelKey: "onboarding.fromFriend" },
  { key: "other", icon: "•••", labelKey: "onboarding.other" },
];

const TOTAL_STEPS = 5;

export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [tradingExperience, setTradingExperience] = useState("");
  const [accountType, setAccountType] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [referralSource, setReferralSource] = useState("");

  const toggleMulti = (arr: string[], set: (v: string[]) => void, val: string) => {
    set(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const canProceed = () => {
    switch (step) {
      case 1: return !!tradingExperience;
      case 2: return !!accountType;
      case 3: return instruments.length > 0;
      case 4: return goals.length > 0;
      case 5: return !!referralSource;
      default: return false;
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/v1/auth/onboarding", {
        tradingExperience,
        accountType,
        instruments,
        goals,
        referralSource,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
      navigate("/billing");
    } catch {
      navigate("/");
    } finally {
      setSaving(false);
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const progressPercent = (step / TOTAL_STEPS) * 100;

  return (
    <div dir={dir} className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Vertex Command" className="w-8 h-8 rounded-lg object-contain" />
          <span className="text-lg font-bold text-foreground tracking-tight">VERTEX COMMAND</span>
        </div>
        <div className="flex-1 max-w-md mx-8">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              await apiRequest("POST", "/api/v1/auth/onboarding", {
                tradingExperience: "skipped",
                accountType: "skipped",
                instruments: [],
                goals: [],
                referralSource: "skipped",
              });
              queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/me"] });
              navigate("/");
            } catch {
              navigate("/");
            }
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-skip-onboarding"
        >
          {t("onboarding.skip")}
        </button>
      </div>

      <div className="flex-1 flex items-start justify-center pt-[8vh] pb-8 px-4">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: dir === "rtl" ? -30 : 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir === "rtl" ? 30 : -30 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {step === 1 && (
                <>
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-foreground" data-testid="text-onboarding-title">{t("onboarding.experienceTitle")}</h1>
                  </div>
                  <div className="space-y-3">
                    {EXPERIENCE_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setTradingExperience(opt.key)}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-start ${
                          tradingExperience === opt.key
                            ? "border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10"
                            : "border-border hover:border-muted-foreground/30 bg-card"
                        }`}
                        data-testid={`button-experience-${opt.key}`}
                      >
                        <span className="text-3xl">{opt.icon}</span>
                        <div>
                          <div className="font-semibold text-foreground">{t(opt.labelKey)}</div>
                          <div className="text-sm text-muted-foreground">{t(opt.descKey)}</div>
                        </div>
                        {tradingExperience === opt.key && (
                          <div className="ms-auto">
                            <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                              <Check className="w-4 h-4 text-white" />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-foreground">{t("onboarding.accountTypeTitle")}</h1>
                    <p className="text-sm text-muted-foreground">{t("onboarding.selectOne")}</p>
                  </div>
                  <div className="space-y-3">
                    {ACCOUNT_TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setAccountType(opt.key)}
                        className={`w-full p-4 rounded-xl border-2 transition-all text-start font-medium ${
                          accountType === opt.key
                            ? "border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10 text-foreground"
                            : "border-border hover:border-muted-foreground/30 bg-card text-foreground"
                        }`}
                        data-testid={`button-account-type-${opt.key}`}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-foreground">{t("onboarding.instrumentsTitle")}</h1>
                    <p className="text-sm text-muted-foreground">{t("onboarding.selectAll")}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {INSTRUMENT_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => toggleMulti(instruments, setInstruments, opt.key)}
                        className={`flex items-center gap-2 p-3.5 rounded-xl border-2 transition-all text-sm font-medium ${
                          instruments.includes(opt.key)
                            ? "border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10 text-foreground"
                            : "border-border hover:border-muted-foreground/30 bg-card text-foreground"
                        }`}
                        data-testid={`button-instrument-${opt.key}`}
                      >
                        <span className="text-lg">{opt.icon}</span>
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-foreground">{t("onboarding.goalsTitle")}</h1>
                    <p className="text-sm text-muted-foreground">{t("onboarding.selectAll")}</p>
                  </div>
                  <div className="space-y-3">
                    {GOAL_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => toggleMulti(goals, setGoals, opt.key)}
                          className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-start ${
                            goals.includes(opt.key)
                              ? "border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10"
                              : "border-border hover:border-muted-foreground/30 bg-card"
                          }`}
                          data-testid={`button-goal-${opt.key}`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            goals.includes(opt.key) ? "bg-indigo-500/20 text-indigo-400" : "bg-secondary text-muted-foreground"
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-foreground">{t(opt.labelKey)}</div>
                            <div className="text-sm text-muted-foreground">{t(opt.descKey)}</div>
                          </div>
                          {goals.includes(opt.key) && (
                            <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                              <Check className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {step === 5 && (
                <>
                  <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold text-foreground">{t("onboarding.referralTitle")}</h1>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {REFERRAL_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setReferralSource(opt.key)}
                        className={`flex items-center gap-2 p-3.5 rounded-xl border-2 transition-all text-sm font-medium ${
                          referralSource === opt.key
                            ? "border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10 text-foreground"
                            : "border-border hover:border-muted-foreground/30 bg-card text-foreground"
                        }`}
                        data-testid={`button-referral-${opt.key}`}
                      >
                        <span className="text-lg">{opt.icon}</span>
                        {opt.labelKey.startsWith("onboarding.") ? t(opt.labelKey) : opt.labelKey}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between mt-10">
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={() => setStep(step - 1)}
                className="gap-2"
                data-testid="button-onboarding-back"
              >
                {dir === "rtl" ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                {t("onboarding.back")}
              </Button>
            ) : <div />}

            <Button
              onClick={handleNext}
              disabled={!canProceed() || saving}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 px-8"
              data-testid="button-onboarding-next"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {step === TOTAL_STEPS ? t("onboarding.finish") : t("onboarding.continue")}
              {!saving && step < TOTAL_STEPS && (dir === "rtl" ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
