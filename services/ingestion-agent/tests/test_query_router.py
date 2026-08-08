import pytest

from app.clients import groq_client
from app.graph.nodes.query_router import classify_intent


@pytest.fixture(autouse=True)
def restore_chat_completion():
    original = groq_client.chat_completion
    yield
    groq_client.chat_completion = original


async def test_classify_intent_parses_valid_json() -> None:
    async def fake_chat_completion(**kwargs) -> str:
        return '{"intent": "summarize_document"}'

    groq_client.chat_completion = fake_chat_completion
    assert await classify_intent("summarize this") == "summarize_document"


async def test_classify_intent_falls_back_on_malformed_json() -> None:
    async def fake_chat_completion(**kwargs) -> str:
        return "not json at all"

    groq_client.chat_completion = fake_chat_completion
    assert await classify_intent("anything") == "answer_from_documents"


async def test_classify_intent_falls_back_on_invalid_intent_value() -> None:
    async def fake_chat_completion(**kwargs) -> str:
        return '{"intent": "not_a_real_intent"}'

    groq_client.chat_completion = fake_chat_completion
    assert await classify_intent("anything") == "answer_from_documents"
