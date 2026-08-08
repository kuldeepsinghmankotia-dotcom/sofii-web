import logging

from app.clients import gemini_client
from app.clients.supabase_client import get_supabase
from app.graph.state import IngestionState

logger = logging.getLogger("ingestion_agent.memory")

# Mirrors the intent of src/lib/memory/extract.ts's extractMemoryCandidate,
# adapted for ingested document content rather than a chat exchange.
EXTRACT_SYSTEM_PROMPT = """You are looking at content extracted from a document a user just uploaded, searching for one durable fact worth remembering long-term about the user or their work (preferences, ongoing projects, important identifiers, relationships, recurring context) — the kind of thing worth recalling in a future, unrelated conversation.

Rules:
- Reply with exactly one short standalone sentence stating the new fact, OR the single word NONE.
- Only extract something genuinely durable and specific. Skip generic or throwaway content.
- Never invent details not actually present in the text.
- NONE is the right answer far more often than not — most documents contain nothing worth remembering as a standalone fact."""

# Caps prompt size/cost - a durable fact worth remembering is almost always
# stated plainly near the start of a document, not buried past this point.
MAX_TEXT_CHARS = 4000


async def extract_memory_candidate(text: str) -> str | None:
    reply = await gemini_client.generate_text(
        system_prompt=EXTRACT_SYSTEM_PROMPT,
        user_content=text[:MAX_TEXT_CHARS],
        max_output_tokens=150,
    )
    if not reply or reply.upper() == "NONE":
        return None
    return reply


# Wired as the graph's final node (after persist). Fire-and-forget in
# spirit: any failure here is logged, never raised, so a memory-extraction
# hiccup can't fail an otherwise-successful ingestion job.
async def save_document_memory_node(state: IngestionState) -> dict:
    try:
        fact = await extract_memory_candidate(state.extracted_text)
        if fact is None:
            return {}

        supabase = await get_supabase()
        await supabase.table("memories").insert(
            {"user_id": state.user_id, "content": fact, "source": "document"}
        ).execute()
        logger.info("saved document memory", extra={"job_id": state.job_id})
    except Exception:
        logger.exception("document memory extraction failed", extra={"job_id": state.job_id})

    return {}
