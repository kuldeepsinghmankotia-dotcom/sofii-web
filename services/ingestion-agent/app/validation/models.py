from typing import Literal

from pydantic import BaseModel


class SourceResult(BaseModel):
    source: str
    text: str | None
    error: str | None = None
    latency_ms: int


class CrossValidationResult(BaseModel):
    agreement_score: float
    status: Literal["agree", "partial_disagreement", "disagreement", "single_source"]
    reconciled_text: str
    sources: list[SourceResult]
    flagged_for_review: bool
