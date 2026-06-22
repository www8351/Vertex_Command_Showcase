import { useEffect, useRef, useCallback } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, ColorType, LineStyle, type UTCTimestamp } from "lightweight-charts";

interface EquityCurveChartProps {
  data: { timestamp: string; balance: number }[];
  startSize: number;
  target: number;
  maxDrawdown: number;
  isUp: boolean;
  period: "1d" | "1w" | "1m" | "3m";
  theme?: "light" | "dark";
  showBoundaries?: boolean;
  displayMode?: "usd" | "pct";
}

export function EquityCurveChart({ data, startSize, target, maxDrawdown, isUp, period, theme = "dark", showBoundaries = false, displayMode = "usd" }: EquityCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const getFilteredData = useCallback(() => {
    if (!data || data.length === 0) return [];

    const now = new Date();
    let cutoffMs: number | null = null;

    if (period === "1d") {
      cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
    } else if (period === "1w") {
      cutoffMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (period === "1m") {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      cutoffMs = d.getTime();
    } else if (period === "3m") {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      cutoffMs = d.getTime();
    }

    const filtered = cutoffMs
      ? data.filter(d => new Date(d.timestamp).getTime() >= cutoffMs!)
      : data;

    const seen = new Set<number>();
    const result: { time: UTCTimestamp; value: number }[] = [];

    for (const d of filtered) {
      const ts = Math.floor(new Date(d.timestamp).getTime() / 1000) as UTCTimestamp;
      if (!seen.has(ts)) {
        seen.add(ts);
        const value = displayMode === "pct" && startSize > 0
          ? Math.round(((d.balance - startSize) / startSize) * 10000) / 100
          : d.balance;
        result.push({ time: ts, value });
      }
    }

    result.sort((a, b) => (a.time as number) - (b.time as number));
    return result;
  }, [data, period, displayMode, startSize]);

  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = theme === "dark";
    const gridColor = isDark ? "#2a2d3a" : "#d1d5db";
    const textColor = isDark ? "#6b7280" : "#6b7280";

    const isPct = displayMode === "pct";

    const targetValue = isPct && startSize > 0 ? Math.round((target / startSize) * 10000) / 100 : startSize + target;
    const lossValue = isPct && startSize > 0 ? Math.round((-maxDrawdown / startSize) * 10000) / 100 : startSize - maxDrawdown;
    const startValue = isPct ? 0 : startSize;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      crosshair: {
        vertLine: { color: "#4f46e5", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#4f46e5" },
        horzLine: { color: "#4f46e5", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#4f46e5" },
      },
      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: showBoundaries ? { top: 0.05, bottom: 0.05 } : { top: 0.1, bottom: 0.1 },
        autoScale: !showBoundaries,
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    const lineColor = isUp ? "#4ade80" : "#f87171";
    const topColor = isUp ? "rgba(74, 222, 128, 0.3)" : "rgba(248, 113, 113, 0.3)";
    const bottomColor = isUp ? "rgba(74, 222, 128, 0.02)" : "rgba(248, 113, 113, 0.02)";

    const formatter = isPct
      ? (price: number) => price.toFixed(2) + "%"
      : (price: number) => "$" + price.toLocaleString("en-US", { maximumFractionDigits: 0 });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor,
      lineWidth: 2,
      priceFormat: { type: "custom", formatter },
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: isDark ? "#1a1d29" : "#f3f4f6",
      crosshairMarkerBackgroundColor: lineColor,
    });

    seriesRef.current = series;

    if (showBoundaries && startSize > 0) {
      series.createPriceLine({
        price: startValue,
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: isPct ? "START 0%" : `START $${startSize.toLocaleString()}`,
      });

      if (target > 0) {
        series.createPriceLine({
          price: targetValue,
          color: "#4ade80",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: isPct ? `TARGET +${targetValue}%` : `TARGET $${(startSize + target).toLocaleString()}`,
        });
      }

      if (maxDrawdown > 0) {
        series.createPriceLine({
          price: lossValue,
          color: "#f87171",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: isPct ? `LOSS ${lossValue}%` : `LOSS $${(startSize - maxDrawdown).toLocaleString()}`,
        });
      }
    }

    const chartData = getFilteredData();
    series.setData(chartData);

    if (showBoundaries && startSize > 0 && chartData.length > 0) {
      const dataValues = chartData.map(d => d.value);
      const dataMin = Math.min(...dataValues);
      const dataMax = Math.max(...dataValues);

      const boundMin = Math.min(dataMin, lossValue);
      const boundMax = Math.max(dataMax, targetValue);
      const padding = (boundMax - boundMin) * 0.08;

      chart.priceScale('right').applyOptions({
        autoScale: false,
      });

      series.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: {
            minValue: boundMin - padding,
            maxValue: boundMax + padding,
          },
        }),
      });
    }

    if (chartData.length > 0) {
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isUp, startSize, target, maxDrawdown, theme, showBoundaries, displayMode, getFilteredData]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const chartData = getFilteredData();
    seriesRef.current.setData(chartData);
    if (chartData.length > 0) {
      chartRef.current.timeScale().fitContent();
    }
  }, [getFilteredData]);

  return (
    <div
      ref={containerRef}
      className="w-full h-44 lg:h-56"
      data-testid="equity-curve-chart"
      style={{ direction: "ltr" }}
    />
  );
}
