from app.clients.supabase_client import get_supabase
from app.config import settings
from app.graph.state import IngestionState


async def download_file_bytes(state: IngestionState) -> bytes:
    supabase = await get_supabase()
    return await supabase.storage.from_(settings.document_uploads_bucket).download(
        state.storage_path
    )
