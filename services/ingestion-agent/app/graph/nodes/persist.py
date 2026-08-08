import json

from app.clients.supabase_client import get_supabase
from app.graph.state import IngestionState


async def persist_node(state: IngestionState) -> dict:
    supabase = await get_supabase()

    document_response = (
        await supabase.table("documents")
        .insert(
            {
                "user_id": state.user_id,
                "filename": state.filename,
                "source_type": state.detected_format,
                "ingested_by": "python",
                "metadata": {},
            }
        )
        .execute()
    )
    document_id = document_response.data[0]["id"]

    rows = [
        {
            "document_id": document_id,
            "user_id": state.user_id,
            "chunk_index": index,
            "content": chunk.content,
            "embedding": json.dumps(chunk.embedding),
            "modality": state.modality,
            "metadata": chunk.metadata,
        }
        for index, chunk in enumerate(state.validated_chunks)
    ]

    await supabase.table("document_chunks").insert(rows).execute()

    return {"document_id": document_id}
