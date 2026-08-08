import hmac

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

bearer_scheme = HTTPBearer(auto_error=False)


def verify_shared_secret(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> None:
    if credentials is None or not hmac.compare_digest(
        credentials.credentials, settings.ingest_service_secret
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing credentials")
