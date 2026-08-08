import functools
import inspect
import logging
import time
from collections.abc import Awaitable, Callable

from prometheus_client import Counter, Histogram

logger = logging.getLogger("ingestion_agent.node")

ingestion_jobs_total = Counter("ingestion_jobs_total", "Ingestion jobs by final status", ["status"])
ocr_cross_validation_total = Counter(
    "ocr_cross_validation_total", "OCR ensemble cross-validation outcomes", ["status"]
)
query_requests_total = Counter("query_requests_total", "Query-agent requests by classified intent", ["intent"])
node_duration_seconds = Histogram("node_duration_seconds", "Graph node execution duration", ["node"])


# Applied at graph-registration time (build.py / query_build.py) rather
# than as a per-file decorator, so every node - sync or async, ingestion
# or query graph - gets the same structured start/end/duration/status log
# line and the same histogram observation with zero risk of missing one.
# Works for both sync and async node functions: a sync node's return value
# isn't awaitable, so it's just used directly.
def timed_node(name: str) -> Callable[[Callable], Callable[..., Awaitable]]:
    def decorator(func: Callable) -> Callable[..., Awaitable]:
        @functools.wraps(func)
        async def wrapper(state):
            start = time.perf_counter()
            try:
                result = func(state)
                if inspect.isawaitable(result):
                    result = await result
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                node_duration_seconds.labels(node=name).observe(duration_ms / 1000)
                logger.info(
                    "node executed",
                    extra={"node": name, "duration_ms": duration_ms, "node_status": "ok"},
                )
                return result
            except Exception:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                node_duration_seconds.labels(node=name).observe(duration_ms / 1000)
                logger.exception(
                    "node failed",
                    extra={"node": name, "duration_ms": duration_ms, "node_status": "error"},
                )
                raise

        return wrapper

    return decorator
