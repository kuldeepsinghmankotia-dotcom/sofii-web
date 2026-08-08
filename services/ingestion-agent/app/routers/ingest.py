import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.auth import verify_shared_secret
from app.config import settings
from app.graph.build import build_graph
from app.graph.checkpointer import job_thread_config, redis_checkpointer
from app.graph.state import IngestionState
from app.jobs import mark_job_done, mark_job_failed, mark_job_processing
from app.metrics import ingestion_jobs_total

logger = logging.getLogger("ingestion_agent.ingest")

router = APIRouter()


class IngestRequest(BaseModel):
    job_id: str
    user_id: str
    storage_path: str
    filename: str
    mime_type: str


async def _run_ingestion_job(payload: IngestRequest) -> None:
    try:
        await mark_job_processing(payload.job_id)
        async with redis_checkpointer(settings.redis_url) as saver:
            graph = build_graph(checkpointer=saver)
            state = IngestionState(
                job_id=payload.job_id,
                storage_path=payload.storage_path,
                filename=payload.filename,
                mime_type=payload.mime_type,
                user_id=payload.user_id,
            )
            result = await graph.ainvoke(state, config=job_thread_config(payload.job_id))

        document_id = result.get("document_id")
        if not document_id:
            raise RuntimeError("Graph completed without producing a document_id")
        await mark_job_done(payload.job_id, document_id)
        ingestion_jobs_total.labels(status="done").inc()
        logger.info(
            "ingestion job done",
            extra={"job_id": payload.job_id, "document_id": document_id},
        )
    except Exception as exc:
        logger.exception("ingestion job failed", extra={"job_id": payload.job_id})
        ingestion_jobs_total.labels(status="failed").inc()
        try:
            await mark_job_failed(payload.job_id, str(exc), payload.storage_path)
        except Exception:
            # The job_id itself may be what's malformed (e.g. not a valid
            # UUID) - in that case even this update fails. Logged so it's
            # still visible; the background task must never raise past
            # this point regardless.
            logger.exception(
                "could not mark job failed - job_id itself may be invalid",
                extra={"job_id": payload.job_id},
            )


@router.post("/ingest", dependencies=[Depends(verify_shared_secret)])
async def ingest(payload: IngestRequest, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(_run_ingestion_job, payload)
    return {"accepted": True, "job_id": payload.job_id}
