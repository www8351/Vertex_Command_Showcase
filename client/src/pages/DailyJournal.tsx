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

interface DaySummary {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  profitFactor: number;
  commission: number;
}

export default function DailyJournal() {
  const { t, i18n } = useTranslation();
  const dir = isRTL(i18n.language) ? "rtl" : "ltr";
  const { formatCurrency } = useCurrency();
  const [filter, setFilter] = useState<"all" | "verified" | "manual">("all");

  const summaryQuery = useQuery<any[]>({
    queryKey: ["/api/v1/journal/daily-summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const days: DaySummary[] = useMemo(() => {
    if (!summaryQuery.data || !Array.isArray(summaryQuery.data)) {
      const today = new Date();
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return {
          date: d.toISOString().split("T")[0],
          trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0, profitFactor: 0, commission: 0,
        };
      });
    }
    return summaryQuery.data.map((d: any) => ({
      date: d.date,
      trades: d.totalTrades || 0,
      wins: d.winCount || 0,
      losses: d.lossCount || 0,
      pnl: d.netPnl || 0,
      winRate: d.totalTrades ? ((d.winCount || 0) / d.totalTrades) * 100 : 0,
      profitFactor: d.profitFactor || 0,
      commission: d.commission || 0,
    }));
  }, [summaryQuery.data]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(i18n.language === "he" ? "he-IL" : "en-US", {
      weekday: "short", month: "short", day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" data-testid="text-daily-title">
            {t("dailyJournal.title", { defaultValue: "יומן יומי" })}
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
          {days.map((day, idx) => (
            <Card
              key={day.date}
              className={`bg-card border-border ${idx === 0 ? 'border-indigo-500/30' : ''}`}
              data-testid={`card-day-${day.date}`}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold">{formatDate(day.date)}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${day.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      P&L {formatCurrency(day.pnl)}
                    </span>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`btn-journal-${day.date}`}>
                      <BookOpen className="w-3 h-3" />
                      {t("dailyJournal.journal", { defaultValue: "יומן" })}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">{t("trades.tradesCount", { defaultValue: "עסקאות" })}</p>
                    <p className="font-semibold text-sm">{day.trades}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.wins", { defaultValue: "זכיות" })}</p>
                    <p className="font-semibold text-sm text-emerald-400">{day.wins}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.losses", { defaultValue: "הפסדים" })}</p>
                    <p className="font-semibold text-sm text-red-400">{day.losses}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.winRate", { defaultValue: "אחוז זכייה" })}</p>
                    <p className="font-semibold text-sm">{day.winRate.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.profitFactor", { defaultValue: "Profit Factor" })}</p>
                    <p className="font-semibold text-sm">{day.profitFactor.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("trades.commission", { defaultValue: "עמלה" })}</p>
                    <p className="font-semibold text-sm">{formatCurrency(day.commission)}</p>
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
