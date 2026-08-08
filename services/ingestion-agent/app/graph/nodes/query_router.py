import json

from pydantic import BaseModel, ValidationError

from app.clients import groq_client
from app.graph.query_state import QueryIntentType, QueryState

ROUTER_SYSTEM_PROMPT = """You classify a user's question about their uploaded documents into exactly one category. Reply with ONLY a JSON object: {"intent": "<category>"}.

Categories:
- "answer_from_documents": a specific question that should be answered using relevant passages from the user's documents (the default for most questions).
- "summarize_document": the user wants a summary of one specific document.
- "compare_documents": the user wants two or more documents compared/contrasted.
- "extract_structured_data": the user wants specific fields/data points pulled out of a document into a structured format (e.g. "extract the name, date, and amount from this invoice").

Pick "answer_from_documents" whenever you're unsure - it's the safe default."""


class QueryIntentResult(BaseModel):
    intent: QueryIntentType


async def classify_intent(query: str) -> QueryIntentType:
    raw = await groq_client.chat_completion(
        system_prompt=ROUTER_SYSTEM_PROMPT, user_content=query, max_tokens=200, json_mode=True
    )
    try:
        result = QueryIntentResult.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError):
        # A malformed classification shouldn't fail the whole query - the
        # safe default still gives the user a useful answer.
        return "answer_from_documents"
    return result.intent


async def query_router_node(state: QueryState) -> dict:
    # An explicit intent (set by a caller that already knows what it wants —
    # e.g. the main chat's summarize_document/compare_documents/
    # extract_structured_data tools) skips classification entirely rather
    # than re-guessing something the caller was already certain about.
    if state.intent is not None:
        return {}
    intent = await classify_intent(state.query)
    return {"intent": intent}
