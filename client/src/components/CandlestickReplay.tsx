import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast,
  Gauge, Loader2, AlertTriangle, BarChart3,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import CandlestickChart, { type CandleData, type TradeMarker } from "./CandlestickChart";
import { apiUrl } from "@/lib/apiBase";

interface TradeInfo {
  symbol: string | null;
  side: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  quantity: number | null;
  openedAt: string | null;
  closedAt: string | null;
  realizedPnl: number | null;
}

interface CandlestickReplayProps {
  trade: TradeInfo;
  onClose: () => void;
  t: any;
}

export default function CandlestickReplay({ trade, onClose: _onClose, t }: CandlestickReplayProps) {
  const { formatCurrency } = useCurrency();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTime = trade.openedAt ? new Date(trade.openedAt) : null;
  const endTime = trade.closedAt ? new Date(trade.closedAt) : null;

  const queryStart = startTime ? new Date(startTime.getTime() - 4 * 60 * 60 * 1000).toISOString() : "";
  const queryEnd = endTime ? new Date(endTime.getTime() + 2 * 60 * 60 * 1000).toISOString() : "";

  const { data: marketData, isLoading, error } = useQuery<{
    candles: CandleData[];
    resolvedSymbol: string;
    source: string;
  }>({
    queryKey: ["/api/v1/journal/market-data", trade.symbol, queryStart, queryEnd],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol: trade.symbol || "",
        start: queryStart,
        end: queryEnd,
        interval: "5m",
      });
      const res = await fetch(apiUrl(`/api/v1/journal/market-data?${params}`), { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to fetch" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    enabled: !!trade.symbol && !!queryStart && !!queryEnd,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const candles = marketData?.candles || [];
  const totalCandles = candles.length;

  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [trade.symbol, trade.openedAt, trade.closedAt]);

  const entryTimestamp = startTime ? Math.floor(startTime.getTime() / 1000) : 0;
  const exitTimestamp = endTime ? Math.floor(endTime.getTime() / 1000) : 0;

  const entryIndex = useMemo(() => {
    if (!entryTimestamp || candles.length === 0) return -1;
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const diff = Math.abs(candles[i].time - entryTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }
    return closest;
  }, [candles, entryTimestamp]);

  const exitIndex = useMemo(() => {
    if (!exitTimestamp || candles.length === 0) return -1;
    let closest = 0;
    let minDiff = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const diff = Math.abs(candles[i].time - exitTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = i;
      }
    }
    return closest;
  }, [candles, exitTimestamp]);

  const visibleCandles = useMemo(() => {
    return candles.slice(0, currentIndex + 1);
  }, [candles, currentIndex]);

  const markers = useMemo(() => {
    const result: TradeMarker[] = [];
    if (entryIndex >= 0 && currentIndex >= entryIndex && trade.entryPrice) {
      result.push({
        time: candles[entryIndex].time,
        price: trade.entryPrice,
        type: "entry",
        side: (trade.side?.toLowerCase() === "sell" ? "sell" : "buy") as "buy" | "sell",
        label: `Entry $${trade.entryPrice.toFixed(2)}`,
      });
    }
    if (exitIndex >= 0 && currentIndex >= exitIndex && trade.exitPrice) {
      result.push({
        time: candles[exitIndex].time,
        price: trade.exitPrice,
        type: "exit",
        side: (trade.side?.toLowerCase() === "sell" ? "sell" : "buy") as "buy" | "sell",
        label: `Exit $${trade.exitPrice.toFixed(2)}`,
      });
    }
    return result;
  }, [candles, currentIndex, entryIndex, exitIndex, trade]);

  const livePnl = useMemo(() => {
    if (currentIndex < entryIndex || !trade.entryPrice || visibleCandles.length === 0) return null;
    const currentPrice = visibleCandles[visibleCandles.length - 1].close;
    const isBuy = trade.side?.toLowerCase() !== "sell";
    const diff = isBuy ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
    const qty = trade.quantity || 1;
    return diff * qty;
  }, [visibleCandles, currentIndex, entryIndex, trade]);

  useEffect(() => {
    if (isPlaying && totalCandles > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= totalCandles - 1) {
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
  }, [isPlaying, speed, totalCandles]);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(index, totalCandles - 1)));
    },
    [totalCandles]
  );

  const skipToEntry = useCallback(() => {
    if (entryIndex >= 0) goTo(entryIndex);
  }, [entryIndex, goTo]);

  const skipToExit = useCallback(() => {
    if (exitIndex >= 0) goTo(exitIndex);
  }, [exitIndex, goTo]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <p className="text-sm text-muted-foreground">{t("replay.loadingChart")}</p>
      </div>
    );
  }

  if (error || candles.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">{t("replay.chartUnavailable")}</p>
          <p className="text-xs text-muted-foreground">
            {error ? (error as Error).message : t("replay.noMarketData")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const replayPhase =
    currentIndex < entryIndex ? "before" : currentIndex < exitIndex ? "in-trade" : "after";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-500" />
          <h3 className="text-sm font-bold">{t("replay.candlestickReplay")}</h3>
          <Badge variant="outline" className="text-xs" data-testid="badge-resolved-symbol">
            {marketData?.resolvedSymbol || trade.symbol}
          </Badge>
        </div>
        {livePnl !== null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("replay.livePnl")}:</span>
            <span
              className={`text-sm font-bold ${livePnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
              data-testid="text-live-pnl"
            >
              {livePnl >= 0 ? "+" : ""}
              {formatCurrency(livePnl)}
            </span>
          </div>
        )}
      </div>

      <CandlestickChart candles={visibleCandles} markers={markers} theme="dark" height={350} />

      <Card className="border-border/40">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex items-center gap-2">
            <Slider
              value={[currentIndex]}
              min={0}
              max={Math.max(0, totalCandles - 1)}
              step={1}
              onValueChange={([val]) => {
                setIsPlaying(false);
                goTo(val);
              }}
              className="flex-1"
              data-testid="slider-candle-replay"
            />
            <span className="text-xs text-muted-foreground min-w-[60px] text-end">
              {currentIndex + 1}/{totalCandles}
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(0)}
              disabled={currentIndex === 0}
              data-testid="btn-candle-first"
            >
              <ChevronFirst className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              data-testid="btn-candle-prev"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              variant={isPlaying ? "secondary" : "default"}
              size="icon"
              className="h-10 w-10 rounded-full"
              onClick={() => {
                if (currentIndex >= totalCandles - 1 && !isPlaying) {
                  setCurrentIndex(0);
                  setIsPlaying(true);
                } else {
                  setIsPlaying(!isPlaying);
                }
              }}
              data-testid="btn-candle-play"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(currentIndex + 1)}
              disabled={currentIndex >= totalCandles - 1}
              data-testid="btn-candle-next"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => goTo(totalCandles - 1)}
              disabled={currentIndex >= totalCandles - 1}
              data-testid="btn-candle-last"
            >
              <ChevronLast className="w-4 h-4" />
            </Button>

            <div className="border-s border-border ps-2 ms-1 flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={skipToEntry}
                disabled={entryIndex < 0}
                data-testid="btn-skip-entry"
              >
                {t("replay.skipToEntry")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={skipToExit}
                disabled={exitIndex < 0}
                data-testid="btn-skip-exit"
              >
                {t("replay.skipToExit")}
              </Button>
            </div>

            <div className="border-s border-border ps-2 ms-1 flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
              <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                <SelectTrigger className="h-7 w-[80px] text-xs" data-testid="select-candle-speed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">0.5x</SelectItem>
                  <SelectItem value="500">1x</SelectItem>
                  <SelectItem value="250">2x</SelectItem>
                  <SelectItem value="125">4x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 text-xs">
            <Badge
              variant={replayPhase === "before" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {t("replay.preEntry")}
            </Badge>
            <Badge
              variant={replayPhase === "in-trade" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {t("replay.inTrade")}
            </Badge>
            <Badge
              variant={replayPhase === "after" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {t("replay.postExit")}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
