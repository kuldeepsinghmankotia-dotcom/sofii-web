import io

from docx import Document
from pydantic import BaseModel, Field

from app.graph.nodes._storage import download_file_bytes
from app.graph.state import IngestionState


class ExtractedTextResult(BaseModel):
    text: str = Field(min_length=1)


async def extract_docx_node(state: IngestionState) -> dict:
    raw = await download_file_bytes(state)
    document = Document(io.BytesIO(raw))
    # Paragraph text only, matching this phase's scope — table cells aren't
    # walked separately, so a .docx that's mostly tables will extract thin.
    paragraphs = [p.text.strip() for p in document.paragraphs if p.text.strip()]
    text = "\n\n".join(paragraphs)

    result = ExtractedTextResult(text=text)
    return {"extracted_text": result.text, "modality": "prose"}
