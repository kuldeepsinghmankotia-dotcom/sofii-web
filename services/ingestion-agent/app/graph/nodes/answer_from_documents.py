import json

from app.clients import gemini_client, groq_client
from app.clients.supabase_client import get_supabase
from app.graph.query_state import Citation, QueryState

SYNTHESIS_SYSTEM_PROMPT = """Answer the user's question using ONLY the provided document excerpts. Cite which excerpt(s) you used by their number in brackets, e.g. [1]. If the excerpts don't contain the answer, say so plainly rather than guessing."""


async def answer_from_documents_node(state: QueryState) -> dict:
    [embedding] = await gemini_client.embed_texts([state.query])

    supabase = await get_supabase()
    response = await supabase.rpc(
        "match_document_chunks_for_service",
        {
            "query_embedding": json.dumps(embedding),
            "target_user_id": state.user_id,
            "match_count": 5,
        },
    ).execute()
    matches = response.data

    if not matches:
        return {
            "answer": "I couldn't find anything in your documents relevant to that question.",
            "citations": [],
        }

    excerpts_block = "\n\n".join(f"[{i + 1}] {m['content']}" for i, m in enumerate(matches))
    answer = await groq_client.chat_completion(
        system_prompt=SYNTHESIS_SYSTEM_PROMPT,
        user_content=f"Question: {state.query}\n\nDocument excerpts:\n{excerpts_block}",
        max_tokens=600,
    )

    citations = [
        Citation(document_id=m["document_id"], chunk_id=m["id"], content=m["content"]) for m in matches
    ]
    return {"answer": answer, "citations": citations}
