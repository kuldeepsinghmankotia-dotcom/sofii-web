import httpx

from app.config import settings

# Mirrors src/lib/groq/client.ts's DEFAULT_GROQ_MODEL - Groq's OpenAI-
# compatible REST API, same reasoning-suppression fields (a reasoning
# model's hidden chain-of-thought otherwise eats the token budget before
# any real content, verified live in the TS client).
GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


async def chat_completion(
    system_prompt: str,
    user_content: str,
    max_tokens: int = 512,
    json_mode: bool = False,
) -> str:
    body: dict = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "reasoning_effort": "low",
        "include_reasoning": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )

    if response.status_code != 200:
        raise RuntimeError(f"Groq chat completion failed with status {response.status_code}: {response.text}")

    data = response.json()
    return data["choices"][0]["message"]["content"].strip()
