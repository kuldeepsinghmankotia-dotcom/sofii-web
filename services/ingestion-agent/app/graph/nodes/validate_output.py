from pydantic import BaseModel, Field, field_validator

from app.graph.state import ChunkCandidate, IngestionState

EMBEDDING_DIM = 768


class IngestionResult(BaseModel):
    # min_length=1 here is the final-output gate: nothing gets persisted
    # unless there's at least one validated chunk.
    chunks: list[ChunkCandidate] = Field(min_length=1)

    @field_validator("chunks")
    @classmethod
    def check_embedding_dims(cls, chunks: list[ChunkCandidate]) -> list[ChunkCandidate]:
        for chunk in chunks:
            if len(chunk.embedding) != EMBEDDING_DIM:
                raise ValueError(
                    f"Chunk embedding has {len(chunk.embedding)} dims, expected {EMBEDDING_DIM}"
                )
        return chunks


def validate_output_node(state: IngestionState) -> dict:
    if len(state.chunk_texts) != len(state.embeddings):
        raise ValueError(
            f"Mismatched chunk/embedding counts: {len(state.chunk_texts)} chunks vs "
            f"{len(state.embeddings)} embeddings"
        )

    candidates = [
        ChunkCandidate(content=text, embedding=embedding, metadata=meta)
        for text, embedding, meta in zip(
            state.chunk_texts, state.embeddings, state.chunk_metadata, strict=True
        )
    ]

    result = IngestionResult(chunks=candidates)
    return {"validated_chunks": result.chunks}
