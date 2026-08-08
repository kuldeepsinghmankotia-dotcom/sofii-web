from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ingest_service_secret: str
    log_level: str = "INFO"
    redis_url: str = "redis://127.0.0.1:6379"

    supabase_url: str
    supabase_service_role_key: str
    gemini_api_key: str
    groq_api_key: str
    document_uploads_bucket: str = "document-uploads"

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_vision_model: str = "qwen2.5vl:7b"


settings = Settings()
