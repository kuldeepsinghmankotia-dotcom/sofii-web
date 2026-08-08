from fastapi import APIRouter, Depends, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.auth import verify_shared_secret

router = APIRouter()


@router.get("/metrics", dependencies=[Depends(verify_shared_secret)])
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
