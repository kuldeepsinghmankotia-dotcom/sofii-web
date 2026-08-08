from datetime import UTC, datetime

from app.clients.supabase_client import get_supabase


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


async def mark_job_failed(job_id: str, error_message: str) -> None:
    supabase = await get_supabase()
    await supabase.table("ingestion_jobs").update(
        {"status": "failed", "error_message": error_message[:2000], "updated_at": _now()}
    ).eq("id", job_id).execute()
