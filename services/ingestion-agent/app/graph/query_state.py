from typing import Literal

from pydantic import BaseModel

QueryIntentType = Literal[
    "answer_from_documents", "summarize_document", "compare_documents", "extract_structured_data"
]


class Citation(BaseModel):
    document_id: str
    chunk_id: str
    content: str


class QueryState(BaseModel):
    query: str
    user_id: str
    # Which documents the user selected in the UI, if any. Required for
    # summarize/compare/extract; ignored by answer_from_documents, which
    # searches across all of the user's documents by similarity instead.
    document_ids: list[str] = []
    intent: QueryIntentType | None = None
    answer: str = ""
    citations: list[Citation] = []
