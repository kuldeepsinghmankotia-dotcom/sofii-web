import json

from pydantic import BaseModel, ValidationError, field_validator

from app.clients import groq_client
from app.clients.supabase_client import get_supabase
from app.graph.query_state import QueryState

EXTRACT_SYSTEM_PROMPT = """The user wants specific data extracted from a document. Reply with ONLY a JSON object matching {"data": ...} where "data" is either a single JSON object (for one record) or a JSON array of objects (for multiple records, e.g. "extract each row" / "list every X"), containing the requested fields extracted from the document content. If a requested field isn't present in the content, use null for its value. Never invent values."""

MAX_CONTENT_CHARS = 12_000


class ExtractedData(BaseModel):
    # A request like "list each employee" naturally produces an array of
    # records, not a single object - both are valid extraction shapes.
    data: dict | list[dict]

    @field_validator("data")
    @classmethod
    def non_empty(cls, value: dict | list[dict]) -> dict | list[dict]:
        if not value:
            raise ValueError("extraction produced no data")
        return value


async def extract_structured_data_node(state: QueryState) -> dict:
    if len(state.document_ids) != 1:
        return {"answer": "Please select exactly one document to extract data from.", "citations": []}

    document_id = state.document_ids[0]
    supabase = await get_supabase()
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
    raw = await groq_client.chat_completion(
        system_prompt=EXTRACT_SYSTEM_PROMPT,
        user_content=f"Request: {state.query}\n\nDocument content:\n{full_text}",
        max_tokens=600,
        json_mode=True,
    )

    try:
        result = ExtractedData.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as exc:
        return {"answer": f"Could not extract structured data: {exc}", "citations": []}

    return {"answer": json.dumps(result.data, indent=2), "citations": []}
