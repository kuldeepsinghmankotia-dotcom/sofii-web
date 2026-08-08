from typing import Literal

from pydantic import BaseModel

QueryIntentType = Literal[
    "answer_from_documents", "summarize_document", "compare_documents", "extract_structured_data"
]


class Citation(BaseModel):
    document_id: str
    chunk_id: str
    content: str


class HistoryExchange(BaseModel):
    query: str
    answer: str


class QueryState(BaseModel):
    query: str
    user_id: str
    # Which documents the user selected in the UI, if any. Required for
    # summarize/compare/extract; ignored by answer_from_documents, which
    # searches across all of the user's documents by similarity instead.
    document_ids: list[str] = []
    # Prior exchanges in this query thread, most recent last - caller
    # (the Next.js proxy) owns the Redis-backed cache this comes from, same
    # cache-aside pattern as the main chat's conversation history.
    history: list[HistoryExchange] = []
    intent: QueryIntentType | None = None
    answer: str = ""
    citations: list[Citation] = []
