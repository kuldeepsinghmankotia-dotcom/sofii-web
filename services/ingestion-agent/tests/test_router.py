import base64

import pytest

from app.graph.nodes.router import router_node
from app.graph.state import IngestionState


def make_state(mime_type: str, sample_bytes: bytes = b"") -> IngestionState:
    return IngestionState(
        job_id="job-1",
        storage_path="uploads/user-1/file",
        filename="file",
        mime_type=mime_type,
        user_id="user-1",
        sample_bytes_b64=base64.b64encode(sample_bytes).decode() if sample_bytes else "",
    )


@pytest.mark.parametrize(
    ("mime_type", "expected"),
    [
        ("text/plain", "txt"),
        ("text/html", "html"),
        ("text/csv", "csv"),
        ("application/csv", "csv"),
        ("application/pdf", "pdf"),
        (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx",
        ),
        ("image/jpeg", "image"),
        ("image/png", "image"),
        ("image/gif", "image"),
        ("image/webp", "image"),
    ],
)
def test_router_classifies_by_mime_type(mime_type: str, expected: str) -> None:
    result = router_node(make_state(mime_type))
    assert result == {"detected_format": expected}


@pytest.mark.parametrize(
    ("sample_bytes", "expected"),
    [
        (b"%PDF-1.7\n...", "pdf"),
        (b"\xff\xd8\xff\xe0\x00\x10JFIF", "image"),
        (b"\x89PNG\r\n\x1a\n\x00\x00", "image"),
        (b"GIF89a\x01\x00", "image"),
        (b"PK\x03\x04\x14\x00\x00\x00", "docx"),
    ],
)
def test_router_falls_back_to_magic_bytes_when_mime_is_generic(
    sample_bytes: bytes, expected: str
) -> None:
    result = router_node(make_state("application/octet-stream", sample_bytes))
    assert result == {"detected_format": expected}


def test_router_mime_type_takes_priority_over_magic_bytes() -> None:
    # A .txt upload whose first bytes happen to look PDF-like should still
    # be classified from the mime type, not the sniff.
    result = router_node(make_state("text/plain", b"%PDF-not-really"))
    assert result == {"detected_format": "txt"}


def test_router_unknown_when_neither_signal_matches() -> None:
    result = router_node(make_state("application/octet-stream", b"\x00\x01\x02"))
    assert result == {"detected_format": "unknown"}
