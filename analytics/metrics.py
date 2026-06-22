import pandas as pd
import numpy as np
from typing import Any


def compute_trade_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return _empty_metrics()

    df = pd.DataFrame(rows)
    df["realized_pnl"] = pd.to_numeric(df["realized_pnl"], errors="coerce")
    df["entry_price"] = pd.to_numeric(df["entry_price"], errors="coerce")
    df["exit_price"] = pd.to_numeric(df["exit_price"], errors="coerce")
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
    df["closed_at"] = pd.to_datetime(df["closed_at"], errors="coerce", utc=True)
    df["opened_at"] = pd.to_datetime(df["opened_at"], errors="coerce", utc=True)
    df = df.dropna(subset=["realized_pnl"])

    if df.empty:
        return _empty_metrics()

    winners = df[df["realized_pnl"] > 0]
    losers = df[df["realized_pnl"] < 0]
    breakeven = df[df["realized_pnl"] == 0]

    total_trades = len(df)
    win_count = len(winners)
    loss_count = len(losers)
    be_count = len(breakeven)

    gross_profit = float(winners["realized_pnl"].sum()) if len(winners) > 0 else 0.0
    gross_loss = float(abs(losers["realized_pnl"].sum())) if len(losers) > 0 else 0.0
    net_pnl = float(df["realized_pnl"].sum())

    win_rate = win_count / total_trades if total_trades > 0 else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0
    avg_win = float(winners["realized_pnl"].mean()) if len(winners) > 0 else 0.0
    avg_loss = float(losers["realized_pnl"].mean()) if len(losers) > 0 else 0.0

    expectancy = (win_rate * avg_win) + ((1 - win_rate) * avg_loss) if total_trades > 0 else 0.0

    r_multiples = _compute_r_multiples(df)
    mae_results = _compute_mae(df)
    mfe_results = _compute_mfe(df)
    equity_curve = _compute_equity_curve(df)
    daily_stats = _compute_daily_stats(df)
    streak_stats = _compute_streaks(df)
    duration_stats = _compute_duration_stats(df)
    symbol_breakdown = _compute_symbol_breakdown(df)
    hourly_distribution = _compute_hourly_distribution(df)

    largest_win = float(df["realized_pnl"].max())
    largest_loss = float(df["realized_pnl"].min())

    return {
        "totalTrades": total_trades,
        "winCount": win_count,
        "lossCount": loss_count,
        "breakevenCount": be_count,
        "winRate": round(win_rate, 4),
        "grossProfit": round(gross_profit, 2),
        "grossLoss": round(gross_loss, 2),
        "netPnl": round(net_pnl, 2),
        "profitFactor": round(profit_factor, 4) if profit_factor != float("inf") else None,
        "profitFactorInfinite": profit_factor == float("inf"),
        "avgWin": round(avg_win, 2),
        "avgLoss": round(avg_loss, 2),
        "expectancy": round(expectancy, 2),
        "largestWin": round(largest_win, 2),
        "largestLoss": round(largest_loss, 2),
        "avgRMultiple": r_multiples["avgR"],
        "rMultipleDistribution": r_multiples["distribution"],
        "mae": mae_results,
        "mfe": mfe_results,
        "equityCurve": equity_curve,
        "dailyStats": daily_stats,
        "streaks": streak_stats,
        "durationStats": duration_stats,
        "symbolBreakdown": symbol_breakdown,
        "hourlyDistribution": hourly_distribution,
    }


def _compute_r_multiples(df: pd.DataFrame) -> dict[str, Any]:
    mask = (
        df["entry_price"].notna() &
        df["exit_price"].notna() &
        (df["entry_price"] > 0) &
        (df["quantity"] > 0)
    )
    valid = df[mask].copy()

    if valid.empty:
        return {"avgR": None, "distribution": []}

    avg_loss_per_unit = valid.loc[valid["realized_pnl"] < 0, "realized_pnl"].abs()
    if avg_loss_per_unit.empty or avg_loss_per_unit.mean() == 0:
        initial_risk = valid["entry_price"] * 0.01 * valid["quantity"]
    else:
        initial_risk = pd.Series(avg_loss_per_unit.mean(), index=valid.index)

    initial_risk = initial_risk.replace(0, np.nan)
    valid["r_multiple"] = valid["realized_pnl"] / initial_risk
    valid = valid.dropna(subset=["r_multiple"])

    if valid.empty:
        return {"avgR": None, "distribution": []}

    avg_r = float(valid["r_multiple"].mean())

    bins = [-np.inf, -3, -2, -1, 0, 1, 2, 3, np.inf]
    labels = ["<-3R", "-3R to -2R", "-2R to -1R", "-1R to 0", "0 to 1R", "1R to 2R", "2R to 3R", ">3R"]
    valid["r_bin"] = pd.cut(valid["r_multiple"], bins=bins, labels=labels)
    distribution = valid["r_bin"].value_counts().reindex(labels, fill_value=0)

    return {
        "avgR": round(avg_r, 3),
        "distribution": [{"range": k, "count": int(v)} for k, v in distribution.items()],
    }


def _compute_mae(df: pd.DataFrame) -> dict[str, Any]:
    mask = (
        df["entry_price"].notna() &
        df["exit_price"].notna() &
        (df["entry_price"] > 0) &
        (df["quantity"] > 0)
    )
    valid = df[mask].copy()

    if valid.empty:
        return {"avgMae": None, "maxMae": None, "maeBySide": {}}

    is_long = valid["side"].str.lower().isin(["buy", "long"])
    price_move = np.where(
        is_long,
        (valid["exit_price"] - valid["entry_price"]) / valid["entry_price"],
        (valid["entry_price"] - valid["exit_price"]) / valid["entry_price"],
    )

    adverse_move = np.minimum(price_move, 0)
    valid["mae_pct"] = adverse_move * 100

    avg_mae = float(valid["mae_pct"].mean())
    max_mae = float(valid["mae_pct"].min())

    mae_by_side = {}
    for side_label in ["buy", "sell"]:
        side_df = valid[valid["side"].str.lower() == side_label]
        if not side_df.empty:
            mae_by_side[side_label] = {
                "avgMae": round(float(side_df["mae_pct"].mean()), 4),
                "maxMae": round(float(side_df["mae_pct"].min()), 4),
                "count": len(side_df),
            }

    return {
        "avgMae": round(avg_mae, 4),
        "maxMae": round(max_mae, 4),
        "maeBySide": mae_by_side,
    }


def _compute_mfe(df: pd.DataFrame) -> dict[str, Any]:
    mask = (
        df["entry_price"].notna() &
        df["exit_price"].notna() &
        (df["entry_price"] > 0) &
        (df["quantity"] > 0)
    )
    valid = df[mask].copy()

    if valid.empty:
        return {"avgMfe": None, "maxMfe": None}

    is_long = valid["side"].str.lower().isin(["buy", "long"])
    price_move = np.where(
        is_long,
        (valid["exit_price"] - valid["entry_price"]) / valid["entry_price"],
        (valid["entry_price"] - valid["exit_price"]) / valid["entry_price"],
    )

    favorable_move = np.maximum(price_move, 0)
    valid["mfe_pct"] = favorable_move * 100

    return {
        "avgMfe": round(float(valid["mfe_pct"].mean()), 4),
        "maxMfe": round(float(valid["mfe_pct"].max()), 4),
    }


def _compute_equity_curve(df: pd.DataFrame) -> list[dict[str, Any]]:
    sorted_df = df.sort_values("closed_at").reset_index(drop=True)
    cumulative = sorted_df["realized_pnl"].cumsum()

    timestamps = sorted_df["closed_at"].apply(lambda ts: ts.isoformat() if pd.notna(ts) else None)
    pnls = np.round(sorted_df["realized_pnl"].values, 2)
    cum_pnls = np.round(cumulative.values, 2)

    return [
        {"tradeIndex": i, "timestamp": ts, "cumulativePnl": float(cp), "pnl": float(p)}
        for i, (ts, cp, p) in enumerate(zip(timestamps, cum_pnls, pnls))
    ]


def _compute_daily_stats(df: pd.DataFrame) -> dict[str, Any]:
    if df["closed_at"].isna().all():
        return {"tradingDays": 0, "avgDailyPnl": 0, "avgTradesPerDay": 0, "bestDay": 0, "worstDay": 0}

    daily = df.set_index("closed_at").resample("D")["realized_pnl"]
    daily_sum = daily.sum().dropna()
    daily_count = daily.count().dropna()

    active_days = daily_sum[daily_count > 0]

    if active_days.empty:
        return {"tradingDays": 0, "avgDailyPnl": 0, "avgTradesPerDay": 0, "bestDay": 0, "worstDay": 0}

    return {
        "tradingDays": len(active_days),
        "avgDailyPnl": round(float(active_days.mean()), 2),
        "avgTradesPerDay": round(float(daily_count[daily_count > 0].mean()), 1),
        "bestDay": round(float(active_days.max()), 2),
        "worstDay": round(float(active_days.min()), 2),
    }


def _compute_streaks(df: pd.DataFrame) -> dict[str, int]:
    if df.empty:
        return {"maxWinStreak": 0, "maxLossStreak": 0, "currentStreak": 0, "currentStreakType": "none"}

    sorted_df = df.sort_values("closed_at")
    signs = np.sign(sorted_df["realized_pnl"].values)

    max_win = max_loss = current = 0
    current_sign = 0

    for s in signs:
        if s == 0:
            continue
        if s == current_sign:
            current += 1
        else:
            current = 1
            current_sign = s
        if s > 0:
            max_win = max(max_win, current)
        else:
            max_loss = max(max_loss, current)

    streak_type = "win" if current_sign > 0 else "loss" if current_sign < 0 else "none"

    return {
        "maxWinStreak": max_win,
        "maxLossStreak": max_loss,
        "currentStreak": current,
        "currentStreakType": streak_type,
    }


def _compute_duration_stats(df: pd.DataFrame) -> dict[str, Any]:
    mask = df["opened_at"].notna() & df["closed_at"].notna()
    valid = df[mask].copy()

    if valid.empty:
        return {"avgDurationMinutes": None, "medianDurationMinutes": None, "minDurationMinutes": None, "maxDurationMinutes": None}

    durations = (valid["closed_at"] - valid["opened_at"]).dt.total_seconds() / 60
    durations = durations[durations >= 0]

    if durations.empty:
        return {"avgDurationMinutes": None, "medianDurationMinutes": None, "minDurationMinutes": None, "maxDurationMinutes": None}

    return {
        "avgDurationMinutes": round(float(durations.mean()), 1),
        "medianDurationMinutes": round(float(durations.median()), 1),
        "minDurationMinutes": round(float(durations.min()), 1),
        "maxDurationMinutes": round(float(durations.max()), 1),
    }


def _compute_symbol_breakdown(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty or df["symbol"].isna().all():
        return []

    groups = df.groupby("symbol")
    result = []

    for symbol, group in groups:
        wins = group[group["realized_pnl"] > 0]
        total = len(group)
        pnl = float(group["realized_pnl"].sum())
        wr = len(wins) / total if total > 0 else 0

        result.append({
            "symbol": symbol,
            "totalTrades": total,
            "netPnl": round(pnl, 2),
            "winRate": round(wr, 4),
            "avgPnl": round(pnl / total, 2) if total > 0 else 0,
        })

    result.sort(key=lambda x: x["netPnl"], reverse=True)
    return result


def _compute_hourly_distribution(df: pd.DataFrame) -> list[dict[str, Any]]:
    valid = df[df["opened_at"].notna()].copy()
    if valid.empty:
        return []

    valid["hour"] = valid["opened_at"].dt.hour
    groups = valid.groupby("hour")

    result = []
    for hour, group in groups:
        wins = group[group["realized_pnl"] > 0]
        total = len(group)
        pnl = float(group["realized_pnl"].sum())

        result.append({
            "hour": int(hour),
            "totalTrades": total,
            "netPnl": round(pnl, 2),
            "winRate": round(len(wins) / total, 4) if total > 0 else 0,
        })

    result.sort(key=lambda x: x["hour"])
    return result


def compute_risk_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "totalInterventions": 0,
            "byType": {},
            "byStatus": {},
            "avgExecutionMs": None,
            "totalPositionsClosed": 0,
            "totalOrdersCancelled": 0,
            "timeline": [],
        }

    df = pd.DataFrame(rows)
    df["trigger_timestamp"] = pd.to_datetime(df["trigger_timestamp"], errors="coerce", utc=True)

    by_type = df["trigger_type"].value_counts().to_dict()
    by_status = df["status"].value_counts().to_dict()

    exec_ms = pd.to_numeric(df["execution_ms"], errors="coerce").dropna()
    avg_exec = round(float(exec_ms.mean()), 1) if not exec_ms.empty else None

    pos_closed = int(pd.to_numeric(df["positions_closed"], errors="coerce").fillna(0).sum())
    orders_cancelled = int(pd.to_numeric(df["orders_cancelled"], errors="coerce").fillna(0).sum())

    timeline = []
    for _, row in df.iterrows():
        ts = row["trigger_timestamp"]
        timeline.append({
            "timestamp": ts.isoformat() if pd.notna(ts) else None,
            "type": row.get("trigger_type"),
            "accountName": row.get("account_name"),
            "riskPercent": round(float(row["risk_percent"]), 2) if pd.notna(row.get("risk_percent")) else None,
            "status": row.get("status"),
        })

    return {
        "totalInterventions": len(df),
        "byType": {str(k): int(v) for k, v in by_type.items()},
        "byStatus": {str(k): int(v) for k, v in by_status.items()},
        "avgExecutionMs": avg_exec,
        "totalPositionsClosed": pos_closed,
        "totalOrdersCancelled": orders_cancelled,
        "timeline": timeline[:100],
    }


def compute_copy_performance(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "totalOrders": 0,
            "avgLatencyMs": None,
            "p95LatencyMs": None,
            "avgSlippageTicks": None,
            "avgSlippageDollars": None,
            "fillRate": 0,
            "latencyDistribution": [],
        }

    df = pd.DataFrame(rows)
    df["latency_ms"] = pd.to_numeric(df["latency_ms"], errors="coerce")
    df["slippage_ticks"] = pd.to_numeric(df["slippage_ticks"], errors="coerce")
    df["slippage_dollars"] = pd.to_numeric(df["slippage_dollars"], errors="coerce")

    latency = df["latency_ms"].dropna()
    slippage_t = df["slippage_ticks"].dropna()
    slippage_d = df["slippage_dollars"].dropna()

    filled = df[df["status"].isin(["filled", "completed"])]
    fill_rate = len(filled) / len(df) if len(df) > 0 else 0

    lat_dist = []
    if not latency.empty:
        bins = [0, 50, 100, 200, 500, 1000, float("inf")]
        labels = ["<50ms", "50-100ms", "100-200ms", "200-500ms", "500ms-1s", ">1s"]
        binned = pd.cut(latency, bins=bins, labels=labels)
        counts = binned.value_counts().reindex(labels, fill_value=0)
        lat_dist = [{"range": k, "count": int(v)} for k, v in counts.items()]

    return {
        "totalOrders": len(df),
        "avgLatencyMs": round(float(latency.mean()), 1) if not latency.empty else None,
        "p95LatencyMs": round(float(latency.quantile(0.95)), 1) if not latency.empty else None,
        "avgSlippageTicks": round(float(slippage_t.mean()), 3) if not slippage_t.empty else None,
        "avgSlippageDollars": round(float(slippage_d.mean()), 2) if not slippage_d.empty else None,
        "fillRate": round(fill_rate, 4),
        "latencyDistribution": lat_dist,
    }


def _empty_metrics() -> dict[str, Any]:
    return {
        "totalTrades": 0,
        "winCount": 0,
        "lossCount": 0,
        "breakevenCount": 0,
        "winRate": 0,
        "grossProfit": 0,
        "grossLoss": 0,
        "netPnl": 0,
        "profitFactor": None,
        "profitFactorInfinite": False,
        "avgWin": 0,
        "avgLoss": 0,
        "expectancy": 0,
        "largestWin": 0,
        "largestLoss": 0,
        "avgRMultiple": None,
        "rMultipleDistribution": [],
        "mae": {"avgMae": None, "maxMae": None, "maeBySide": {}},
        "mfe": {"avgMfe": None, "maxMfe": None},
        "equityCurve": [],
        "dailyStats": {"tradingDays": 0, "avgDailyPnl": 0, "avgTradesPerDay": 0, "bestDay": 0, "worstDay": 0},
        "streaks": {"maxWinStreak": 0, "maxLossStreak": 0, "currentStreak": 0, "currentStreakType": "none"},
        "durationStats": {"avgDurationMinutes": None, "medianDurationMinutes": None, "minDurationMinutes": None, "maxDurationMinutes": None},
        "symbolBreakdown": [],
        "hourlyDistribution": [],
    }
