from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings

TRADES_QUERY = text("""
    SELECT
        t.id,
        t.account_id,
        t.symbol,
        t.side,
        t.quantity,
        t.entry_price,
        t.exit_price,
        t.realized_pnl,
        t.opened_at,
        t.closed_at,
        a.name AS account_name,
        a.firm,
        a.stage,
        a.size AS account_size
    FROM imported_trades t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.closed_at IS NOT NULL
      AND t.realized_pnl IS NOT NULL
      AND a.user_id = :user_id
      AND (:account_id IS NULL OR t.account_id = :account_id)
      AND (:from_date IS NULL OR t.closed_at >= :from_date)
      AND (:to_date IS NULL OR t.closed_at <= :to_date)
    ORDER BY t.closed_at ASC
    LIMIT :max_rows
""")

JOURNAL_TRADES_QUERY = text("""
    SELECT
        j.id,
        j.account_id,
        j.symbol,
        j.side,
        j.quantity,
        j.entry_price,
        j.exit_price,
        j.realized_pnl,
        j.opened_at,
        j.closed_at,
        j.setup_type,
        j.strategy,
        j.tags,
        a.name AS account_name,
        a.firm,
        a.stage,
        a.size AS account_size
    FROM journal_entries j
    LEFT JOIN accounts a ON a.id = j.account_id
    WHERE j.closed_at IS NOT NULL
      AND j.realized_pnl IS NOT NULL
      AND j.user_id = :user_id
      AND (:account_id IS NULL OR j.account_id = :account_id)
      AND (:from_date IS NULL OR j.closed_at >= :from_date)
      AND (:to_date IS NULL OR j.closed_at <= :to_date)
    ORDER BY j.closed_at ASC
    LIMIT :max_rows
""")

RISK_INTERVENTIONS_QUERY = text("""
    SELECT
        r.id,
        r.account_id,
        r.trigger_timestamp,
        r.trigger_type,
        r.hwm,
        r.current_equity,
        r.eod_limit,
        r.risk_percent,
        r.positions_closed,
        r.orders_cancelled,
        r.status,
        r.execution_ms,
        a.name AS account_name,
        a.firm
    FROM risk_interventions r
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.user_id = :user_id
      AND (:account_id IS NULL OR r.account_id = :account_id)
      AND (:from_date IS NULL OR r.trigger_timestamp >= :from_date)
      AND (:to_date IS NULL OR r.trigger_timestamp <= :to_date)
    ORDER BY r.trigger_timestamp DESC
    LIMIT :max_rows
""")

COPY_ORDERS_QUERY = text("""
    SELECT
        o.id,
        o.group_id,
        o.follower_account_id,
        o.symbol,
        o.side,
        o.quantity,
        o.price,
        o.master_price,
        o.status,
        o.latency_ms,
        o.slippage_ticks,
        o.slippage_dollars,
        o.master_detected_at,
        o.follower_sent_at
    FROM copy_trading_orders o
    INNER JOIN copy_trading_groups g ON g.id = o.group_id
    WHERE o.status IN ('filled', 'completed')
      AND g.user_id = :user_id
      AND (:group_id IS NULL OR o.group_id = :group_id)
      AND (:from_date IS NULL OR o.master_detected_at >= :from_date)
      AND (:to_date IS NULL OR o.master_detected_at <= :to_date)
    ORDER BY o.master_detected_at DESC
    LIMIT :max_rows
""")


async def fetch_trades(session: AsyncSession, user_id: int, account_id: int | None,
                       from_date: str | None, to_date: str | None):
    result = await session.execute(TRADES_QUERY, {
        "user_id": user_id, "account_id": account_id,
        "from_date": from_date, "to_date": to_date,
        "max_rows": settings.max_trade_rows,
    })
    return result.mappings().all()


async def fetch_journal_trades(session: AsyncSession, user_id: int,
                               account_id: int | None, from_date: str | None, to_date: str | None):
    result = await session.execute(JOURNAL_TRADES_QUERY, {
        "user_id": user_id, "account_id": account_id,
        "from_date": from_date, "to_date": to_date,
        "max_rows": settings.max_trade_rows,
    })
    return result.mappings().all()


async def fetch_risk_interventions(session: AsyncSession, user_id: int,
                                   account_id: int | None, from_date: str | None, to_date: str | None):
    result = await session.execute(RISK_INTERVENTIONS_QUERY, {
        "user_id": user_id, "account_id": account_id,
        "from_date": from_date, "to_date": to_date,
        "max_rows": settings.max_trade_rows,
    })
    return result.mappings().all()


async def fetch_copy_orders(session: AsyncSession, user_id: int, group_id: int | None,
                            from_date: str | None, to_date: str | None):
    result = await session.execute(COPY_ORDERS_QUERY, {
        "user_id": user_id,
        "group_id": group_id,
        "from_date": from_date, "to_date": to_date,
        "max_rows": settings.max_trade_rows,
    })
    return result.mappings().all()
