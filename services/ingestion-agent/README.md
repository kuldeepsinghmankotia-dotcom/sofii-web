# Sofii ingestion agent

Python/FastAPI + LangGraph service that ingests multi-modal documents
(`.txt`/`.html`/`.csv`/`.docx`/images) and answers questions about them via
a separate query-time agent layer. See `docs/plans/agentic-ingestion-plan.md`
at the repo root for the full phased plan and what's been verified at each
phase — all 10 phases are done as of this writing.

## Dependencies

- Python 3.12+ (`brew install python@3.12`) and [`uv`](https://github.com/astral-sh/uv) (`brew install uv`)
- Docker, for Redis: `docker run -d --name sofii-ingestion-redis -p 6379:6379 redis/redis-stack-server:latest`
  (**not** plain `redis:7-alpine` — the LangGraph checkpointer needs the
  RediSearch module bundled in `redis-stack-server`)
- [Ollama](https://ollama.com) for local OCR: `brew install --cask ollama`,
  then `ollama serve` and `ollama pull qwen2.5vl:7b` (~6GB download)

## Local setup

```bash
cd services/ingestion-agent
uv sync
cp .env.example .env   # then fill in every value - see .env.example's comments
```

## Run

```bash
.venv/bin/uvicorn app.main:app --port 8000
```

## Expose to the internet (Cloudflare Tunnel)

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

This prints a `https://<random>.trycloudflare.com` URL. It's a free
"quick tunnel" — no Cloudflare account needed, but the URL changes every
time you restart `cloudflared`, and Cloudflare gives no uptime guarantee
for it. For a long-lived setup (a stable URL that doesn't need updating
in Vercel every restart), switch to a named tunnel tied to a Cloudflare
account + domain: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps

Whatever URL you get, set it as `INGEST_SERVICE_URL` in the Next.js app's
`.env.local` (local dev) or Vercel project env vars (production) — and
make sure `INGEST_SERVICE_SECRET` matches exactly between this service's
`.env` and the Next.js app's env.

## Test

```bash
curl -H "Authorization: Bearer $INGEST_SERVICE_SECRET" http://localhost:8000/health
```

Should return `{"status":"ok","service":"ingestion-agent"}`. Without the
header (or with the wrong secret) it returns 401.

### Automated tests

```bash
.venv/bin/pytest -q
```

Requires local Supabase (`supabase start`) and Redis running — most tests
are pure unit tests, but `tests/test_e2e_ingestion.py` is a real
end-to-end test: it creates a throwaway `auth.users` row via the admin
API, uploads a real file to Storage, runs the actual compiled graph, and
asserts on the real `documents`/`document_chunks` rows produced, then
deletes the user (cascades cleanup).

## Monitoring

`GET /metrics` (shared-secret protected, same as every other endpoint)
exposes Prometheus-format metrics: `ingestion_jobs_total{status}`,
`ocr_cross_validation_total{status}`, `query_requests_total{intent}`,
`node_duration_seconds{node}`. No Prometheus server or Grafana dashboard
is set up here — that's optional infrastructure left for you to decide
on; this just makes the data available in a standard, scrapeable format.
Every graph node also emits a structured JSON log line
(`"node executed"` / `"node failed"`) with `duration_ms`, regardless of
whether you're scraping metrics.

## OCR latency (why ingestion is async, not request/response)

Measured locally (Apple Silicon Mac, `qwen2.5vl:7b`), uncached, real
images:

| Source | Latency |
|---|---|
| Gemini vision (`gemini-flash-latest`) | ~1–4s when not rate-limited |
| Ollama vision (`qwen2.5vl:7b`, local inference) | **32–41s** |

Ollama's local inference is the bottleneck by a wide margin, and it's
squarely why Phase 4's async-job-plus-polling design (rather than a
synchronous request/response) isn't just defensive — a real HTTP request
held open for 30-40+ seconds would time out or feel broken well before
that. The short-term Redis cache (`ocr:{sha256}:{model}`, 1h TTL) makes
repeat requests against the same image near-instant, but the first request
against any new image pays this cost.

Also worth knowing: Gemini's free tier caps `generateContent` at
**20 requests/day**, shared across OCR vision calls *and* the text
generation used for memory extraction (Phase 7) and query-intent
classification originally would have used it too, before that was moved
to Groq specifically because of this limit (see Phase 8 in the plan doc).
Expect to hit this quota during any extended local testing session; the
system is designed to degrade gracefully when it does (falls back to
Ollama alone for OCR, logs and skips memory extraction) rather than fail.
