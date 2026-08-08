import base64

import httpx

from app.config import settings
from app.clients.gemini_client import OCR_PROMPT


async def vision_ocr(image_bytes: bytes, mime_type: str) -> str:  # noqa: ARG001 - kept for signature parity with gemini_client.vision_ocr
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/generate",
            json={
                "model": settings.ollama_vision_model,
                "prompt": OCR_PROMPT,
                "images": [base64.b64encode(image_bytes).decode()],
                "stream": False,
                "options": {"temperature": 0.0},
            },
        )

    if response.status_code != 200:
        raise RuntimeError(f"Ollama generate (vision) failed with status {response.status_code}: {response.text}")

    data = response.json()
    text = data.get("response", "").strip()

    if not text or text == "NO_TEXT_FOUND":
        raise ValueError("Ollama found no legible text in the image")

    return text
