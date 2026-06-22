import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiUrl } from "@/lib/apiBase";

interface CalendarData {
  days: Record<string, { pnl: number; trades: number }>;
  weeklyTotals: Record<string, { pnl: number; days: number }>;
  monthTotal: number;
  monthTrades: number;
  totalSize: number;
}

interface TradeCalendarProps {
  accountId?: number;
  accounts?: { id: number; name: string }[];
}

export default function TradeCalendar({ accountId, accounts }: TradeCalendarProps) {
  const { t } = useTranslation();
  const { pnlDisplayMode, formatCurrency, formatPnl } = useCurrency();

  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [calendarAccountId, setCalendarAccountId] = useState<string>("all");

  const effectiveAccountId = accountId !== undefined ? String(accountId) : calendarAccountId;
  const showAccountFilter = accountId === undefined;

  const { data: calendarData } = useQuery<CalendarData>({
    queryKey: ["/api/v1/trades/calendar", calendarMonth, effectiveAccountId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/trades/calendar?month=${calendarMonth}&accountId=${effectiveAccountId}`), { credentials: "include" });
      return res.json();
    },
  });

  const [year, monthNum] = calendarMonth.split('-').map(Number);
  const firstDayOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const startDow = firstDayOfMonth.getUTCDay();
  const weeks: { day: number; dateStr: string }[][] = [];
  let currentWeek: { day: number; dateStr: string }[] = [];
  for (let i = 0; i < startDow; i++) currentWeek.push({ day: 0, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarMonth}-${String(d).padStart(2, '0')}`;
    currentWeek.push({ day: d, dateStr });
    if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push({ day: 0, dateStr: '' });
    weeks.push(currentWeek);
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const prevMonth = () => {
    const d = new Date(Date.UTC(year, monthNum - 2, 1));
    setCalendarMonth(d.toISOString().substring(0, 7));
  };
  const nextMonth = () => {
    const d = new Date(Date.UTC(year, monthNum, 1));
    setCalendarMonth(d.toISOString().substring(0, 7));
  };
  const dayHeaders = [
    t('dashboard.calendar.sun'), t('dashboard.calendar.mon'), t('dashboard.calendar.tue'),
    t('dashboard.calendar.wed'), t('dashboard.calendar.thu'), t('dashboard.calendar.fri'), t('dashboard.calendar.sat')
  ];
  const calDays = calendarData?.days || {};
  const calWeekly = calendarData?.weeklyTotals || {};
  const totalSize = calendarData?.totalSize || 1;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 pb-2 gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-500" />
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1 hover:bg-secondary rounded" data-testid="calendar-prev-month"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs sm:text-sm font-semibold min-w-[100px] sm:min-w-[120px] text-center">{monthNames[monthNum - 1]} {year}</span>
            <button onClick={nextMonth} className="p-1 hover:bg-secondary rounded" data-testid="calendar-next-month"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{t('dashboard.calendar.monthlyStats')}:</span>
          <span className={`text-xs font-mono font-semibold ${(calendarData?.monthTotal || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">
            {pnlDisplayMode === 'pct'
              ? `${((calendarData?.monthTotal || 0) / totalSize * 100).toFixed(2)}%`
              : formatPnl(calendarData?.monthTotal || 0, totalSize)}
          </span>
          <span className="text-[10px] text-muted-foreground">{calendarData?.monthTrades || 0} {t('dashboard.calendar.trades')}</span>
          {showAccountFilter && (
            <Select value={calendarAccountId} onValueChange={setCalendarAccountId}>
              <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-border" data-testid="calendar-account-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('dashboard.calendar.allAccounts')}</SelectItem>
                {(accounts || []).map((acc) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" dir="ltr">
          <thead>
            <tr>
              {dayHeaders.map(d => (
                <th key={d} className="px-1 py-2 text-center text-[10px] font-medium text-muted-foreground uppercase">{d}</th>
              ))}
              <th className="px-1 sm:px-2 py-2 text-center text-[10px] font-medium text-muted-foreground w-14 sm:w-20"></th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => {
              const weekNum = wi + 1;
              const weekData = calWeekly[String(weekNum)];
              return (
                <tr key={wi} className="border-t border-border/30">
                  {week.map((cell, ci) => {
                    const dayData = cell.dateStr ? calDays[cell.dateStr] : null;
                    const hasTrades = dayData && dayData.trades > 0;
                    const pnl = dayData?.pnl || 0;
                    const isPositive = pnl >= 0;
                    return (
                      <td key={ci} className="px-0.5 sm:px-1 py-1 text-center align-top" style={{ minWidth: '44px', height: '58px' }}>
                        {cell.day > 0 && (
                          <div className={`rounded-md p-1.5 h-full flex flex-col items-center justify-start gap-0.5 ${
                            hasTrades
                              ? isPositive
                                ? 'bg-emerald-500/8 border border-emerald-500/20'
                                : 'bg-red-500/8 border border-red-500/20'
                              : ''
                          }`}>
                            <span className="text-[10px] text-muted-foreground">{String(cell.day).padStart(2, '0')}</span>
                            {hasTrades && (
                              <>
                                <span className={`text-xs font-mono font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">
                                  {pnlDisplayMode === 'pct'
                                    ? `${(pnl / totalSize * 100).toFixed(2)}%`
                                    : formatCurrency(pnl, Math.abs(pnl) >= 1000)}
                                </span>
                                <span className="text-[9px] text-muted-foreground">{dayData.trades} {t('dashboard.calendar.trades')}</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 sm:px-2 py-1 text-right align-middle border-l border-border/30" style={{ minWidth: '60px' }}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[9px] text-muted-foreground uppercase">{t('dashboard.calendar.week')} {weekNum}</span>
                      {weekData ? (
                        <>
                          <span className={`text-xs font-mono font-bold ${weekData.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`} dir="ltr">
                            {pnlDisplayMode === 'pct'
                              ? `${(weekData.pnl / totalSize * 100).toFixed(2)}%`
                              : formatCurrency(weekData.pnl, Math.abs(weekData.pnl) >= 1000)}
                          </span>
                          <span className="text-[9px] text-muted-foreground">{weekData.days} {weekData.days === 1 ? t('dashboard.calendar.day') : t('dashboard.calendar.days')}</span>
                        </>
                      ) : (
                        <span className="text-[9px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}