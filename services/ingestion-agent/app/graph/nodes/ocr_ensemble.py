import asyncio
import time

from app.clients import gemini_client, ollama_client
from app.config import settings
from app.graph.nodes._storage import download_file_bytes
from app.graph.nodes.extract_text import ExtractedTextResult
from app.graph.state import IngestionState
from app.memory.short_term import get_cached_ocr, set_cached_ocr
from app.metrics import ocr_cross_validation_total
from app.validation.cross_validate import cross_validate
from app.validation.models import SourceResult


async def _run_source(source: str, model: str, run) -> SourceResult:
    start = time.perf_counter()
    try:
        text = await run()
        return SourceResult(
            source=source, text=text, latency_ms=int((time.perf_counter() - start) * 1000)
        )
    except Exception as exc:
        return SourceResult(
            source=source,
            text=None,
            error=str(exc),
            latency_ms=int((time.perf_counter() - start) * 1000),
        )


async def _gemini_with_cache(image_bytes: bytes, mime_type: str) -> str:
    cached = await get_cached_ocr(image_bytes, gemini_client.VISION_MODEL)
    if cached is not None:
        return cached
    text = await gemini_client.vision_ocr(image_bytes, mime_type)
    await set_cached_ocr(image_bytes, gemini_client.VISION_MODEL, text)
    return text


async def _ollama_with_cache(image_bytes: bytes, mime_type: str) -> str:
    cached = await get_cached_ocr(image_bytes, settings.ollama_vision_model)
    if cached is not None:
        return cached
    text = await ollama_client.vision_ocr(image_bytes, mime_type)
    await set_cached_ocr(image_bytes, settings.ollama_vision_model, text)
    return text


async def ocr_ensemble_node(state: IngestionState) -> dict:
    image_bytes = await download_file_bytes(state)

    gemini_result, ollama_result = await asyncio.gather(
        _run_source(
            "gemini", gemini_client.VISION_MODEL, lambda: _gemini_with_cache(image_bytes, state.mime_type)
        ),
        _run_source(
            "ollama",
            settings.ollama_vision_model,
            lambda: _ollama_with_cache(image_bytes, state.mime_type),
        ),
    )

    validation = cross_validate([gemini_result, ollama_result])
    ocr_cross_validation_total.labels(status=validation.status).inc()
    result = ExtractedTextResult(text=validation.reconciled_text)

    return {
        "extracted_text": result.text,
        "modality": "prose",
        "ocr_metadata": {
            "ocr_status": validation.status,
            "ocr_agreement_score": validation.agreement_score,
            "ocr_flagged_for_review": validation.flagged_for_review,
            "ocr_sources": [s.model_dump() for s in validation.sources],
        },
    }
