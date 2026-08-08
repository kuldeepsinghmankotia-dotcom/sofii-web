from app.clients.gemini_client import embed_texts
from app.graph.state import IngestionState


async def embed_node(state: IngestionState) -> dict:
    embeddings = await embed_texts(state.chunk_texts)
    return {"embeddings": embeddings}
