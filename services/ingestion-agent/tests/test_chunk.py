import pytest

from app.graph.nodes.chunk import chunk_node
from app.graph.state import IngestionState


def make_state(extracted_text: str, modality: str = "prose") -> IngestionState:
    return IngestionState(
        job_id="job-1",
        storage_path="uploads/user-1/file",
        filename="file",
        mime_type="text/plain",
        user_id="user-1",
        extracted_text=extracted_text,
        modality=modality,
    )


def test_chunk_prose_single_short_paragraph() -> None:
    result = chunk_node(make_state("Hello world."))
    assert result["chunk_texts"] == ["Hello world."]
    assert result["chunk_metadata"] == [{}]


def test_chunk_prose_splits_long_text_with_overlap() -> None:
    paragraph = "word " * 400  # ~2000 chars, over CHUNK_SIZE (1500)
    text = f"{paragraph}\n\n{paragraph}"
    result = chunk_node(make_state(text))
    assert len(result["chunk_texts"]) > 1
    assert all(len(c) <= 1500 for c in result["chunk_texts"])


def test_chunk_tabular_groups_rows_into_markdown_tables() -> None:
    header = "name,age"
    rows = "\n".join(f"person{i},{i}" for i in range(120))
    csv_text = f"{header}\n{rows}"

    result = chunk_node(make_state(csv_text, modality="tabular"))

    # 120 rows / 50 per chunk -> 3 chunks
    assert len(result["chunk_texts"]) == 3
    assert result["chunk_metadata"][0] == {"row_start": 0, "row_end": 49}
    assert result["chunk_metadata"][1] == {"row_start": 50, "row_end": 99}
    assert result["chunk_metadata"][2] == {"row_start": 100, "row_end": 119}
    assert "name" in result["chunk_texts"][0]
    assert "person0" in result["chunk_texts"][0]


def test_chunk_raises_on_empty_text() -> None:
    with pytest.raises(ValueError, match="no chunks"):
        chunk_node(make_state(""))
