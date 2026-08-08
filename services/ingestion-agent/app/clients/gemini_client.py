import base64

import httpx

from app.config import settings

# Mirrors src/lib/gemini/embeddings.ts exactly (same model, same truncated
# dimensionality) so chunks written by this service land in the same
# 768-dim space as the existing TS PDF pipeline's chunks - retrieval must
# not care which pipeline created a given row.
EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
BATCH_SIZE = 100

# Same alias src/lib/gemini/chat.ts uses for chat - Google's always-current
# pointer, resolves to gemini-3.6-flash as of this writing. Vision-capable.
VISION_MODEL = "gemini-flash-latest"

OCR_PROMPT = (
    "Transcribe all visible text in this image exactly as it appears, "
    "preserving line breaks and structure. Output only the transcribed "
    "text, no commentary. If there is no legible text, output exactly: "
    "NO_TEXT_FOUND"
)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    results: list[list[float]] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/{EMBEDDING_MODEL}:batchEmbedContents",
                headers={
                    "x-goog-api-key": settings.gemini_api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "requests": [
                        {
                            "model": EMBEDDING_MODEL,
                            "content": {"parts": [{"text": text}]},
                            "outputDimensionality": EMBEDDING_DIMENSIONS,
                        }
                        for text in batch
                    ]
                },
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"Gemini batchEmbedContents failed with status {response.status_code}: {response.text}"
                )
            data = response.json()
            results.extend(embedding["values"] for embedding in data["embeddings"])

    return results


async def vision_ocr(image_bytes: bytes, mime_type: str) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent",
            headers={
                "x-goog-api-key": settings.gemini_api_key,
                "Content-Type": "application/json",
            },
            json={
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": OCR_PROMPT},
                            {
                                "inlineData": {
                                    "mimeType": mime_type,
                                    "data": base64.b64encode(image_bytes).decode(),
                                }
                            },
                        ],
                    }
                ],
                "generationConfig": {"temperature": 0.0, "maxOutputTokens": 2048},
            },
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Gemini generateContent (vision) failed with status {response.status_code}: {response.text}"
        )

    data = response.json()
    parts = data["candidates"][0]["content"]["parts"]
    text = "".join(part.get("text", "") for part in parts).strip()

    if text == "NO_TEXT_FOUND":
        raise ValueError("Gemini found no legible text in the image")

    return text


async def generate_text(system_prompt: str, user_content: str, max_output_tokens: int = 150) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent",
            headers={
                "x-goog-api-key": settings.gemini_api_key,
                "Content-Type": "application/json",
            },
            json={
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_content}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_output_tokens},
            },
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Gemini generateContent (text) failed with status {response.status_code}: {response.text}"
        )

    data = response.json()
    parts = data["candidates"][0]["content"]["parts"]
    return "".join(part.get("text", "") for part in parts).strip()
