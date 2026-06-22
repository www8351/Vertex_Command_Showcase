import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from prometheus_fastapi_instrumentator import Instrumentator

from config import settings
from db import engine, get_session
from queries import fetch_trades, fetch_journal_trades, fetch_risk_interventions, fetch_copy_orders
from metrics import compute_trade_metrics, compute_risk_summary, compute_copy_performance

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("analytics")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Analytics engine starting...")
    try:
        async with engine.connect() as conn:
            from sqlalchemy import text
            result = await conn.execute(text("SELECT 1"))
            result.fetchone()
        logger.info("Database connection verified")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
    yield
    await engine.dispose()
    logger.info("Analytics engine stopped")


app = FastAPI(
    title="Vertex Command Analytics",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    should_respect_env_var=False,
    excluded_handlers=["/health", "/metrics"],
    # metric_namespace/metric_subsystem were removed from the Instrumentator
    # constructor in prometheus-fastapi-instrumentator v6.0 (kwargs raise TypeError
    # on the pinned v7.0.2). Dropped here — the Grafana dashboard filters analytics
    # metrics by Prometheus job label, not by an "analytics_" name prefix.
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/health")
async def health():
    try:
        async with engine.connect() as conn:
            from sqlalchemy import text
            await conn.execute(text("SELECT 1"))
        return {"status": "healthy", "service": "analytics"}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "error": str(e)})


def _validate_dates(from_date: str | None, to_date: str | None):
    for label, val in [("from", from_date), ("to", to_date)]:
        if val is not None:
            try:
                datetime.fromisoformat(val.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                raise HTTPException(status_code=422, detail=f"Invalid '{label}' date format. Use ISO 8601 (e.g. 2025-01-15)")


@app.get("/api/analytics/trade-metrics")
async def trade_metrics(
    user_id: int = Query(...),
    account_id: int | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    source: str = Query("imported", regex="^(imported|journal)$"),
    session: AsyncSession = Depends(get_session),
):
    _validate_dates(from_date, to_date)
    try:
        if source == "journal":
            rows = await fetch_journal_trades(session, user_id, account_id, from_date, to_date)
        else:
            rows = await fetch_trades(session, user_id, account_id, from_date, to_date)

        rows_dicts = [dict(r) for r in rows]
        result = compute_trade_metrics(rows_dicts)
        result["source"] = source
        result["queryParams"] = {
            "userId": user_id, "accountId": account_id,
            "from": from_date, "to": to_date,
        }
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Trade metrics computation failed")
        raise HTTPException(status_code=500, detail=f"Computation error: {str(e)}")


@app.get("/api/analytics/risk-summary")
async def risk_summary(
    user_id: int = Query(...),
    account_id: int | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    _validate_dates(from_date, to_date)
    try:
        rows = await fetch_risk_interventions(session, user_id, account_id, from_date, to_date)
        rows_dicts = [dict(r) for r in rows]
        result = compute_risk_summary(rows_dicts)
        result["queryParams"] = {
            "userId": user_id, "accountId": account_id,
            "from": from_date, "to": to_date,
        }
        return result
    except Exception as e:
        logger.exception("Risk summary computation failed")
        raise HTTPException(status_code=500, detail=f"Computation error: {str(e)}")


@app.get("/api/analytics/copy-performance")
async def copy_performance(
    user_id: int = Query(...),
    group_id: int | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    _validate_dates(from_date, to_date)
    try:
        rows = await fetch_copy_orders(session, user_id, group_id, from_date, to_date)
        rows_dicts = [dict(r) for r in rows]
        result = compute_copy_performance(rows_dicts)
        result["queryParams"] = {
            "groupId": group_id,
            "from": from_date, "to": to_date,
        }
        return result
    except Exception as e:
        logger.exception("Copy performance computation failed")
        raise HTTPException(status_code=500, detail=f"Computation error: {str(e)}")
