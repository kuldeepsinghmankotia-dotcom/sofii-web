import pytest
from pydantic import ValidationError

from app.graph.nodes.validate_output import validate_output_node
from app.graph.state import IngestionState


def make_state(chunk_texts: list[str], embeddings: list[list[float]]) -> IngestionState:
    return IngestionState(
        job_id="job-1",
        storage_path="uploads/user-1/file",
        filename="file",
        mime_type="text/plain",
        user_id="user-1",
        chunk_texts=chunk_texts,
        chunk_metadata=[{} for _ in chunk_texts],
        embeddings=embeddings,
    )


def test_validate_output_accepts_well_formed_chunks() -> None:
    state = make_state(["hello", "world"], [[0.1] * 768, [0.2] * 768])
    result = validate_output_node(state)
    assert len(result["validated_chunks"]) == 2
    assert result["validated_chunks"][0].content == "hello"


def test_validate_output_rejects_wrong_embedding_dimension() -> None:
    state = make_state(["hello"], [[0.1] * 10])
    with pytest.raises(ValidationError, match="768"):
        validate_output_node(state)


def test_validate_output_rejects_mismatched_counts() -> None:
    state = make_state(["hello", "world"], [[0.1] * 768])
    with pytest.raises(ValueError, match="Mismatched"):
        validate_output_node(state)


def test_validate_output_rejects_empty_chunk_list() -> None:
    state = make_state([], [])
    with pytest.raises(ValidationError):
        validate_output_node(state)
