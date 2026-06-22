import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import {
  Trophy, Target, Zap, ShieldAlert, AlertTriangle,
  TrendingUp, CheckCircle2, XCircle, Loader2, BarChart3
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

interface TradingPriority {
  id: number;
  accountId: string;
  name: string;
  firm: string;
  tier: string;
  stage: string;
  profit: number;
  distanceToTarget: number;
  consistencyRisk: number;
  drawdownRisk: number;
  score: number;
  recommendation: string;
}

const RECOMMENDATION_STYLE: Record<string, { color: string; bg: string; icon: any }> = {
  trade: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: TrendingUp },
  ready_to_withdraw: { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', icon: Trophy },
  light_trading: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: Target },
  avoid: { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', icon: AlertTriangle },
  do_not_trade: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle },
};

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-blue-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 20) return 'text-orange-400';
  return 'text-red-400';
}

function getScoreBarColor(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-red-500';
}

export default function TradingPriorityPage() {
  const [, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? 'rtl' : 'ltr';

  const { data: priorities = [], isLoading } = useQuery<TradingPriority[]>({
    queryKey: ["/api/v1/trading-priorities"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div dir={dir} className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between rtl:flex-row-reverse mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-neutral-100" data-testid="text-page-title">{t('priorities.whatToTradeToday')}</h1>
              <p className="text-sm text-neutral-500">{t('priorities.autoCalculated')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          </div>
        </div>

        {priorities.length === 0 ? (
          <Card className="bg-[#1a1a1a] border-neutral-800">
            <CardContent className="p-12 text-center">
              <BarChart3 className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
              <p className="text-neutral-400 text-lg">{t('priorities.noActive')}</p>
              <p className="text-neutral-600 text-sm mt-1">{t('priorities.addAccountsHint')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {priorities.map((p, idx) => {
              const rec = RECOMMENDATION_STYLE[p.recommendation] || RECOMMENDATION_STYLE.trade;
              const RecIcon = rec.icon;
              const recLabelKey = `priorities.${p.recommendation === 'ready_to_withdraw' ? 'readyToWithdraw' : p.recommendation === 'light_trading' ? 'lightTrading' : p.recommendation === 'do_not_trade' ? 'doNotTrade' : p.recommendation}`;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card
                    className="bg-[#1a1a1a] border-neutral-800 hover:border-indigo-500/30 transition-all cursor-pointer"
                    onClick={() => navigate(`/account/${p.id}`)}
                    data-testid={`card-priority-${p.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 w-12 text-center">
                          <div className={`text-2xl font-bold ${getScoreColor(p.score)}`}>{p.score}</div>
                          <div className="text-[10px] text-neutral-600 mt-0.5">{t('priorities.score')}</div>
                        </div>

                        <div className="h-10 w-px bg-neutral-800" />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-neutral-200 truncate" data-testid={`text-priority-name-${p.id}`}>{p.name}</span>
                            <span className="text-xs text-neutral-500 font-mono" dir="ltr">{p.accountId}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-neutral-500">
                            <span>{p.firm}</span>
                            {p.tier && <span>· {p.tier}</span>}
                            <span>· {t(`phases.${p.stage}`, { defaultValue: p.stage })}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-left">
                            <div className={`text-sm font-mono font-semibold ${p.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              ${p.profit.toLocaleString()}
                            </div>
                            <div className="text-[10px] text-neutral-600">{t('priorities.profit')}</div>
                          </div>

                          {p.distanceToTarget > 0 && (
                            <div className="text-left">
                              <div className="text-sm font-mono text-amber-400">${p.distanceToTarget.toLocaleString()}</div>
                              <div className="text-[10px] text-neutral-600">{t('priorities.toTarget')}</div>
                            </div>
                          )}

                          <div className="w-24">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-neutral-600">{t('priorities.ddRisk')}</span>
                              <span className={`text-xs font-mono ${p.drawdownRisk > 50 ? 'text-red-400' : p.drawdownRisk > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {p.drawdownRisk.toFixed(0)}%
                              </span>
                            </div>
                            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${p.drawdownRisk > 50 ? 'bg-red-500' : p.drawdownRisk > 25 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(p.drawdownRisk, 100)}%` }} />
                            </div>
                          </div>

                          <Badge className={`${rec.bg} border ${rec.color} gap-1 text-xs`} data-testid={`badge-recommendation-${p.id}`}>
                            <RecIcon className="w-3 h-3" />
                            {t(recLabelKey)}
                          </Badge>
                        </div>
                      </div>

                      <div className="mt-2 h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${getScoreBarColor(p.score)}`} style={{ width: `${p.score}%` }} />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
