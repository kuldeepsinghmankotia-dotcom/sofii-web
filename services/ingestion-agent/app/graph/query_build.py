from langgraph.graph import END, START, StateGraph

from app.graph.nodes.answer_from_documents import answer_from_documents_node
from app.graph.nodes.compare_documents import compare_documents_node
from app.graph.nodes.extract_structured_data import extract_structured_data_node
from app.graph.nodes.query_router import query_router_node
from app.graph.nodes.summarize_document import summarize_document_node
from app.graph.query_state import QueryState
from app.metrics import timed_node


def _route_by_intent(state: QueryState) -> str:
    return state.intent or "answer_from_documents"


# No checkpointer: unlike ingestion jobs, a query is a single stateless
# request/response - there's nothing to resume.
def build_query_graph():
    graph = StateGraph(QueryState)

    graph.add_node("query_router", timed_node("query_router")(query_router_node))
    graph.add_node(
        "answer_from_documents", timed_node("answer_from_documents")(answer_from_documents_node)
    )
    graph.add_node("summarize_document", timed_node("summarize_document")(summarize_document_node))
    graph.add_node("compare_documents", timed_node("compare_documents")(compare_documents_node))
    graph.add_node(
        "extract_structured_data", timed_node("extract_structured_data")(extract_structured_data_node)
    )

    graph.add_edge(START, "query_router")
    graph.add_conditional_edges(
        "query_router",
        _route_by_intent,
        {
            "answer_from_documents": "answer_from_documents",
            "summarize_document": "summarize_document",
            "compare_documents": "compare_documents",
            "extract_structured_data": "extract_structured_data",
        },
    )
    graph.add_edge("answer_from_documents", END)
    graph.add_edge("summarize_document", END)
    graph.add_edge("compare_documents", END)
    graph.add_edge("extract_structured_data", END)

    return graph.compile()
