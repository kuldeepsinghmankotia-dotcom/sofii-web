import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import verify_shared_secret
from app.graph.query_build import build_query_graph
from app.graph.query_state import Citation, HistoryExchange, QueryState
from app.metrics import query_requests_total

logger = logging.getLogger("ingestion_agent.query")

router = APIRouter()


class QueryRequest(BaseModel):
    query: str
    user_id: str
    document_ids: list[str] = []
    history: list[HistoryExchange] = []


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
    )
    result = await graph.ainvoke(state)
    intent = result.get("intent") or "answer_from_documents"
    query_requests_total.labels(intent=intent).inc()
    logger.info(
        "query handled",
        extra={"user_id": payload.user_id, "intent": intent},
    )
    return QueryResponse(intent=intent, answer=result["answer"], citations=result["citations"])
