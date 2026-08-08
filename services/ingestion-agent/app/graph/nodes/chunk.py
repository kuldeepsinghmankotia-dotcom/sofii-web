import io
import re

import pandas as pd

from app.graph.state import IngestionState

# Mirrors src/lib/pdf/chunk.ts exactly (same size/overlap) so prose chunks
# from either pipeline behave the same for retrieval.
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200

ROWS_PER_CHUNK = 50


def _chunk_prose(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > CHUNK_SIZE:
            chunks.append(current)
            overlap_start = max(0, len(current) - CHUNK_OVERLAP)
            current = current[overlap_start:]
        current = f"{current}\n\n{paragraph}" if current else paragraph

        while len(current) > CHUNK_SIZE:
            chunks.append(current[:CHUNK_SIZE])
            current = current[CHUNK_SIZE - CHUNK_OVERLAP :]

    if current.strip():
        chunks.append(current)

    return chunks


def _chunk_tabular(text: str) -> tuple[list[str], list[dict]]:
    df = pd.read_csv(io.StringIO(text))

    chunks: list[str] = []
    metadata: list[dict] = []

    for start in range(0, len(df), ROWS_PER_CHUNK):
        group = df.iloc[start : start + ROWS_PER_CHUNK]
        chunks.append(group.to_markdown(index=False))
        metadata.append({"row_start": int(start), "row_end": int(start + len(group) - 1)})

    return chunks, metadata


def chunk_node(state: IngestionState) -> dict:
    if state.modality == "tabular":
        chunks, metadata = _chunk_tabular(state.extracted_text)
    else:
        chunks = _chunk_prose(state.extracted_text)
        metadata = [{} for _ in chunks]

    if not chunks:
        raise ValueError("Chunking produced no chunks")

    if state.ocr_metadata:
        metadata = [{**m, **state.ocr_metadata} for m in metadata]

    return {"chunk_texts": chunks, "chunk_metadata": metadata}
