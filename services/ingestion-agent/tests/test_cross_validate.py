import pytest

from app.validation.cross_validate import cross_validate
from app.validation.models import SourceResult


def make_source(source: str, text: str | None, error: str | None = None) -> SourceResult:
    return SourceResult(source=source, text=text, error=error, latency_ms=100)


def test_agree_when_texts_are_nearly_identical() -> None:
    result = cross_validate(
        [
            make_source("gemini", "The invoice total is $1,234.56."),
            make_source("ollama", "The invoice total is $1,234.56"),
        ]
    )
    assert result.status == "agree"
    assert result.flagged_for_review is False
    assert result.agreement_score >= 0.90


def test_partial_disagreement_flags_but_uses_gemini() -> None:
    result = cross_validate(
        [
            make_source("gemini", "The quick brown fox jumps over the lazy dog today."),
            make_source("ollama", "The quick brown fox jumped over a lazy dog yesterday!"),
        ]
    )
    assert result.status in ("partial_disagreement", "disagreement")
    assert result.flagged_for_review is True
    assert result.reconciled_text == "The quick brown fox jumps over the lazy dog today."


def test_full_disagreement_flags_and_uses_gemini() -> None:
    result = cross_validate(
        [
            make_source("gemini", "Completely unrelated content about cats."),
            make_source("ollama", "Totally different text discussing quarterly finance reports."),
        ]
    )
    assert result.status == "disagreement"
    assert result.flagged_for_review is True
    assert result.reconciled_text == "Completely unrelated content about cats."


def test_single_source_when_one_fails() -> None:
    result = cross_validate(
        [
            make_source("gemini", "Recovered text from the working source."),
            make_source("ollama", None, error="connection refused"),
        ]
    )
    assert result.status == "single_source"
    assert result.flagged_for_review is True
    assert result.reconciled_text == "Recovered text from the working source."
    assert result.agreement_score == 0.0


def test_raises_when_all_sources_fail() -> None:
    with pytest.raises(ValueError, match="All 2"):
        cross_validate(
            [
                make_source("gemini", None, error="timeout"),
                make_source("ollama", None, error="connection refused"),
            ]
        )
