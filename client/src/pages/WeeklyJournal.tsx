import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { Calendar, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WeekSummary {
  weekNumber: number;
  dateRange: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  profitFactor: number;
  dailyAvg: number;
}

function getWeekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}

export default function WeeklyJournal() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { formatCurrency } = useCurrency();
  const [filter, setFilter] = useState<"all" | "verified" | "manual">("all");

  const weeks: WeekSummary[] = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const fmt = (d: Date) => d.toLocaleDateString(i18n.language === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric" });
      return {
        weekNumber: getWeekNumber(weekStart),
        dateRange: `${fmt(weekStart)} - ${fmt(weekEnd)}`,
        trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0, profitFactor: 0, dailyAvg: 0,
      };
    });
  }, [i18n.language]);

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" data-testid="text-weekly-title">
            {t("weeklyJournal.title", { defaultValue: "יומן שבועי" })}
          </h1>
          <div className="w-8" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "verified", "manual"] as const).map(f => (
            <Badge
              key={f}
              variant={filter === f ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? t("trades.allJournals", { defaultValue: "כל היומנים" })
                : f === "verified" ? t("trades.verified", { defaultValue: "מאומת" })
                : t("trades.manual", { defaultValue: "ידני" })}
            </Badge>
          ))}
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("trades.allAccounts", { defaultValue: "כל החשבונות" })}</span>
          <span className="text-xs text-muted-foreground">|</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {t("trades.allTime", { defaultValue: "כל הזמנים" })}
          </span>
        </div>

        <div className="space-y-3">
          {weeks.map((week, idx) => (
            <Card
              key={week.weekNumber}
              className={`bg-card border-border ${idx === 0 ? 'border-indigo-500/30' : ''}`}
              data-testid={`card-week-${week.weekNumber}`}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t("weeklyJournal.week", { defaultValue: "שבוע" })} {week.weekNumber}
                    </h3>
                    <p className="text-xs text-muted-foreground">{week.dateRange}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${week.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      P&L {formatCurrency(week.pnl)}
                    </span>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`btn-journal-week-${week.weekNumber}`}>
                      <BookOpen className="w-3 h-3" />
                      {t("dailyJournal.journal", { defaultValue: "יומן" })}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">{t("trades.tradesCount", { defaultValue: "עסקאות" })}</p>
                    <p className="font-semibold text-sm">{week.trades}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.wins", { defaultValue: "זכיות" })}</p>
                    <p className="font-semibold text-sm text-emerald-400">{week.wins}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.losses", { defaultValue: "הפסדים" })}</p>
                    <p className="font-semibold text-sm text-red-400">{week.losses}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.winRate", { defaultValue: "אחוז זכייה" })}</p>
                    <p className="font-semibold text-sm">{week.winRate.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.profitFactor", { defaultValue: "Profit Factor" })}</p>
                    <p className="font-semibold text-sm">{week.profitFactor.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("weeklyJournal.dailyAvg", { defaultValue: "ממוצע יומי" })}</p>
                    <p className="font-semibold text-sm">{formatCurrency(week.dailyAvg)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

      </div>
    </div>
  );
}
