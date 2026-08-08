import io

import pandas as pd
from pydantic import BaseModel, Field

from app.graph.nodes._storage import download_file_bytes
from app.graph.state import IngestionState


class ExtractedCsvResult(BaseModel):
    text: str = Field(min_length=1)


async def extract_csv_node(state: IngestionState) -> dict:
    raw = await download_file_bytes(state)
    text = raw.decode("utf-8", errors="replace").strip()

    # Round-trip through pandas here purely to validate it's real, parseable
    # tabular data before persisting anything - chunk_node re-parses it to
    # do the actual row-grouping/markdown rendering.
    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as exc:
        raise ValueError(f"Could not parse CSV: {exc}") from exc

    if df.empty:
        raise ValueError("CSV has no data rows")

    result = ExtractedCsvResult(text=text)
    return {"extracted_text": result.text, "modality": "tabular"}
