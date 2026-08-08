from pydantic import BaseModel, Field

from app.graph.nodes._storage import download_file_bytes
from app.graph.state import IngestionState


class ExtractedTextResult(BaseModel):
    # min_length=1 is the node-level validation gate: an empty extraction
    # raises here rather than silently persisting an unsearchable document.
    text: str = Field(min_length=1)


async def extract_text_node(state: IngestionState) -> dict:
    raw = await download_file_bytes(state)
    text = raw.decode("utf-8", errors="replace").strip()
    result = ExtractedTextResult(text=text)
    return {"extracted_text": result.text, "modality": "prose"}
