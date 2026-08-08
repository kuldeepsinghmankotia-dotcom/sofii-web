from app.graph.state import IngestionState

_MESSAGES = {
    "pdf": "PDF uploads go through the existing PDF pipeline (Documents page), not this service.",
    "unknown": "Could not determine this file's format.",
}


def unsupported_format_node(state: IngestionState) -> dict:
    detail = _MESSAGES.get(state.detected_format or "unknown", "Unsupported file format.")
    raise ValueError(f"Unsupported format '{state.detected_format}': {detail}")
