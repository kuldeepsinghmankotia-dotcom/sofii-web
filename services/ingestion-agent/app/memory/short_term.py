import hashlib

from app.clients.redis_client import get_redis

TTL_SECONDS = 60 * 60


def _cache_key(image_bytes: bytes, model: str) -> str:
    digest = hashlib.sha256(image_bytes).hexdigest()
    return f"ocr:{digest}:{model}"


async def get_cached_ocr(image_bytes: bytes, model: str) -> str | None:
    redis_client = get_redis()
    return await redis_client.get(_cache_key(image_bytes, model))


async def set_cached_ocr(image_bytes: bytes, model: str, text: str) -> None:
    redis_client = get_redis()
    await redis_client.set(_cache_key(image_bytes, model), text, ex=TTL_SECONDS)
