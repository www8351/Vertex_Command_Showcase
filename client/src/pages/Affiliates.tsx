import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { getQueryFn } from "@/lib/queryClient";
import { Users, DollarSign, UserCheck, Link2, Copy, Check, Gift, TrendingUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReferralStats {
  totalReferred: number;
  totalConverted: number;
  totalReward: number;
}

interface ReferralItem {
  id: number;
  referredName: string;
  referredEmail: string;
  status: string;
  rewardAmount: number | null;
  rewardApplied: boolean;
  createdAt: string;
  convertedAt: string | null;
}

interface ReferralCode {
  id: number;
  code: string;
  userId: number;
  createdAt: string;
}

export default function Affiliates() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState(false);

  const { data: codeData } = useQuery<ReferralCode>({
    queryKey: ["/api/v1/affiliate/my-code"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: referralData } = useQuery<{ referrals: ReferralItem[]; stats: ReferralStats }>({
    queryKey: ["/api/v1/affiliate/my-referrals"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const referralLink = codeData ? `${window.location.origin}/?ref=${codeData.code}` : "";

  const handleCopy = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const stats = referralData?.stats || { totalReferred: 0, totalConverted: 0, totalReward: 0 };
  const referrals = referralData?.referrals || [];

  return (
    <div dir={dir} className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between rtl:flex-row-reverse">
          <div className="flex items-center gap-3">
            <Gift className="w-6 h-6 text-indigo-500" />
            <h1 className="text-xl font-bold text-foreground" data-testid="text-affiliates-title">
              {t("affiliate.title")}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-foreground">{t("affiliate.yourLink")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("affiliate.linkDesc")}</p>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex-1 bg-background/80 border border-border rounded-xl px-3 sm:px-4 py-3 font-mono text-xs sm:text-sm text-foreground truncate min-w-0" data-testid="text-referral-link">
              {referralLink || "..."}
            </div>
            <Button onClick={handleCopy} className="gap-2 bg-indigo-600 hover:bg-indigo-700 shrink-0 text-xs sm:text-sm" data-testid="button-copy-link">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? t("common.copied") : t("common.copy")}</span>
            </Button>
          </div>
          {codeData && (
            <p className="text-xs text-muted-foreground">
              {t("affiliate.code")}: <span className="font-mono font-semibold text-indigo-400" data-testid="text-referral-code">{codeData.code}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-2" data-testid="stat-total-referred">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="w-4 h-4" />
              <span className="text-sm">{t("affiliate.totalReferred")}</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats.totalReferred}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-2" data-testid="stat-total-converted">
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserCheck className="w-4 h-4" />
              <span className="text-sm">{t("affiliate.totalConverted")}</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats.totalConverted}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 space-y-2" data-testid="stat-total-reward">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm">{t("affiliate.totalReward")}</span>
            </div>
            <p className="text-3xl font-bold text-foreground">${stats.totalReward.toFixed(2)}</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-foreground">{t("affiliate.referralHistory")}</h3>
          </div>
          {referrals.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground text-sm" data-testid="text-no-referrals">
              {t("affiliate.noReferrals")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {referrals.map((r) => (
                <div key={r.id} className="px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-testid={`referral-row-${r.id}`}>
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-9 h-9 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-sm font-semibold text-indigo-400 flex-shrink-0">
                      {r.referredName?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.referredName}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.referredEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      r.status === "converted"
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    }`} data-testid={`referral-status-${r.id}`}>
                      {r.status === "converted" ? t("affiliate.statusConverted") : t("affiliate.statusRegistered")}
                    </span>
                    {r.rewardAmount != null && r.rewardAmount > 0 && (
                      <span className="text-sm font-semibold text-emerald-500" data-testid={`referral-reward-${r.id}`}>
                        +${r.rewardAmount.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <h3 className="font-semibold text-foreground">{t("affiliate.howItWorks")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-sm">1</div>
              <p className="text-sm text-foreground font-medium">{t("affiliate.step1Title")}</p>
              <p className="text-xs text-muted-foreground">{t("affiliate.step1Desc")}</p>
            </div>
            <div className="space-y-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-sm">2</div>
              <p className="text-sm text-foreground font-medium">{t("affiliate.step2Title")}</p>
              <p className="text-xs text-muted-foreground">{t("affiliate.step2Desc")}</p>
            </div>
            <div className="space-y-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold text-sm">3</div>
              <p className="text-sm text-foreground font-medium">{t("affiliate.step3Title")}</p>
              <p className="text-xs text-muted-foreground">{t("affiliate.step3Desc")}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
