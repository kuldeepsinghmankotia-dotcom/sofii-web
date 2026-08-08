from app.clients import groq_client
from app.clients.supabase_client import get_supabase
from app.graph.query_state import QueryState

SUMMARIZE_SYSTEM_PROMPT = """Summarize the following document content in a few clear paragraphs, capturing the key points."""

MAX_CONTENT_CHARS = 12_000


async def summarize_document_node(state: QueryState) -> dict:
    if len(state.document_ids) != 1:
        return {"answer": "Please select exactly one document to summarize.", "citations": []}

    document_id = state.document_ids[0]
    supabase = await get_supabase()
    # Explicit user_id filter is defense-in-depth, same reasoning as
    # match_document_chunks's own comment: the service-role client bypasses
    # RLS entirely, so this filter is the only thing stopping one user's
    # query from reading another user's document_chunks rows.
    response = (
        await supabase.table("document_chunks")
        .select("content")
        .eq("document_id", document_id)
        .eq("user_id", state.user_id)
        .order("chunk_index")
        .execute()
    )
    chunks = response.data

    if not chunks:
        return {"answer": "That document has no content, or doesn't belong to you.", "citations": []}

    full_text = "\n\n".join(c["content"] for c in chunks)[:MAX_CONTENT_CHARS]
    summary = await groq_client.chat_completion(
        system_prompt=SUMMARIZE_SYSTEM_PROMPT, user_content=full_text, max_tokens=600
    )
    return {"answer": summary, "citations": []}
