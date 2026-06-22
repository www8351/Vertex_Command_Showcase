import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  ColorType,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  time: number;
  price: number;
  type: "entry" | "exit";
  side: "buy" | "sell";
  label?: string;
}

interface CandlestickChartProps {
  candles: CandleData[];
  markers?: TradeMarker[];
  theme?: "light" | "dark";
  height?: number;
  visibleRange?: { from: number; to: number } | null;
}

export default function CandlestickChart({
  candles,
  markers = [],
  theme = "dark",
  height = 400,
  visibleRange,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const isDark = theme === "dark";
    const gridColor = isDark ? "#2a2d3a" : "#d1d5db";
    const textColor = isDark ? "#9ca3af" : "#6b7280";

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: isDark ? "#1f2937" : "#e5e7eb", style: LineStyle.Solid },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      crosshair: {
        vertLine: { color: "#6366f1", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#6366f1" },
        horzLine: { color: "#6366f1", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#6366f1" },
      },
      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        barSpacing: 8,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    candleSeriesRef.current = candleSeries;

    const candleChartData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleChartData);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeriesRef.current = volumeSeries;

    const volumeData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    }));

    volumeSeries.setData(volumeData);

    if (markers.length > 0) {
      const chartMarkers = markers
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: m.type === "entry"
            ? (m.side === "buy" ? "belowBar" as const : "aboveBar" as const)
            : (m.side === "buy" ? "aboveBar" as const : "belowBar" as const),
          color: m.type === "entry" ? "#3b82f6" : "#f59e0b",
          shape: m.type === "entry"
            ? (m.side === "buy" ? "arrowUp" as const : "arrowDown" as const)
            : (m.side === "buy" ? "arrowDown" as const : "arrowUp" as const),
          text: m.label || (m.type === "entry" ? `Entry $${m.price.toFixed(2)}` : `Exit $${m.price.toFixed(2)}`),
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));

      markersRef.current = createSeriesMarkers(candleSeries, chartMarkers);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (markersRef.current) {
        markersRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [candles, markers, theme, height]);

  useEffect(() => {
    if (!chartRef.current || !visibleRange) return;
    chartRef.current.timeScale().setVisibleRange({
      from: visibleRange.from as UTCTimestamp,
      to: visibleRange.to as UTCTimestamp,
    });
  }, [visibleRange]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height: `${height}px`, direction: "ltr" }}
      data-testid="candlestick-chart"
    />
  );
}
