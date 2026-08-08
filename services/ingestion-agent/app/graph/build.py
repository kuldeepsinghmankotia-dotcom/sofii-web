from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.chunk import chunk_node
from app.graph.nodes.embed import embed_node
from app.graph.nodes.extract_csv import extract_csv_node
from app.graph.nodes.extract_docx import extract_docx_node
from app.graph.nodes.extract_html import extract_html_node
from app.graph.nodes.extract_text import extract_text_node
from app.graph.nodes.ocr_ensemble import ocr_ensemble_node
from app.graph.nodes.persist import persist_node
from app.graph.nodes.router import router_node
from app.graph.nodes.unsupported_format import unsupported_format_node
from app.graph.nodes.validate_output import validate_output_node
from app.graph.state import IngestionState
from app.memory.long_term import save_document_memory_node
from app.metrics import timed_node


def _route_by_format(state: IngestionState) -> str:
    if state.detected_format == "txt":
        return "extract_text"
    if state.detected_format == "html":
        return "extract_html"
    if state.detected_format == "csv":
        return "extract_csv"
    if state.detected_format == "docx":
        return "extract_docx"
    if state.detected_format == "image":
        return "ocr_ensemble"
    return "unsupported_format"


def build_graph(checkpointer: BaseCheckpointSaver | None = None):
    graph = StateGraph(IngestionState)

    graph.add_node("router", timed_node("router")(router_node))
    graph.add_node("extract_text", timed_node("extract_text")(extract_text_node))
    graph.add_node("extract_html", timed_node("extract_html")(extract_html_node))
    graph.add_node("extract_csv", timed_node("extract_csv")(extract_csv_node))
    graph.add_node("extract_docx", timed_node("extract_docx")(extract_docx_node))
    graph.add_node("ocr_ensemble", timed_node("ocr_ensemble")(ocr_ensemble_node))
    graph.add_node("unsupported_format", timed_node("unsupported_format")(unsupported_format_node))
    graph.add_node("chunk", timed_node("chunk")(chunk_node))
    graph.add_node("embed", timed_node("embed")(embed_node))
    graph.add_node("validate_output", timed_node("validate_output")(validate_output_node))
    graph.add_node("persist", timed_node("persist")(persist_node))
    graph.add_node("save_document_memory", timed_node("save_document_memory")(save_document_memory_node))

    graph.add_edge(START, "router")
    graph.add_conditional_edges(
        "router",
        _route_by_format,
        {
            "extract_text": "extract_text",
            "extract_html": "extract_html",
            "extract_csv": "extract_csv",
            "extract_docx": "extract_docx",
            "ocr_ensemble": "ocr_ensemble",
            "unsupported_format": "unsupported_format",
        },
    )
    graph.add_edge("extract_text", "chunk")
    graph.add_edge("extract_html", "chunk")
    graph.add_edge("extract_csv", "chunk")
    graph.add_edge("extract_docx", "chunk")
    graph.add_edge("ocr_ensemble", "chunk")
    graph.add_edge("unsupported_format", END)
    graph.add_edge("chunk", "embed")
    graph.add_edge("embed", "validate_output")
    graph.add_edge("validate_output", "persist")
    graph.add_edge("persist", "save_document_memory")
    graph.add_edge("save_document_memory", END)

    return graph.compile(checkpointer=checkpointer)
