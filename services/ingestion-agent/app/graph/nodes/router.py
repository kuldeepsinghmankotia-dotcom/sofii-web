import base64

from app.graph.state import DetectedFormat, IngestionState

_MAGIC_BYTES: list[tuple[bytes, DetectedFormat]] = [
    (b"%PDF", "pdf"),
    (b"\xff\xd8\xff", "image"),  # jpeg
    (b"\x89PNG\r\n\x1a\n", "image"),
    (b"GIF87a", "image"),
    (b"GIF89a", "image"),
    (b"RIFF", "image"),  # webp container (RIFF....WEBP)
    (b"PK\x03\x04", "docx"),  # zip-based office doc; mime type disambiguates from xlsx/pptx
]

_MIME_FORMAT: dict[str, DetectedFormat] = {
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
    "application/csv": "csv",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "image/jpeg": "image",
    "image/png": "image",
    "image/gif": "image",
    "image/webp": "image",
}


def _sniff_format(sample: bytes) -> DetectedFormat | None:
    for magic, fmt in _MAGIC_BYTES:
        if sample.startswith(magic):
            return fmt
    return None


def router_node(state: IngestionState) -> dict[str, DetectedFormat]:
    # mime_type (set by the uploader) is the primary signal; the magic-byte
    # sniff is a fallback for when it's missing/generic
    # (application/octet-stream, etc.), not an override.
    sample = base64.b64decode(state.sample_bytes_b64) if state.sample_bytes_b64 else b""
    detected = (
        _MIME_FORMAT.get(state.mime_type.lower()) or _sniff_format(sample) or "unknown"
    )
    return {"detected_format": detected}
