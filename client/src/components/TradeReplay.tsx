import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast,
  Calendar, TrendingUp, TrendingDown, Brain, MessageSquare, X,
  Gauge, Save
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceDot
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

interface JournalEntry {
  id: number;
  userId: number;
  importedTradeId: number | null;
  accountId: number | null;
  symbol: string | null;
  side: string | null;
  quantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  openedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  tags: string[] | null;
  setupType: string | null;
  strategy: string | null;
  createdAt: string;
  sourcePlatform?: string;
  psychology?: {
    moodBefore: string | null;
    moodAfter: string | null;
    confidence: number | null;
    discipline: number | null;
    lessonsLearned: string | null;
  };
}

const MOOD_EMOJI: Record<string, string> = { great: "😊", good: "🙂", neutral: "😐", bad: "😟", terrible: "😢" };
const MOODS = ["great", "good", "neutral", "bad", "terrible"] as const;

interface TradeReplayProps {
  entries: JournalEntry[];
  onClose: () => void;
  t: any;
}

export default function TradeReplay({ entries, onClose, t }: TradeReplayProps) {
  const { formatCurrency } = useCurrency();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [replayDate, setReplayDate] = useState(() => {
    const dates = new Set<string>();
    entries.forEach(e => {
      const d = e.closedAt || e.openedAt;
      if (d) dates.add(d.split("T")[0]);
    });
    const sorted = Array.from(dates).sort().reverse();
    return sorted[0] || new Date().toISOString().split("T")[0];
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(2000);
  const [showPsychEditor, setShowPsychEditor] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [editNotes, setEditNotes] = useState("");
  const [editMoodBefore, setEditMoodBefore] = useState("");
  const [editMoodAfter, setEditMoodAfter] = useState("");
  const [editConfidence, setEditConfidence] = useState("");
  const [editDiscipline, setEditDiscipline] = useState("");
  const [editLessons, setEditLessons] = useState("");

  const filteredTrades = useMemo(() => {
    if (!replayDate) return entries;
    return entries
      .filter(e => {
        const d = e.closedAt || e.openedAt;
        return d && d.startsWith(replayDate);
      })
      .sort((a, b) => {
        const da = new Date(a.closedAt || a.openedAt || 0).getTime();
        const db = new Date(b.closedAt || b.openedAt || 0).getTime();
        return da - db;
      });
  }, [entries, replayDate]);

  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    entries.forEach(e => {
      const d = e.closedAt || e.openedAt;
      if (d) dates.add(d.split("T")[0]);
    });
    return Array.from(dates).sort().reverse();
  }, [entries]);

  const currentTrade = filteredTrades[currentIndex] || null;

  const equityCurveData = useMemo(() => {
    const data: { index: number; equity: number; label: string; pnl: number }[] = [
      { index: 0, equity: 0, label: t("replay.start"), pnl: 0 }
    ];
    let cumPnl = 0;
    filteredTrades.forEach((trade, i) => {
      cumPnl += trade.realizedPnl || 0;
      const time = trade.closedAt ? new Date(trade.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `#${i + 1}`;
      data.push({
        index: i + 1,
        equity: cumPnl,
        label: `${trade.symbol || ''} ${time}`,
        pnl: trade.realizedPnl || 0,
      });
    });
    return data;
  }, [filteredTrades, t]);

  const visibleEquityData = useMemo(() => {
    return equityCurveData.slice(0, currentIndex + 2);
  }, [equityCurveData, currentIndex]);

  const cumulativePnl = useMemo(() => {
    let total = 0;
    for (let i = 0; i <= currentIndex && i < filteredTrades.length; i++) {
      total += filteredTrades[i].realizedPnl || 0;
    }
    return total;
  }, [filteredTrades, currentIndex]);

  const stats = useMemo(() => {
    const visible = filteredTrades.slice(0, currentIndex + 1);
    const wins = visible.filter(e => (e.realizedPnl || 0) > 0).length;
    const losses = visible.filter(e => (e.realizedPnl || 0) < 0).length;
    const winRate = visible.length > 0 ? (wins / visible.length) * 100 : 0;
    return { wins, losses, winRate, total: visible.length };
  }, [filteredTrades, currentIndex]);

  useEffect(() => {
    if (currentTrade) {
      setEditNotes(currentTrade.notes || "");
      setEditMoodBefore(currentTrade.psychology?.moodBefore || "");
      setEditMoodAfter(currentTrade.psychology?.moodAfter || "");
      setEditConfidence(String(currentTrade.psychology?.confidence || ""));
      setEditDiscipline(String(currentTrade.psychology?.discipline || ""));
      setEditLessons(currentTrade.psychology?.lessonsLearned || "");
    }
  }, [currentTrade]);

  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [replayDate]);

  useEffect(() => {
    if (isPlaying && filteredTrades.length > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= filteredTrades.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, speed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, filteredTrades.length]);

  const goTo = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, filteredTrades.length - 1)));
  }, [filteredTrades.length]);

  const updateNoteMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/v1/journal/entries/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/entries"] });
    },
  });

  const savePsychMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("POST", `/api/v1/journal/entries/${id}/psychology`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/journal/psychology-analytics"] });
    },
  });

  async function saveCurrentTradeData() {
    if (!currentTrade) return;
    try {
      await Promise.all([
        updateNoteMutation.mutateAsync({
          id: currentTrade.id,
          data: { notes: editNotes },
        }),
        savePsychMutation.mutateAsync({
          id: currentTrade.id,
          data: {
            moodBefore: editMoodBefore || undefined,
            moodAfter: editMoodAfter || undefined,
            confidence: editConfidence ? parseInt(editConfidence) : undefined,
            discipline: editDiscipline ? parseInt(editDiscipline) : undefined,
            lessonsLearned: editLessons || undefined,
          },
        }),
      ]);
      toast({ title: t("replay.saved") });
    } catch (err: any) {
      toast({ title: t("journal.error"), description: err?.message, variant: "destructive" });
    }
  }

  if (filteredTrades.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Play className="w-5 h-5 text-indigo-500" />
            {t("replay.title")}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="btn-close-replay">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <Label>{t("replay.selectDate")}</Label>
          <Input
            type="date"
            value={replayDate}
            onChange={(e) => setReplayDate(e.target.value)}
            className="max-w-[200px]"
            dir="ltr"
            data-testid="input-replay-date"
          />
          {availableDates.length > 0 && (
            <Select value={replayDate} onValueChange={setReplayDate}>
              <SelectTrigger className="max-w-[200px]" data-testid="select-replay-date">
                <SelectValue placeholder={t("replay.pickDate")} />
              </SelectTrigger>
              <SelectContent>
                {availableDates.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{t("replay.noTrades")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("replay.noTradesHint")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Play className="w-5 h-5 text-indigo-500" />
          {t("replay.title")}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="btn-close-replay">
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={replayDate}
            onChange={(e) => setReplayDate(e.target.value)}
            className="max-w-[180px] h-8 text-sm"
            dir="ltr"
            data-testid="input-replay-date"
          />
        </div>
        {availableDates.length > 0 && (
          <Select value={replayDate} onValueChange={setReplayDate}>
            <SelectTrigger className="max-w-[180px] h-8 text-sm" data-testid="select-replay-date">
              <SelectValue placeholder={t("replay.pickDate")} />
            </SelectTrigger>
            <SelectContent>
              {availableDates.map(d => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Badge variant="secondary" className="text-xs">
          {filteredTrades.length} {t("journal.trades")}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="border-border/40">
          <CardContent className="py-2.5 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">{t("replay.cumPnl")}</p>
            <p className={`text-lg font-bold ${cumulativePnl >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="text-replay-cum-pnl">
              {cumulativePnl >= 0 ? "+" : ""}{formatCurrency(cumulativePnl)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="py-2.5 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">{t("replay.tradeNum")}</p>
            <p className="text-lg font-bold text-foreground" data-testid="text-replay-trade-num">
              {currentIndex + 1} / {filteredTrades.length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="py-2.5 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">{t("journal.winRate")}</p>
            <p className="text-lg font-bold text-indigo-400" data-testid="text-replay-winrate">
              {stats.winRate.toFixed(0)}%
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="py-2.5 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">{t("replay.wl")}</p>
            <p className="text-lg font-bold" data-testid="text-replay-wl">
              <span className="text-emerald-400">{stats.wins}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-red-400">{stats.losses}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40">
        <CardContent className="py-3 px-4">
          <p className="text-xs font-semibold mb-2">{t("replay.equityCurve")}</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={visibleEquityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="rgba(255,255,255,0.3)" />
              <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
              <Tooltip
                contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", fontSize: 12 }}
                formatter={(value: number) => [formatCurrency(value), "P&L"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#6366f1"
                fill="rgba(99,102,241,0.2)"
                animationDuration={300}
              />
              {visibleEquityData.length > 1 && (
                <ReferenceDot
                  x={visibleEquityData[visibleEquityData.length - 1]?.label}
                  y={visibleEquityData[visibleEquityData.length - 1]?.equity}
                  r={5}
                  fill="#6366f1"
                  stroke="white"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex items-center gap-2">
            <Slider
              value={[currentIndex]}
              min={0}
              max={Math.max(0, filteredTrades.length - 1)}
              step={1}
              onValueChange={([val]) => {
                setIsPlaying(false);
                goTo(val);
              }}
              className="flex-1"
              data-testid="slider-replay-timeline"
            />
          </div>

          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(0)}
              disabled={currentIndex === 0}
              data-testid="btn-replay-first"
            >
              <ChevronFirst className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              data-testid="btn-replay-prev"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              variant={isPlaying ? "secondary" : "default"}
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={() => {
                if (currentIndex >= filteredTrades.length - 1 && !isPlaying) {
                  setCurrentIndex(0);
                  setIsPlaying(true);
                } else {
                  setIsPlaying(!isPlaying);
                }
              }}
              data-testid="btn-replay-play"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(currentIndex + 1)}
              disabled={currentIndex >= filteredTrades.length - 1}
              data-testid="btn-replay-next"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(filteredTrades.length - 1)}
              disabled={currentIndex >= filteredTrades.length - 1}
              data-testid="btn-replay-last"
            >
              <ChevronLast className="w-4 h-4" />
            </Button>

            <div className="ms-4 flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
              <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="select-replay-speed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3000">0.5x</SelectItem>
                  <SelectItem value="2000">1x</SelectItem>
                  <SelectItem value="1000">2x</SelectItem>
                  <SelectItem value="500">4x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {currentTrade && (
          <motion.div
            key={currentTrade.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <Card className={`border-2 ${(currentTrade.realizedPnl || 0) >= 0 ? "border-emerald-500/30" : "border-red-500/30"}`}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl font-bold">{currentTrade.symbol}</span>
                      <Badge variant="outline">{currentTrade.side}</Badge>
                      {currentTrade.setupType && (
                        <Badge variant="secondary" className="text-xs">{currentTrade.setupType}</Badge>
                      )}
                      {currentTrade.strategy && (
                        <Badge variant="outline" className="text-xs border-indigo-500/30 text-indigo-400">{currentTrade.strategy}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {currentTrade.closedAt ? new Date(currentTrade.closedAt).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className={`text-2xl font-bold ${(currentTrade.realizedPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`} data-testid="text-replay-current-pnl">
                      {(currentTrade.realizedPnl || 0) >= 0 ? "+" : ""}{formatCurrency(currentTrade.realizedPnl || 0)}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {(currentTrade.realizedPnl || 0) >= 0 ? (
                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-red-400" />
                      )}
                      <span>{t("replay.trade")} #{currentIndex + 1}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-xs text-muted-foreground">{t("journal.quantity")}</span>
                    <p className="font-medium">{currentTrade.quantity}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("journal.entryPrice")}</span>
                    <p className="font-medium">${currentTrade.entryPrice?.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("journal.exitPrice")}</span>
                    <p className="font-medium">${currentTrade.exitPrice?.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("journal.openedAt")}</span>
                    <p className="font-medium text-xs">
                      {currentTrade.openedAt ? new Date(currentTrade.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                    </p>
                  </div>
                </div>

                {currentTrade.tags && currentTrade.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {currentTrade.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}

                {currentTrade.psychology && (
                  <div className="p-2 rounded-lg bg-secondary/20 mb-3 text-sm space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Brain className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      {currentTrade.psychology.moodBefore && (
                        <span>{t("journal.moodBefore")}: {MOOD_EMOJI[currentTrade.psychology.moodBefore]} {t(`journal.mood.${currentTrade.psychology.moodBefore}`)}</span>
                      )}
                      {currentTrade.psychology.moodAfter && (
                        <span>{t("journal.moodAfter")}: {MOOD_EMOJI[currentTrade.psychology.moodAfter]} {t(`journal.mood.${currentTrade.psychology.moodAfter}`)}</span>
                      )}
                      {currentTrade.psychology.confidence && (
                        <span>{t("journal.confidence")}: {currentTrade.psychology.confidence}/5</span>
                      )}
                      {currentTrade.psychology.discipline && (
                        <span>{t("journal.discipline")}: {currentTrade.psychology.discipline}/5</span>
                      )}
                    </div>
                    {currentTrade.psychology.lessonsLearned && (
                      <p className="text-xs text-muted-foreground ps-7">
                        {t("journal.lessonsLearned")}: {currentTrade.psychology.lessonsLearned}
                      </p>
                    )}
                  </div>
                )}

                {currentTrade.notes && (
                  <div className="p-2 rounded-lg bg-secondary/20 mb-3">
                    <p className="text-xs text-muted-foreground mb-1">{t("journal.notes")}</p>
                    <p className="text-sm">{currentTrade.notes}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setShowPsychEditor(!showPsychEditor)}
                    data-testid="btn-replay-edit-psych"
                  >
                    <MessageSquare className="w-3.5 h-3.5 me-1" />
                    {showPsychEditor ? t("replay.hideEditor") : t("replay.addNotes")}
                  </Button>
                </div>

                <AnimatePresence>
                  {showPsychEditor && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 pt-3 mt-3 border-t border-border/30">
                        <div>
                          <Label className="text-xs">{t("journal.notes")}</Label>
                          <Textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            rows={2}
                            className="text-sm"
                            data-testid="input-replay-notes"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">{t("journal.moodBefore")}</Label>
                            <Select value={editMoodBefore} onValueChange={setEditMoodBefore}>
                              <SelectTrigger className="h-8 text-sm" data-testid="select-replay-mood-before">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {MOODS.map(m => (
                                  <SelectItem key={m} value={m}>{MOOD_EMOJI[m]} {t(`journal.mood.${m}`)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">{t("journal.moodAfter")}</Label>
                            <Select value={editMoodAfter} onValueChange={setEditMoodAfter}>
                              <SelectTrigger className="h-8 text-sm" data-testid="select-replay-mood-after">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {MOODS.map(m => (
                                  <SelectItem key={m} value={m}>{MOOD_EMOJI[m]} {t(`journal.mood.${m}`)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">{t("journal.confidence")} (1-5)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={5}
                              value={editConfidence}
                              onChange={(e) => setEditConfidence(e.target.value)}
                              className="h-8 text-sm"
                              dir="ltr"
                              data-testid="input-replay-confidence"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">{t("journal.discipline")} (1-5)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={5}
                              value={editDiscipline}
                              onChange={(e) => setEditDiscipline(e.target.value)}
                              className="h-8 text-sm"
                              dir="ltr"
                              data-testid="input-replay-discipline"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">{t("journal.lessonsLearned")}</Label>
                          <Textarea
                            value={editLessons}
                            onChange={(e) => setEditLessons(e.target.value)}
                            rows={2}
                            className="text-sm"
                            data-testid="input-replay-lessons"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={saveCurrentTradeData}
                          disabled={updateNoteMutation.isPending || savePsychMutation.isPending}
                          data-testid="btn-replay-save"
                        >
                          <Save className="w-3.5 h-3.5 me-1" />
                          {t("replay.saveChanges")}
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {filteredTrades.map((trade, i) => (
          <button
            key={trade.id}
            onClick={() => { setIsPlaying(false); goTo(i); }}
            className={`flex-shrink-0 px-2 py-1 rounded-md text-xs transition-all ${
              i === currentIndex
                ? "bg-indigo-600 text-white ring-2 ring-indigo-400/50"
                : i <= currentIndex
                ? (trade.realizedPnl || 0) >= 0
                  ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                  : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
            }`}
            data-testid={`btn-replay-dot-${i}`}
          >
            {trade.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}