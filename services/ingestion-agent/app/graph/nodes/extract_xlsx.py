import io

import pandas as pd
from pydantic import BaseModel, Field

from app.graph.nodes._storage import download_file_bytes
from app.graph.state import IngestionState


class ExtractedXlsxResult(BaseModel):
    text: str = Field(min_length=1)


async def extract_xlsx_node(state: IngestionState) -> dict:
    raw = await download_file_bytes(state)

    # First sheet only, matching extract_docx_node's "paragraph text only"
    # style of deliberate phase-scoping - a workbook with data spread
    # across multiple sheets will only surface the first one.
    try:
        df = pd.read_excel(io.BytesIO(raw), sheet_name=0, engine="openpyxl")
    except Exception as exc:
        raise ValueError(f"Could not parse XLSX: {exc}") from exc

    if df.empty:
        raise ValueError("XLSX has no data rows")

    # Converted to CSV text so chunk_node's tabular path (which re-parses
    # extracted_text with pd.read_csv) works completely unchanged - the
    # exact same reasoning extract_csv_node's own comment gives for its
    # pandas round-trip.
    text = df.to_csv(index=False)

    result = ExtractedXlsxResult(text=text)
    return {"extracted_text": result.text, "modality": "tabular"}
