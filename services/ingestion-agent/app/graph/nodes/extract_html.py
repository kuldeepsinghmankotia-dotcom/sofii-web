from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from app.graph.nodes._storage import download_file_bytes
from app.graph.state import IngestionState


class ExtractedTextResult(BaseModel):
    text: str = Field(min_length=1)


async def extract_html_node(state: IngestionState) -> dict:
    raw = await download_file_bytes(state)
    soup = BeautifulSoup(raw.decode("utf-8", errors="replace"), "lxml")

    for tag in soup(["script", "style"]):
        tag.decompose()

    text = soup.get_text(separator="\n").strip()
    # Collapse the blank-line runs BeautifulSoup's block-tag separators leave behind.
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())

    result = ExtractedTextResult(text=text)
    return {"extracted_text": result.text, "modality": "prose"}
