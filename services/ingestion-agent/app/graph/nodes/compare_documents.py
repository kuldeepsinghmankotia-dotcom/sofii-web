from app.clients import groq_client
from app.clients.supabase_client import get_supabase
from app.graph.query_state import QueryState

COMPARE_SYSTEM_PROMPT = """Compare and contrast the following documents. Note key similarities and differences, referring to them as "Document 1", "Document 2", etc."""

MAX_CONTENT_CHARS_PER_DOC = 6_000


async def compare_documents_node(state: QueryState) -> dict:
    if len(state.document_ids) < 2:
        return {"answer": "Please select at least two documents to compare.", "citations": []}

    supabase = await get_supabase()
    blocks: list[str] = []

    for index, document_id in enumerate(state.document_ids):
        response = (
            await supabase.table("document_chunks")
            .select("content")
            .eq("document_id", document_id)
            .eq("user_id", state.user_id)
            .order("chunk_index")
            .execute()
        )
        chunks = response.data
        text = "\n\n".join(c["content"] for c in chunks)[:MAX_CONTENT_CHARS_PER_DOC]
        blocks.append(f"Document {index + 1}:\n{text or '(no content, or not yours)'}")

    comparison = await groq_client.chat_completion(
        system_prompt=COMPARE_SYSTEM_PROMPT,
        user_content="\n\n---\n\n".join(blocks),
        max_tokens=800,
    )
    return {"answer": comparison, "citations": []}
