import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import verify_shared_secret
from app.graph.query_build import build_query_graph
from app.graph.query_state import Citation, HistoryExchange, QueryIntentType, QueryState
from app.metrics import query_requests_total

logger = logging.getLogger("ingestion_agent.query")

router = APIRouter()


class QueryRequest(BaseModel):
    query: str
    user_id: str
    document_ids: list[str] = []
    history: list[HistoryExchange] = []
    # Set by callers that already know the intent (e.g. main chat's
    # document tools) to skip the LLM classification step entirely. Left
    # unset for the standalone Ask Documents UI, which still wants the
    # router to classify freeform questions.
    intent: QueryIntentType | None = None


class QueryResponse(BaseModel):
    intent: str
    answer: str
    citations: list[Citation]


@router.post("/query", dependencies=[Depends(verify_shared_secret)])
async def query(payload: QueryRequest) -> QueryResponse:
    graph = build_query_graph()
    state = QueryState(
        query=payload.query,
        user_id=payload.user_id,
        document_ids=payload.document_ids,
        history=payload.history,
        intent=payload.intent,
    )
    result = await graph.ainvoke(state)
    intent = result.get("intent") or "answer_from_documents"
    query_requests_total.labels(intent=intent).inc()
    logger.info(
        "query handled",
        extra={"user_id": payload.user_id, "intent": intent},
    )
    return QueryResponse(intent=intent, answer=result["answer"], citations=result["citations"])
