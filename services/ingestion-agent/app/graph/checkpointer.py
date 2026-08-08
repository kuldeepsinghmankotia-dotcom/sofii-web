from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langgraph.checkpoint.redis import AsyncRedisSaver


@asynccontextmanager
async def redis_checkpointer(redis_url: str) -> AsyncIterator[AsyncRedisSaver]:
    async with AsyncRedisSaver.from_conn_string(redis_url) as saver:
        await saver.asetup()
        yield saver


def job_thread_config(job_id: str) -> dict:
    return {"configurable": {"thread_id": job_id}}
