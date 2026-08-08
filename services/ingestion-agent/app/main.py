import logging
import time

from fastapi import FastAPI, Request

from app.config import settings
from app.logging_config import configure_logging
from app.routers import health, ingest, metrics, query

configure_logging(settings.log_level)
logger = logging.getLogger("ingestion_agent.request")

app = FastAPI(title="Sofii Ingestion Agent")
app.include_router(health.router)
app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(metrics.router)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    logger.info(
        "request handled",
        extra={
            "http_method": request.method,
            "http_path": request.url.path,
            "http_status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response
