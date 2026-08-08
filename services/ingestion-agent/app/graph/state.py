from typing import Literal

from pydantic import BaseModel

DetectedFormat = Literal["txt", "html", "csv", "docx", "pptx", "xlsx", "image", "pdf", "unknown"]
Modality = Literal["prose", "tabular"]


class ChunkCandidate(BaseModel):
    content: str
    embedding: list[float]
    metadata: dict = {}


class IngestionState(BaseModel):
    job_id: str
    storage_path: str
    filename: str
    mime_type: str
    user_id: str
    # Small sniff sample only (first ~16 bytes, base64-encoded - the Redis
    # checkpointer's JSON serialization path rejects raw bytes) for
    # magic-byte detection, never the full file. The checkpointer
    # serializes the whole state on every node transition, so this must
    # stay tiny.
    sample_bytes_b64: str = ""
    detected_format: DetectedFormat | None = None

    extracted_text: str = ""
    modality: Modality = "prose"
    # Populated by ocr_ensemble_node (cross-validation status/score/sources)
    # and merged into every chunk's own metadata by chunk_node - never
    # silently dropped, so a disagreement stays visible on the persisted
    # rows, not just in a log line.
    ocr_metadata: dict = {}
    chunk_texts: list[str] = []
    chunk_metadata: list[dict] = []
    embeddings: list[list[float]] = []
    validated_chunks: list[ChunkCandidate] = []

    document_id: str | None = None
