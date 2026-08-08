from fastapi import APIRouter, Depends

from app.auth import verify_shared_secret

router = APIRouter()


@router.get("/health", dependencies=[Depends(verify_shared_secret)])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ingestion-agent"}
