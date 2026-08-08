import pytest

from app.clients import gemini_client
from app.memory.long_term import extract_memory_candidate


@pytest.fixture(autouse=True)
def restore_generate_text():
    original = gemini_client.generate_text
    yield
    gemini_client.generate_text = original


async def test_returns_none_when_model_says_none() -> None:
    async def fake_generate_text(**kwargs) -> str:
        return "NONE"

    gemini_client.generate_text = fake_generate_text
    assert await extract_memory_candidate("Some document text.") is None


async def test_returns_none_for_empty_reply() -> None:
    async def fake_generate_text(**kwargs) -> str:
        return ""

    gemini_client.generate_text = fake_generate_text
    assert await extract_memory_candidate("Some document text.") is None


async def test_returns_extracted_fact() -> None:
    async def fake_generate_text(**kwargs) -> str:
        return "The user's team ships on a two-week release cadence."

    gemini_client.generate_text = fake_generate_text
    result = await extract_memory_candidate("Our team ships every two weeks.")
    assert result == "The user's team ships on a two-week release cadence."


async def test_truncates_long_text_before_sending() -> None:
    captured = {}

    async def fake_generate_text(*, system_prompt, user_content, max_output_tokens):
        captured["length"] = len(user_content)
        return "NONE"

    gemini_client.generate_text = fake_generate_text
    await extract_memory_candidate("x" * 10_000)
    assert captured["length"] == 4000
