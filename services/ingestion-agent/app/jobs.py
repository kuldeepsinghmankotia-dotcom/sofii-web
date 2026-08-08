import logging
from datetime import UTC, datetime

from app.clients.supabase_client import get_supabase
from app.config import settings

logger = logging.getLogger("ingestion_agent.jobs")


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def mark_job_processing(job_id: str) -> None:
    supabase = await get_supabase()
    await supabase.table("ingestion_jobs").update(
        {"status": "processing", "updated_at": _now()}
    ).eq("id", job_id).execute()


async def mark_job_done(job_id: str, document_id: str) -> None:
    supabase = await get_supabase()
    await supabase.table("ingestion_jobs").update(
        {"status": "done", "document_id": document_id, "updated_at": _now()}
    ).eq("id", job_id).execute()


async def mark_job_failed(job_id: str, error_message: str, storage_path: str | None = None) -> None:
    supabase = await get_supabase()
    await supabase.table("ingestion_jobs").update(
        {"status": "failed", "error_message": error_message[:2000], "updated_at": _now()}
    ).eq("id", job_id).execute()

    # A failed job never produces a documents row, so nothing else will
    # ever point back at this file - clean it up now rather than leaving it
    # orphaned in Storage forever. Best-effort: a cleanup failure shouldn't
    # surface as an ingestion failure on top of the real one.
    if storage_path:
        try:
            await supabase.storage.from_(settings.document_uploads_bucket).remove([storage_path])
        except Exception:
            logger.exception(
                "failed to delete orphaned storage object after job failure",
                extra={"job_id": job_id, "storage_path": storage_path},
            )
