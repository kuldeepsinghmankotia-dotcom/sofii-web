"""Real end-to-end test against the local Supabase schema: creates a real
auth.users row via the admin API, uploads a real file to Storage, runs the
actual compiled graph (Redis checkpointer included), and asserts on the
real documents/document_chunks rows it produces. Requires local Supabase
+ Redis running (`supabase start`, `docker start sofii-ingestion-redis`),
same as every other test in this session's manual verification - this
just codifies that into something `pytest` can re-run.
"""

import uuid

import pytest

from app.clients.supabase_client import get_supabase
from app.config import settings
from app.graph.build import build_graph
from app.graph.checkpointer import job_thread_config, redis_checkpointer
from app.graph.state import IngestionState

FIXTURE_TEXT = b"The end-to-end test constant is SPARROW-8823-VELVET."


@pytest.fixture
async def test_user():
    supabase = await get_supabase()
    email = f"e2e-{uuid.uuid4().hex[:12]}@example.com"
    response = await supabase.auth.admin.create_user(
        {"email": email, "password": "TestPass123!", "email_confirm": True}
    )
    user_id = response.user.id
    yield user_id
    await supabase.auth.admin.delete_user(user_id)  # cascades documents/document_chunks/ingestion_jobs


async def test_txt_ingestion_end_to_end(test_user: str) -> None:
    supabase = await get_supabase()
    storage_path = f"{test_user}/e2e-fixture.txt"
    await supabase.storage.from_(settings.document_uploads_bucket).upload(
        storage_path, FIXTURE_TEXT, {"content-type": "text/plain"}
    )

    job_id = str(uuid.uuid4())
    async with redis_checkpointer(settings.redis_url) as saver:
        graph = build_graph(checkpointer=saver)
        state = IngestionState(
            job_id=job_id,
            storage_path=storage_path,
            filename="e2e-fixture.txt",
            mime_type="text/plain",
            user_id=test_user,
        )
        result = await graph.ainvoke(state, config=job_thread_config(job_id))

    document_id = result["document_id"]
    assert document_id

    document_response = await supabase.table("documents").select("*").eq("id", document_id).execute()
    assert len(document_response.data) == 1
    document = document_response.data[0]
    assert document["user_id"] == test_user
    assert document["source_type"] == "txt"
    assert document["ingested_by"] == "python"

    chunks_response = (
        await supabase.table("document_chunks").select("*").eq("document_id", document_id).execute()
    )
    assert len(chunks_response.data) >= 1
    assert any("SPARROW-8823-VELVET" in chunk["content"] for chunk in chunks_response.data)
    assert all(chunk["user_id"] == test_user for chunk in chunks_response.data)
    assert all(len(chunk["embedding"]) > 0 for chunk in chunks_response.data)
