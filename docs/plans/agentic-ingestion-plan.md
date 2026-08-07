# Multi-modal agentic ingestion system (Python + LangGraph)

> **Status**: Phase 1 (admin-editable system prompt) is done, verified
> end-to-end, and deployed to production. Phases 2–8 (the Python/LangGraph
> service, Redis, OCR ensemble, etc.) are not started. Update this line as
> phases land — this file doesn't auto-track progress.

## Context

The user wants Sofii to ingest multiple data modalities (numbers, text,
images, tabular data) across multiple file formats (PDF, Word, .txt, HTML,
etc.), routed through a query router into different agentic flows built
with real Python LangGraph, validated with Pydantic at every node and at
final output, with a multi-source cross-validation pattern, Redis-backed
short-term/node memory, long-term memory and vector storage reusing the
existing Supabase Postgres/pgvector setup, an ensemble of Gemini + a
self-hosted Ollama for OCR/document-intelligence, and an admin UI to edit
the system prompt directly. This is **additive** — the existing Groq/Gemini
chat and PDF pipeline keep working unchanged.

Key decisions already confirmed directly with the user (do not re-litigate):
- **Real Python LangGraph** (not the JS port) — a new Python service, not
  an extension of the existing TypeScript app.
- **Reuse existing Supabase pgvector** (`document_chunks` table, already
  has an HNSW index and a `match_document_chunks` RPC, already used by the
  existing PDF pipeline) — no Pinecone/Qdrant/Weaviate.
- **OCR ensemble**: Gemini (already integrated, reuses `GEMINI_API_KEY`) +
  Ollama, cross-validated against each other (multi-source agreement
  check — disagreements get flagged, never silently resolved).
- **Ollama + the new Python/LangGraph service both run on the user's own
  Mac** (macOS, Apple Silicon), colocated behind one Cloudflare Tunnel —
  confirmed over a separate always-on cloud host, accepting the trade-off
  that ingestion availability is tied to that Mac being on.
- **Vision model**: swappable via an `OLLAMA_VISION_MODEL` env var (exact
  RAM wasn't given, so this stays a runtime choice, not hardcoded) —
  `qwen2.5vl:7b` recommended default (best open OCR quality/size
  trade-off; needs ~8GB+ unified memory, comfortable on most Apple
  Silicon Macs), `moondream:1.8b` as a safe fallback on lower-memory
  machines, `llama3.2-vision:11b` as a heavier middle option.
- **Admin bootstrap**: a migration seeds `role = 'admin'` for
  `amit21aim@gmail.com` directly — confirmed acceptable for this
  single-admin personal app.
- **PDF stays on the existing TypeScript path** — the Python service
  handles only the new formats (docx/txt/html/csv/image). Both paths write
  to the same `document_chunks` schema and use the same embedding
  model/dimensions (Gemini `gemini-embedding-001`, 768-dim), so retrieval
  is unified regardless of which pipeline created a chunk.
- **Async ingestion**: new `ingestion_jobs` table + client-side polling
  (matches this repo's existing lightweight-polling style, e.g.
  `reminder-poller.tsx`) — no Supabase Realtime, no new cron (Hobby plan's
  cron is already at its one-per-day limit from this session's earlier
  work; a stuck-job timeout is handled lazily on page load instead).

**Before starting this**: there's a small amount of already-approved,
in-flight work from the previous session plan (shareable read-only
conversation links) that's implemented but not yet fully wired up in the
UI or committed — finish that first (it's minutes of work, already 90%
done: migration applied, backend routes written, just needs the dropdown
UI + verification), then start this plan's Phase 1.

## High-level architecture

```
Browser ── existing Supabase-cookie auth
   │
   ▼
Next.js (Vercel) ── existing chat/doc code, unchanged
   ├─ /api/chat ────────────────► Groq/Gemini (existing; DB-backed system prompt now)
   ├─ /api/ingest (NEW proxy, authenticated) ──HTTPS+shared secret──► Python service (user's Mac)
   ├─ /api/ingest/status/[jobId] (NEW, polled)
   └─ /admin/system-prompt (NEW, role-gated)
             │
             ▼
      system_prompts table ◄──── read directly by Python service too
             ▲
   Supabase Postgres (pgvector): documents/document_chunks (extended),
   system_prompts, profiles.role, ingestion_jobs, document-uploads storage bucket
             ▲
             │
   User's Mac, one Cloudflare Tunnel exposing only the FastAPI service:
     FastAPI + LangGraph + Redis (local Docker) + Ollama (localhost-only, never exposed directly)
```

## New Python service: `services/ingestion-agent/`

New top-level directory (sibling to the Next.js app, outside `src/` — a
separate language/runtime, never pulled into the Next.js build):

```
services/ingestion-agent/
├── pyproject.toml, README.md, .env.example
├── app/
│   ├── main.py, config.py, auth.py       # FastAPI app, pydantic-settings, shared-secret verification
│   ├── routers/ingest.py, health.py
│   ├── graph/
│   │   ├── state.py                       # Pydantic IngestionState (storage path, not raw bytes — see below)
│   │   ├── build.py                       # StateGraph, conditional routing by format
│   │   ├── nodes/
│   │   │   ├── router.py                  # classify format from mime type + magic-byte sniff
│   │   │   ├── extract_text.py            # .txt
│   │   │   ├── extract_html.py            # .html (BeautifulSoup4)
│   │   │   ├── extract_docx.py            # .docx (python-docx)
│   │   │   ├── extract_csv.py             # .csv/tabular (pandas)
│   │   │   ├── ocr_ensemble.py            # Gemini + Ollama, cross-validated
│   │   │   ├── chunk.py                   # format-aware (prose: 1500/200 chars, matches existing TS chunker;
│   │   │   │                              #   tabular: row-group + markdown-table rendering)
│   │   │   ├── embed.py                   # Gemini gemini-embedding-001, 768-dim — same as existing TS path
│   │   │   ├── validate_output.py         # final Pydantic gate before persistence
│   │   │   └── persist.py                 # writes documents/document_chunks/ingestion_jobs
│   │   └── checkpointer.py                # langgraph-checkpoint-redis AsyncRedisSaver, thread_id=job_id
│   ├── validation/models.py, cross_validate.py
│   ├── clients/supabase_client.py, redis_client.py, gemini_client.py, ollama_client.py
│   └── memory/long_term.py                # reads/writes the EXISTING `memories` table (shared with TS chat)
└── tests/  # pytest + pytest-asyncio + respx (httpx mocking)
```

**Dependencies**: `fastapi`+`uvicorn`, `langgraph`, `langgraph-checkpoint-redis`,
`pydantic` v2 + `pydantic-settings`, `supabase` (supabase-py, service-role
key — same RPC-based access pattern as the TS app), `redis` (asyncio),
`httpx` (async, for Gemini REST + tunneled Ollama), `python-docx`,
`beautifulsoup4`+`lxml`, `pandas`, `python-multipart`, `pytest`.

### State design: storage path, not raw bytes

`IngestionState` carries `storage_path`/`filename`/`mime_type`/`user_id`,
never raw file bytes — LangGraph's Redis checkpointer serializes the full
state on every node transition (that IS the short-term/node memory), so a
multi-MB file in state would bloat every checkpoint. The Next.js proxy
uploads to a new private `document-uploads` Storage bucket first (mirrors
the existing `chat-images` bucket's per-user-folder RLS pattern); nodes
fetch bytes from Storage only when they need them.

### Graph flow

```
START → router_node → [conditional edge on format]
  txt/html/docx/csv → respective extract_*_node
  image             → ocr_ensemble_node (Gemini + Ollama, asyncio.gather)
  pdf               → reject_node (clear error pointing at the existing /documents PDF upload)
→ chunk_node → embed_node → validate_output_node → persist_node → END
(any node exception) → failed_node → ingestion_jobs.status='failed', error_message set
```

### Cross-validation (`app/validation/cross_validate.py`) — reusable pattern

```python
class SourceResult(BaseModel):
    source: str; text: str | None; error: str | None = None; latency_ms: int

class CrossValidationResult(BaseModel):
    agreement_score: float
    status: Literal["agree","partial_disagreement","disagreement","single_source"]
    reconciled_text: str
    sources: list[SourceResult]
    flagged_for_review: bool
```

`cross_validate(sources, agree_threshold=0.90, partial_threshold=0.70)`
computes similarity (starts as `difflib.SequenceMatcher`, no new
dependency; swappable later for embedding-cosine similarity) between two
sources' text. `agree` → picks the more complete text, not flagged.
`partial_disagreement`/`disagreement` → Gemini's result wins but
**flagged**, both sources retained in `metadata`. Only one source
available (e.g. the Mac/tunnel is offline) → `single_source`, always
flagged. **Disagreements are never silently resolved** — `status` and
`flagged_for_review` persist into `document_chunks.metadata` so the UI can
surface "OCR sources disagreed" rather than quietly picking one.

### Pydantic validation — two levels

- **Node level**: each extractor returns a small Pydantic model (e.g.
  `ExtractedTextResult`) that validates before the node returns — an empty
  extraction raises, routing to `failed_node`, same spirit as the existing
  TS upload route's "delete the document rather than leave an empty,
  unsearchable one behind" guard.
- **Final output**: `validate_output_node` runs a `IngestionResult`
  Pydantic model (`chunks: list[ChunkCandidate] = Field(min_length=1)`,
  a validator checking every chunk's embedding is exactly 768 floats) over
  the *entire* accumulated state before `persist_node` — nothing malformed
  ever reaches the database.

### Memory

- **Short-term/node**: `langgraph-checkpoint-redis`'s `AsyncRedisSaver`,
  keyed by `job_id` as `thread_id` — free resumability if the process
  restarts mid-job (useful since Ollama calls can be slow/flaky), plus a
  lightweight `app/memory/short_term.py` cache keyed
  `ocr:{sha256(bytes)}:{model}` (TTL 1h) so retries don't re-pay a slow
  local-Ollama inference call.
- **Long-term**: reuses the **existing** `memories` table (same one
  `src/lib/db/memories.ts`/`src/lib/memory/extract.ts` already use) via
  `supabase-py` — durable facts extracted during ingestion become
  memories the existing chat retrieval (`rankMemoriesByRelevance`) already
  surfaces. No new memory storage mechanism.
- `document_chunks` itself is the long-term store for document content —
  no separate vector store.

## Deployment: colocated on the user's Mac

`ollama serve` (port 11434, localhost-only, never exposed) +
`uvicorn app.main:app --port 8000` both run locally; `cloudflared tunnel`
exposes **only** port 8000 publicly. Redis runs as a local Docker
container (`docker run -d -p 6379:6379 redis:7-alpine`), reached at
`127.0.0.1:6379` — free, zero added latency, nothing new to expose. The
Next.js proxy calls the tunnel's public HTTPS URL with a shared-secret
bearer token (new env vars `INGEST_SERVICE_URL`, `INGEST_SERVICE_SECRET`,
set identically on both sides).

## Schema changes (Supabase migrations)

Every new/altered table gets this project's confirmed-necessary explicit
`grant ... to authenticated` / `grant all ... to service_role` treatment
in the same migration — RLS alone isn't enough here (hit and fixed live
earlier this session).

- **`multi_modal_documents`**: `documents` gets `source_type`,
  `ingested_by` ('typescript'|'python'), `metadata jsonb`.
  `document_chunks` gets `modality`, `metadata jsonb` (houses OCR
  cross-validation info, tabular row ranges, etc. — jsonb rather than new
  tables, avoiding schema explosion per modality). `match_document_chunks`
  RPC extended with an optional `modality_filter` param, backward-compatible.
- **`ingestion_jobs`** (new table): id, user_id, document_id (nullable),
  filename, status (pending/processing/done/failed), error_message,
  timestamps. RLS owner-scoped; `service_role` gets full access (Python
  writes via service-role key, same trust model as the digest cron's
  `createAdminClient()`).
- **`document_uploads_storage`**: new private `document-uploads` bucket,
  same per-user-folder policy pattern as `chat-images`.
- **`system_prompts`** (new table): id, key (unique, default 'default'),
  content, is_active, updated_by, timestamps. Seeded with the current
  hardcoded `SYSTEM_PROMPT` string so day one is behaviorally a no-op.
  RLS: `select` for `authenticated`; `insert`/`update` restricted to
  `profiles.role = 'admin'` rows.
- **`profiles_role`**: `profiles` gets `role text default 'user' check
  (role in ('user','admin'))`, seeded `role='admin' where email =
  'amit21aim@gmail.com'`. A plain user must not be able to self-promote
  via the existing `profiles_update_own` policy — add a `before update`
  trigger that ignores/rejects changes to `role` from non-admin callers
  (RLS is row-level, not column-level, so this needs the trigger for
  real defense-in-depth).

## Next.js-side integration

- **`src/app/api/ingest/route.ts`** (new): auth check → validate file →
  upload to `document-uploads` → insert `ingestion_jobs` row → POST to the
  Python service's tunnel URL with the shared secret → return `{ jobId }`
  (202). The Python service never sees a Supabase session — it trusts the
  shared secret and is handed `user_id` explicitly.
- **`src/app/api/ingest/status/[jobId]/route.ts`** (new): RLS-scoped
  status poll.
- **`src/app/(app)/documents/document-list.tsx`** (extended, not a new
  page): accept `.docx,.txt,.html,.csv,image/*` alongside the existing
  PDF path (PDF keeps calling the existing `/api/documents/upload`
  unchanged); non-PDF files call `/api/ingest` then poll status every
  ~2s (`queueMicrotask`-wrapped `setState`, matching this project's
  established `react-hooks/set-state-in-effect` workaround — copy the
  exact pattern from `reminder-poller.tsx`); show a per-row "Processing…"
  badge and a "flagged for review" chip when `document_chunks.metadata`
  shows OCR disagreement.
- **`src/app/(app)/admin/system-prompt/page.tsx`** (new): Server
  Component, `getUser()` → check `profiles.role === 'admin'` → redirect
  if not (same self-contained-auth-check style as `(app)/layout.tsx`).
- **`src/app/api/admin/system-prompt/route.ts`** (new): `GET`/`PATCH`,
  re-checks admin role server-side (never trust the page redirect alone).
- **`src/lib/db/system-prompt.ts`** (new): `getActiveSystemPrompt(supabase)`
  reads the DB row, falls back to a literal constant if none exists.
  Cached via Next.js's `'use cache'` + `cacheTag('system-prompt')`; the
  admin `PATCH` route calls `updateTag('system-prompt')` after saving so
  edits take effect on the next chat request with no deploy/TTL wait.
- **`src/app/api/chat/route.ts`** (modified): swaps the hardcoded
  `SYSTEM_PROMPT` import for `await getActiveSystemPrompt(supabase)` —
  everything else (date-appending, memory/document injection) unchanged.
  The Python service reads the same table directly via its own
  service-role client when it needs a prompt.

## Phased build order

Each phase independently shippable/verifiable, same pattern as this
session's other features.

1. **Admin-editable system prompt** (pure Next.js, no Python yet) —
   migrations, admin page/route, `SYSTEM_PROMPT` swap. Verify: bootstrap
   admin confirmed via query; edit prompt, send a chat message, confirm
   behavior changed (e.g. temporarily force a distinctive response
   pattern); confirm a non-admin account gets redirected.
2. **Python service skeleton, reachable, no real ingestion** — FastAPI
   scaffold, `/health`, shared-secret auth, Cloudflare Tunnel live,
   `/api/ingest` proxies to `/health` only. Verify: `curl` the tunnel URL
   from an unrelated network succeeds; an unauthenticated direct call is
   rejected.
3. **Redis + router-only graph** — checkpointer wired, router node
   classifies and echoes format. Verify: unit tests per mime type; confirm
   Redis actually holds checkpoint state after a run.
4. **Simple-format ingestion end to end** (.txt/.html/.csv, no OCR) — full
   graph through `persist_node`, `ingestion_jobs`/storage/schema
   migrations, UI wiring + polling. Verify: real file uploaded through the
   actual UI for each format; a chat question answerable only from
   uploaded content gets answered correctly (proves retrieval works
   unmodified against Python-authored chunks); second test user can't see
   the first user's rows (RLS check).
5. **.docx support** — one more extractor node. Verify: same as phase 4.
6. **OCR ensemble** — Gemini+Ollama, cross-validation, `ollama pull
   qwen2.5vl:7b`. Verify: clean image gives `status='agree'`,
   `agreement_score` >0.9; deliberately stopping the tunnel/Ollama mid-test
   confirms graceful `single_source` degradation, not a hard failure; UI
   shows the "flagged for review" chip.
7. **Long-term memory bridge** — ingestion writes durable facts to the
   shared `memories` table (check `20260807125335_memory_source.sql` for
   the existing `source` enum shape before adding a new value). Verify:
   ingest a document with an obvious fact, confirm it surfaces in a later,
   unrelated chat via existing memory retrieval.
8. **Hardening pass** — full pytest suite green; explicit RLS+grants audit
   per new table (attempt operations as `authenticated`, not just service
   role); document real OCR latency; lazy stuck-job timeout on the
   documents page load (no new cron — Hobby plan's is already spoken for).

## Verification (cutting across phases)

- Python unit tests per node + `cross_validate` against synthetic
  agree/disagree/single-source inputs + final-validator rejection of
  malformed chunk lists.
- Real end-to-end upload through the actual browser UI per format, plus a
  chat question proving retrieval.
- Admin prompt change proven via an observable behavioral difference in a
  chat reply, not just a DB row update (proves cache invalidation works).
- RLS/grants: attempt every new table's operations as `authenticated`
  role explicitly, not just reading policy definitions.
- Degraded-mode test: Ollama/tunnel deliberately offline mid-development
  to exercise the single-source fallback path for real.
- `npx tsc --noEmit`, lint, `npm run build` clean on the TS side; `pytest`
  clean on the Python side, at every phase.
