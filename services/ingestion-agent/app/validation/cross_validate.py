from difflib import SequenceMatcher

from app.validation.models import CrossValidationResult, SourceResult


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def cross_validate(
    sources: list[SourceResult],
    agree_threshold: float = 0.90,
    partial_threshold: float = 0.70,
) -> CrossValidationResult:
    ok_sources = [s for s in sources if s.text]

    if not ok_sources:
        raise ValueError(
            f"All {len(sources)} OCR source(s) failed: "
            f"{'; '.join(f'{s.source}: {s.error}' for s in sources)}"
        )

    if len(ok_sources) == 1:
        return CrossValidationResult(
            agreement_score=0.0,
            status="single_source",
            reconciled_text=ok_sources[0].text or "",
            sources=sources,
            flagged_for_review=True,
        )

    # Exactly two sources today (Gemini + Ollama) - compares the first two
    # that actually returned text. Gemini's result wins ties/disagreements
    # since it's the more reliable of the two ensemble members; disagreement
    # is still surfaced via flagged_for_review rather than silently resolved.
    primary = next((s for s in ok_sources if s.source == "gemini"), ok_sources[0])
    other = next((s for s in ok_sources if s is not primary), ok_sources[1])

    score = _similarity(primary.text or "", other.text or "")

    if score >= agree_threshold:
        status = "agree"
        # Longer text is treated as more complete when they substantially agree.
        reconciled = primary.text if len(primary.text or "") >= len(other.text or "") else other.text
        flagged = False
    elif score >= partial_threshold:
        status = "partial_disagreement"
        reconciled = primary.text
        flagged = True
    else:
        status = "disagreement"
        reconciled = primary.text
        flagged = True

    return CrossValidationResult(
        agreement_score=score,
        status=status,
        reconciled_text=reconciled or "",
        sources=sources,
        flagged_for_review=flagged,
    )
