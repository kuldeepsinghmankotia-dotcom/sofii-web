# Multi-modal agentic ingestion system (Python + LangGraph)

> **Status**: All 10 phases done and verified for real (browser
> walkthroughs and real REST/JWT-level checks, not just passing tests).
> This system is feature-complete per this plan. Per-phase detail lives in
> each phase's own section below (search for "✅ done"); the cross-cutting
> corrections worth remembering regardless of phase are:
> - **`redis/redis-stack-server`**, not plain `redis:7-alpine` — the
>   LangGraph Redis checkpointer needs the RediSearch module.
> - **Gemini free-tier quota is shared and small**: 20 `generateContent`
>   requests/day for `gemini-3.6-flash` (used for OCR vision *and* text
>   generation, e.g. memory extraction) — genuinely exhausted more than
>   once during this session's own testing. `gemini-embedding-001` sits
>   under a separate, unaffected quota. Expect this to bite Phase 8+
>   verification too; the system is designed to degrade gracefully when
>   it does (see Phase 6), not to treat it as a bug.
> - `supabase gen types typescript --local`, redirected to a file, can
>   capture a stray `Connecting to db 5432` line as line 1, breaking the
>   TS build — check after every regenerate.
> - **Phase 8's LLM calls use Groq, not Gemini** (`app/clients/groq_client.py`)
>   — a deliberate deviation from earlier phase text that said "reuses the
>   Gemini client," made because of the quota constraint above. Any future
>   phase adding new LLM-call nodes should default to Groq for the same
>   reason, reserving Gemini for embeddings/vision where there's no
>   Groq equivalent yet.
> - `CREATE OR REPLACE FUNCTION` does **not** replace a function when the
>   parameter list changes — Postgres treats it as a new overload; drop
>   the old one explicitly in a follow-up migration.
> - **New Postgres functions get `EXECUTE` granted to `PUBLIC` by
>   default** — a `grant ... to service_role` in the same migration does
>   **not** revoke that. Found live in Phase 10 on
>   `match_document_chunks_for_service`: `authenticated` could call it
>   (not exploitable there only because the function isn't `SECURITY
>   DEFINER`, so the underlying table's RLS still applied — incidental,
>   not intentional, protection). Any future `service_role`-only function
>   needs an explicit `revoke execute ... from public` in the same
>   migration that creates it, not as an afterthought.
> - **`revoke ... from public` is not enough on Supabase Cloud specifically**
>   — the hosted platform has its own `ALTER DEFAULT PRIVILEGES` rule that
>   grants `EXECUTE` to `anon`/`authenticated` individually on every new
>   function, bypassing `PUBLIC` entirely. Local `supabase start` doesn't
>   have this rule, so a local-only grants check can pass while production
>   is still wide open. Always `revoke ... from anon, authenticated`
>   explicitly by name, and **verify any grants/RLS security fix against
>   the actual production database**, not just local — local passing is
>   not sufficient evidence.
>
> **Admin account** was changed after Phase 1 shipped: it's
> `kuldeepsinghmankotia@gmail.com`, not `amit21aim@gmail.com` as written
> below — the `handle_new_user()` trigger now grants admin to that email
> automatically at signup (see `20260807182735_change_admin_account.sql`),
> not a one-time seed. The mentions of `amit21aim@gmail.com` further down
> reflect the original decision and are left as historical context.
>
> **Realigned against a layer-by-layer reference architecture** the user
> provided after Phase 1 shipped (User Interface / Orchestration / Agent /
> Model / Validation / Memory / Retrieval / Integration / Monitoring). Most
> layers were already covered (see the mapping below); two were real gaps
> and are now their own phases: **Phase 8 (Agent layer — query-time
> routing)** and **Phase 9 (Monitoring layer)**. The old Phase 8
> "Hardening pass" is now Phase 10.

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
- **Monitoring stays app-level, not infra-level**: this plan exposes
  structured logs and a `/metrics` endpoint; standing up an actual
  Prometheus server + Grafana dashboards to scrape it is optional
  infrastructure left for the user to decide on separately, not assumed
  or built here.

## Layer-by-layer coverage

Mapped against the reference architecture (User Interface / Orchestration
/ Agent / Model / Validation / Memory / Retrieval / Integration /
Monitoring) so it's clear what's covered where, and why the two new phases
exist.

| Layer | Covered by | Notes |
|---|---|---|
| User Interface | Existing chat UI (pre-existing) + Phase 4's document-list.tsx extension + Phase 1's admin UI | Voice input already exists, separate from this plan |
| Orchestration | Phases 2–3 (Python/FastAPI + LangGraph skeleton, router) | |
| **Agent** | **Phase 8 (new)** | The ingestion "router" (Phase 3) only classifies *file format*, not *query intent* — that's a materially different thing and didn't exist until Phase 8 was added |
| Model | Gemini (embeddings, vision, existing chat) + Ollama (vision/OCR, Phase 6) | Groq (existing chat's primary model) stays outside this plan's Python service |
| Validation | Phases 4 (node + final-output Pydantic) and 6 (cross-validation) | |
| Memory | Phase 3 (Redis short-term/checkpointer) + Phase 7 (Postgres long-term via the existing `memories` table) | Postgres, not MongoDB — reuses what's already provisioned |
| Retrieval (RAG) | Existing pgvector `document_chunks` + `match_document_chunks`, extended in Phase 4 | Not Pinecone/FAISS/Weaviate — deliberate, pgvector was already working and free |
| Integration | Already exists in the current app (calendar, web search, reminders — `src/lib/tools/`), outside this plan | Email integration doesn't exist anywhere yet; not requested |
| **Monitoring** | **Phase 9 (new)** | Was completely absent before this realignment — real risk given the service runs unattended on the user's own Mac |

## High-level architecture (end state, after all phases)

```
Browser ── existing Supabase-cookie auth
   │
   ▼
Next.js (Vercel) ── existing chat/doc code, unchanged
   ├─ /api/chat ────────────────► Groq/Gemini (existing; DB-backed system prompt — Phase 1, done)
   ├─ /api/ingest (proxy, authenticated) ──HTTPS+shared secret──► Python service (user's Mac)
   ├─ /api/ingest/status/[jobId] (polled)
   ├─ /api/query (proxy, authenticated — Phase 8) ──HTTPS+shared secret──► Python service
   └─ /admin/system-prompt (role-gated — Phase 1, done)
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
     /metrics (Phase 9) + structured JSON logs throughout
```

Every table gets this project's confirmed-necessary explicit
`grant ... to authenticated` / `grant all ... to service_role` treatment in
the same migration that creates/alters it — RLS alone isn't enough here
(hit and fixed live earlier this session). Every phase below repeats that
reminder where it applies rather than assuming it's remembered.

---

## Phase 1 — Admin-editable system prompt ✅ done

Pure Next.js, no Python yet. Ships as a behavioral no-op on day one (the
seed value matches the prior hardcoded prompt exactly).

**Built:**
- Migration: `profiles` gets a `role text default 'user' check (role in
  ('user','admin'))` column; a `before update` trigger
  (`prevent_self_role_escalation`) blocks a non-admin from setting their
  own `role` via the existing `profiles_update_own` policy (RLS is
  row-level, not column-level); `system_prompts` table (id, key, content,
  is_active, updated_by, timestamps), RLS `select` open to `authenticated`,
  `insert`/`update` restricted to `profiles.role = 'admin'` rows; explicit
  grants per this project's convention.
- `src/lib/db/system-prompt.ts`: `getActiveSystemPrompt(supabase)` — no
  caching layer (this project's `next.config.ts` doesn't have Cache
  Components enabled; a single indexed-row read is cheap enough next to
  the LLM call that follows it — not worth the complexity).
- `src/lib/db/profiles.ts`: `getOwnRole(supabase, userId)`.
- `src/app/api/chat/route.ts`: swapped the hardcoded `SYSTEM_PROMPT`
  import for `await getActiveSystemPrompt(supabase)`; the dead constant
  was removed from `src/lib/groq/client.ts` rather than left unused.
- `src/app/(app)/admin/system-prompt/page.tsx` + `system-prompt-form.tsx`
  (role-gated Server Component + client form), `src/app/api/admin/system-prompt/route.ts`
  (`GET`/`PATCH`, re-checks role server-side — never trusts the page
  redirect alone).
- Sidebar: conditional "System Prompt" link, admin-only
  (`src/app/(app)/sidebar.tsx`, `isAdmin` threaded through
  `(app)/layout.tsx` → `app-shell.tsx` → `sidebar.tsx`).
- Admin bootstrap: originally `amit21aim@gmail.com` via a one-time seed,
  later changed (see Status note above) to `kuldeepsinghmankotia@gmail.com`
  via a durable trigger-based grant in `handle_new_user()`.

**Verified:** non-admin redirected from `/admin/system-prompt` and never
sees the sidebar link; promoted a test account to admin (service-role
update, confirms the trigger correctly allows service-role writes); page
loads, edits persist; **an edited prompt instructing replies to start with
a literal marker actually changed a live chat reply** — proves the whole
path, not just that a DB row updated. Also caught and fixed a real bug
during this verification: the "unsaved changes" indicator compared against
the initial page-load value forever and never cleared after a successful
save.

---

## Phase 2 — Python service skeleton, reachable, no real ingestion

**Build:**
- `services/ingestion-agent/` (new top-level directory, sibling to the
  Next.js app, outside `src/` — separate language/runtime, never pulled
  into the Next.js build): `pyproject.toml`, `README.md`, `.env.example`,
  `app/main.py` (FastAPI app), `app/config.py` (`pydantic-settings`),
  `app/auth.py` (shared-secret verification), `app/routers/health.py`
  (`GET /health`).
- **Structured logging from day one** (not deferred to Phase 9): configure
  Python's `logging` with a JSON formatter (or `structlog`) in
  `app/main.py`'s startup, log every request (method, path, status,
  duration) via FastAPI middleware. Cheap to add now, expensive to retrofit
  once there are a dozen node files that all log differently — Phase 9
  builds *on* this baseline (metrics endpoint, dashboards-if-wanted), it
  doesn't establish it from scratch.
- Dependencies for this phase: `fastapi`, `uvicorn`, `pydantic` v2,
  `pydantic-settings`, `httpx`, `pytest`.
- **Deployment** (colocated on the user's Mac, per the confirmed
  decision): `uvicorn app.main:app --port 8000` running locally;
  `cloudflared tunnel` exposing **only** port 8000 publicly. New env vars
  `INGEST_SERVICE_URL`, `INGEST_SERVICE_SECRET` (set identically in
  Vercel's env and the Python service's `.env`).
- `src/app/api/ingest/route.ts` (new): for now, just proxies to the Python
  service's `/health` with the shared secret — proves the whole chain
  (browser → Vercel → tunnel → home machine) works before any real graph
  exists.

**Verify:** `curl $INGEST_SERVICE_URL/health` succeeds from an unrelated
network (e.g. a phone hotspot, not the same LAN as the Mac); a signed-in
browser session hitting a temporary test button calling `/api/ingest` gets
a 200 with the Python service's health payload; an unauthenticated direct
call to the Python service (no bearer token) is rejected; confirm the
request-logging middleware actually emits a structured log line for that
call.

---

## Phase 3 — Redis + router-only graph ✅ done

**Built:**
- Redis: local Docker container, **`redis/redis-stack-server`** (not
  plain `redis:7-alpine` — `AsyncRedisSaver` needs the RediSearch module
  for its index and fails with `unknown command 'FT.INFO'` without it),
  `docker run -d --name sofii-ingestion-redis -p 6379:6379
  redis/redis-stack-server:latest`, reached at `127.0.0.1:6379` — free,
  zero added latency, nothing new exposed through the tunnel.
- Added `langgraph`, `langgraph-checkpoint-redis`, `redis` (asyncio) to
  dependencies; `REDIS_URL` env var (`app/config.py`).
- `app/graph/state.py`: Pydantic `IngestionState` — carries
  `storage_path`/`filename`/`mime_type`/`user_id`, **never raw file
  bytes** (the Redis checkpointer serializes the full state on every node
  transition — that IS the short-term/node memory — so a multi-MB file in
  state would bloat every checkpoint write). The one exception is a tiny
  magic-byte sniff sample (~16 bytes) for format detection, stored as
  `sample_bytes_b64: str` — base64-encoded, because the checkpointer's
  JSON serialization path rejects a raw `bytes` field nested in the
  model.
- `app/graph/build.py`: `StateGraph` with just `router_node` for now.
- `app/graph/nodes/router.py`: classifies **file format** (this is the
  ingestion router — see Phase 8 for the separate *query* router) from
  mime type + magic-byte sniff, echoes it back (no real extraction yet).
- `app/graph/checkpointer.py`: `langgraph-checkpoint-redis`'s
  `AsyncRedisSaver`, keyed by `job_id` as `thread_id`.

**Verified:** 17 pytest cases for `router_node` — mime-type classification
for every target format, magic-byte fallback when mime type is generic
(`application/octet-stream`), mime type correctly taking priority over a
misleading magic-byte match, and the `unknown` case — all pass. Ran the
compiled graph end to end (`graph.ainvoke`) for a real test job against
the live `redis-stack-server` container; `redis-cli KEYS '*'` afterward
shows real `checkpoint:test-job-123:...` and `checkpoint_write:...` keys,
confirming the checkpointer actually persisted state, not just that the
in-memory call returned successfully.

---

## Phase 4 — Simple-format ingestion end to end (.txt/.html/.csv, no OCR) ✅ done

The first phase that actually persists something and is user-visible.

**Built:**
- Migration `multi_modal_documents`: `documents` gets `source_type`,
  `ingested_by` ('typescript'|'python'), `metadata jsonb`.
  `document_chunks` gets `modality`, `metadata jsonb` (houses per-modality
  extras like tabular row ranges — jsonb rather than new tables per
  modality). `match_document_chunks` RPC extended with an optional
  `modality_filter` param, backward-compatible with existing TS callers.
- Migration `ingestion_jobs` (new table): id, user_id, document_id
  (nullable), filename, status (pending/processing/done/failed),
  error_message, timestamps. RLS owner-scoped; `service_role` gets full
  access (Python writes via service-role key, same trust model as the
  digest cron's `createAdminClient()`).
- Migration `document_uploads_storage`: new **private** `document-uploads`
  bucket, same per-user-folder policy pattern as the existing
  `chat-images` bucket.
- Python: `app/graph/nodes/extract_text.py` (.txt), `extract_html.py`
  (BeautifulSoup4), `extract_csv.py` (pandas), `chunk.py` (prose:
  1500/200 chars, matching the existing TS chunker's sizing; tabular:
  row-group + markdown-table rendering), `embed.py` (Gemini
  `gemini-embedding-001`, 768-dim — same model/dims as the existing TS
  path, so retrieval is unified regardless of which pipeline created a
  chunk), `validate_output.py`, `persist.py`. Add `beautifulsoup4`+`lxml`,
  `pandas`, `python-multipart`, `supabase` (supabase-py) to dependencies.
- **Node-level Pydantic validation**: each extractor returns a small model
  (e.g. `ExtractedTextResult`) that validates before the node returns — an
  empty extraction raises `ValidationError`, same spirit as the existing
  TS upload route's "delete the document rather than leave an empty,
  unsearchable one behind" guard. Simplified from the original design:
  rather than a dedicated `failed_node` branch inside the graph, any node
  exception (validation or otherwise) simply propagates up through
  `graph.ainvoke` and is caught by one try/except in
  `app/routers/ingest.py`'s background task, which marks the
  `ingestion_jobs` row `failed` with the exception message — same
  end-user behavior, less graph structure.
- **Final-output Pydantic validation**: `validate_output_node` runs an
  `IngestionResult` model (`chunks: list[ChunkCandidate] =
  Field(min_length=1)`, a validator checking every chunk's embedding is
  exactly 768 floats) over the *entire* accumulated state before
  `persist_node` — nothing malformed ever reaches the database.
- `src/app/api/ingest/route.ts`: fully wired now — auth check, file
  validation, upload to `document-uploads`, `ingestion_jobs` row insert,
  real POST to the Python service. `src/app/api/ingest/status/[jobId]/route.ts`
  (new): RLS-scoped status poll.
- `src/app/(app)/documents/document-list.tsx` (extended, not a new page):
  accepts `.txt,.html,.csv` alongside the existing PDF path (PDF keeps
  calling the existing `/api/documents/upload`, completely unchanged);
  non-PDF files call `/api/ingest` then poll status every 2s via one
  persistent `setInterval` reading a ref-mirrored job list (no
  `queueMicrotask` needed here — the ESLint `set-state-in-effect` rule
  only flags synchronous setState during an effect's initial render pass,
  and this setState only ever runs inside the interval's async callback,
  well after mount); per-row "Queued…"/"Processing…" badge, inline error
  + dismiss on failure.

**Verified:** uploaded real `.txt`, `.html`, and `.csv` fixtures through
the actual Documents UI as a real signed-up test user; confirmed
`documents` rows landed with correct `source_type`/`ingested_by='python'`
and `document_chunks` rows with correct `modality`
(`prose`/`prose`/`tabular`). Asked chat three separate questions whose
answers only existed in the uploaded content (a fact from the `.txt`, a
fact from the `.html` with a `<script>` tag confirmed stripped, a
per-row fact from the `.csv`) — all three answered correctly, proving
`matchDocumentChunks` (unchanged since Phase 1) retrieves Python-authored
chunks with zero changes on the retrieval side. Confirmed RLS isolation
with a second real test user: a direct authenticated call to
`/api/ingest/status/<first user's jobId>` returned a clean 404, and the
second user's Documents page showed zero documents — not just a policy
read, an actual attempted cross-user access.

---

## Phase 5 — .docx support ✅ done

**Built:** `app/graph/nodes/extract_docx.py` (python-docx, paragraph text
only), wired into the router's conditional edge and `unsupported_format`'s
message table updated to drop the now-stale docx entry. Added
`python-docx` to dependencies. Extended `/api/ingest/route.ts`'s
`SUPPORTED_EXTENSIONS` map and `document-list.tsx`'s file input `accept`
to include `.docx`.

**Verified:** uploaded a real multi-paragraph `.docx` fixture through the
actual UI, confirmed it reached `done` status, and a chat question whose
answer only existed in that document answered correctly — exactly the
Phase 4 verification bar, repeated for this format.

---

## Phase 6 — OCR ensemble (Gemini + Ollama) with cross-validation ✅ done

**Built:**
- `app/validation/models.py` + `cross_validate.py` — the reusable
  multi-source agreement-check pattern:
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
  **flagged**, both sources retained. Only one source available (e.g. the
  Mac/tunnel is offline) → `single_source`, always flagged.
  **Disagreements are never silently resolved** — `status` and
  `flagged_for_review` persist into `document_chunks.metadata` so the UI
  can surface "OCR sources disagreed" rather than quietly picking one.
- `app/graph/nodes/ocr_ensemble.py`: `asyncio.gather`s a Gemini vision call
  (`app/clients/gemini_client.py`, reuses `GEMINI_API_KEY`) and an Ollama
  vision call (`app/clients/ollama_client.py`, httpx to the tunneled
  `127.0.0.1:11434` endpoint), feeds both into `cross_validate`.
- `ollama pull qwen2.5vl:7b` on the Mac (see Context for fallback model
  options); `OLLAMA_VISION_MODEL` env var makes this swappable without a
  code change.
- Short-term memory addition: `app/memory/short_term.py` — a Redis cache
  keyed `ocr:{sha256(bytes)}:{model}` (TTL 1h) so retries within the same
  session don't re-pay a slow local-Ollama inference call.
- UI: `document-list.tsx` accepts `image/*` now too; surfaces a "flagged
  for review" chip when `document_chunks.metadata` shows OCR disagreement.

**Verified:** uploaded a real image (screenshotted from a locally-served
HTML page — no Pillow available for synthetic image generation) with
clear printed text; confirmed both `sources` entries populated in
`document_chunks.metadata`, `agreement_score≈0.99`, `status='agree'`.
Degraded mode confirmed twice — once when Gemini's real free-tier quota
was exhausted mid-session, once via a deliberate `gemini_client.vision_ocr`
failure injection — both times ingestion completed via Ollama alone,
`status='single_source'`, `flagged_for_review=true`, and the real
Documents UI rendered the "⚠ Flagged for review" chip (confirmed via
screenshot). A chat question about the flagged document still answered
correctly. The Redis OCR cache was confirmed live: a repeat run against
the same image bytes returned in ~4ms.

---

## Phase 7 — Long-term memory bridge ✅ done

**Built:** `app/memory/long_term.py` — `extract_memory_candidate` calls a
new `gemini_client.generate_text` helper (text-only `generateContent`,
same `gemini-flash-latest` model already used for vision) with a prompt
adapted from `src/lib/memory/extract.ts`'s `extractMemoryCandidate`, capped
at the first 4000 chars of extracted text. `save_document_memory_node` is
wired as the graph's actual final node (`persist` → `save_document_memory`
→ `END`) — deliberately **catches and logs any exception internally**
rather than raising, so a memory-extraction failure can never fail an
otherwise-successful ingestion job (proven live, see below). Added
`'document'` as a new `memories.source` value (migration
`20260808120000_memory_source_document.sql` — the existing enum was only
`'manual'`/`'auto'`, and document-sourced facts are a genuinely distinct
provenance worth surfacing separately) with a matching new "From a
document" badge in the Memories UI (`memory-list.tsx`), alongside
`MemorySource` in `src/lib/db/memories.ts`.

**Verified:** confirmed `extract_memory_candidate` directly against real
document content (a "call me Captain Nova" fixture) — extracted the fact
correctly. Uploading that fixture through the real UI then hit Gemini's
daily quota mid-run — which **proved the fire-and-forget design for
real**: the document still ingested successfully (`documents`/
`document_chunks` rows, job status `done`) even though the memory node's
own LLM call failed and logged an error. Since the quota was genuinely
exhausted for the rest of the session, the DB-write half was verified by
calling `save_document_memory_node` directly with `extract_memory_candidate`
swapped for a stub returning a fixed fact (extraction logic itself already
covered by both the direct real-Gemini call above and 4 unit tests in
`tests/test_long_term_memory.py`) — confirmed the row landed with
`source='document'`, the Memories page rendered the real "From a document"
badge, and a **completely unrelated** later chat message ("what should you
call me?") correctly replied "Captain Nova" — proving
`rankMemoriesByRelevance` retrieval works unmodified for Python-sourced
memories.

---

## Phase 8 — Agent layer: query-time routing (new) ✅ done

Everything through Phase 7 gets documents *into* the system. Nothing yet
lets a user *ask* something and have it routed to a specialized flow —
that's the actual "Agent Layer" from the reference architecture, and it's
a different thing from the ingestion router in Phase 3 (that one only
classifies file format).

**Built:**
- **New `app/clients/groq_client.py`**, not Gemini, for classification and
  synthesis — a real-time change from the original plan. Gemini's
  free-tier `generateContent` quota (20 requests/day, shared across vision
  *and* text) was already exhausted more than once by this session's own
  Phase 6/7 testing; Groq is the app's primary chat model with far more
  headroom and was already integrated. Embeddings still use
  `gemini-embedding-001` (a separate, unaffected quota) so retrieval stays
  consistent with the rest of the system.
- **A necessary correctness fix found while building this**: the existing
  `match_document_chunks` RPC filters by `auth.uid()`, which is **null**
  for the Python service's service-role calls (no Supabase session/JWT) —
  it would have silently returned zero rows for every query, not an error.
  Added `match_document_chunks_for_service(query_embedding, target_user_id,
  match_count, modality_filter)` in migration
  `20260808130000_match_chunks_for_service.sql`, granted **only** to
  `service_role` (never `authenticated`/`anon` — it takes an arbitrary
  `target_user_id` with no self-scoping, so only the Python service should
  ever call it).
- `app/graph/query_state.py` (`QueryState`, `Citation`) + a **separate**
  LangGraph (`app/graph/query_build.py`, no checkpointer — a query is one
  stateless request, nothing to resume), distinct from the ingestion
  graph.
- `app/graph/nodes/query_router.py`: classifies intent via Groq with JSON
  mode, Pydantic-validated against a `Literal` of the four intents; falls
  back to `answer_from_documents` (the safe default) on any malformed/
  invalid classification rather than failing the request. Simplified from
  the original design: the classifier returns intent only, not
  `target_document_ids` — document selection comes from the API request
  payload instead (the UI's document-picker), which is far more reliable
  than asking an LLM to guess IDs from filenames.
- Four specialized nodes, each fetching real content then synthesizing via
  Groq: `answer_from_documents_node` (embeds the query, calls the new
  service-role RPC, cites chunks by number), `summarize_document_node`
  and `extract_structured_data_node` (require exactly one selected
  document), `compare_documents_node` (requires 2+). Every
  `document_chunks` read is filtered by **both** `document_id` and
  `user_id` — defense-in-depth against the service-role client's RLS
  bypass, same reasoning as `match_document_chunks`'s own comment.
  `extract_structured_data_node` validates output via a Pydantic
  `ExtractedData` model.
- `POST /query` on the Python service; `src/app/api/query/route.ts`
  (authenticated proxy, same shared-secret pattern as `/api/ingest`);
  `src/app/(app)/documents/ask-documents.tsx` — the minimal UI: a query
  box, a document-selector (toggle chips), and a response panel showing
  the intent label, answer, and citations. Deliberately not wired into the
  main chat interface, per the original scope decision.

**Verified:** uploaded two real documents (the Phase 4 `.txt`/`.csv`
fixtures) as a real test user, then drove all four intents through the
actual authenticated `/api/query` proxy: **answer_from_documents**
correctly returned `ZEBRA-4471-QUARTZ` with a citation back to the right
chunk; **summarize_document** produced a genuine summary of one document;
**compare_documents** produced a real comparison referencing both
documents' actual distinct content; **extract_structured_data** correctly
pulled all three CSV rows as a JSON array. That last one **failed on the
first real attempt** — the `ExtractedData` model required `data: dict`,
but a "list each employee" request naturally produces a JSON *array*, not
a single object, and Pydantic rejected it. Fixed by widening the field to
`dict | list[dict]` with a non-empty validator; re-verified working.
Cross-user rejection confirmed with a second real test user: querying
across "your documents" found nothing (correct — they have none), and a
direct attempt to summarize the first user's document by ID returned
"doesn't belong to you" rather than leaking content.

---

## Phase 9 — Monitoring layer (new) ✅ done

Was completely absent before this realignment. Builds on the request
logging already established in Phase 2 rather than starting from zero.

**Built:**
- `prometheus-client` dependency; `app/metrics.py` defines the actual
  metrics (`ingestion_jobs_total{status}`, `ocr_cross_validation_total{status}`,
  `query_requests_total{intent}`, `node_duration_seconds{node}` histogram)
  plus a `timed_node(name)` wrapper; `app/routers/metrics.py` exposes
  `GET /metrics` (shared-secret protected, like every other endpoint on
  this service) in Prometheus text-exposition format.
- **`timed_node` is applied centrally at graph-registration time**
  (`build.py`/`query_build.py` wrap every `add_node(...)` call), not as a
  per-file decorator — one mechanism guarantees every node in both graphs
  gets a structured `"node executed"`/`"node failed"` log line (with
  `duration_ms`) *and* a histogram observation, with no risk of missing
  one during the "audit every node" pass. Handles both sync node functions
  (router, chunk, validate_output, unsupported_format) and async ones
  uniformly via `inspect.isawaitable`.
- **A real bug found and fixed during the audit**: `app/routers/ingest.py`
  called `mark_job_processing()` *before* the `try:` block — if that
  single call failed (reproduced live with a malformed non-UUID `job_id`),
  the exception propagated straight out of the background task: no
  `error_message` ever recorded, the job stuck in `pending` forever, and
  `ingestion_jobs_total` never incremented for the failure. Fixed by
  moving it inside `try:`, plus a nested try/except around the failure
  path's own `mark_job_failed()` call (which can fail for the identical
  reason — the job_id itself is what's invalid) so the background task
  can now never raise unhandled, in any failure mode.
- **Explicitly not built**: an actual Prometheus server or Grafana
  dashboards — optional infrastructure left for the user to separately
  decide on; this phase only makes the data available in a standard,
  scrapeable format.
- Next.js side: confirmed (not just asserted) that `/api/ingest` and
  `/api/query` already return explicit error `Response`s on every failure
  path, matching this codebase's actual convention — `console.error` here
  is reserved for fire-and-forget paths that don't return to the caller
  (verified by grepping ~10 existing routes). No new logging needed.

**Verified:** `curl $INGEST_SERVICE_URL/metrics` (with the shared secret)
returns valid Prometheus text format alongside the default Python process
metrics. Ran a real ingestion job and a real query: `query_requests_total`,
`node_duration_seconds` (both graphs) confirmed incrementing immediately.
The `ingestion_jobs_total` gap above was caught specifically *because* a
first attempt didn't show up in the counter — investigating "why is this
missing" is what surfaced the bug. After the fix: a valid-UUID job
correctly increments `status="done"`, and the deliberately-malformed
`job_id` case (re-run after the fix) now correctly increments
`status="failed"` with two clearly distinguishable structured error log
lines, instead of crashing silently. Also caught, incidentally: real
evidence in the logs that Gemini's quota exhaustion during memory
extraction (Phase 7) doesn't stop the ingestion job from completing
successfully — the fire-and-forget design proven live yet again.

---

## Phase 10 — Hardening pass ✅ done

**Build/verify (no new user-facing surface):**
- Full `pytest` suite green (`services/ingestion-agent/tests/`), including
  an end-to-end test against a real test-project Supabase schema.
- RLS/grants audit: for every table touched by this plan, explicitly
  attempt the operation as `authenticated` role (not service role) and
  confirm it succeeds/fails as expected — this project's specific
  "permission denied for table X" lesson, hit and fixed live earlier this
  session, applies again here.
- Document real OCR latency in `services/ingestion-agent/README.md` (the
  async/polling UX choice from Phase 4 should be validated as necessary,
  not just assumed).
- Stuck-job cleanup: since no new cron slot is available (Hobby plan's is
  already spoken for by the earlier digest-cron work), add a lazy check on
  the documents page load (Server Component) that marks any
  `ingestion_jobs` row stuck in `status='processing'` for over N minutes
  as `failed` with a timeout message, rather than adding a cron.

**Built:**
- `services/ingestion-agent/tests/test_e2e_ingestion.py`: a real, non-mocked
  end-to-end test — creates a throwaway `auth.users` row via
  `supabase.auth.admin.create_user`, uploads a real file to Storage, runs
  the actual compiled graph (Redis checkpointer included), asserts on the
  real `documents`/`document_chunks` rows, then deletes the user (cascade
  cleans up the rest). 38 tests total, all green.
- `src/lib/db/ingestion-jobs.ts`'s `markStuckIngestionJobsFailed` (10-minute
  timeout, chosen with real OCR latency data below in hand — comfortably
  above the slowest observed real job), called once from
  `documents/page.tsx` on every page load.
- `services/ingestion-agent/README.md` rewritten with real measured OCR
  latency (see below) and a dependencies/testing/monitoring overview.

**Verified — and one real security finding, fixed:**
- **`match_document_chunks_for_service` (added in Phase 8) was callable by
  the `authenticated` role**, not just `service_role` as documented and
  intended. Postgres grants `EXECUTE` on a new function to `PUBLIC` by
  default, and the Phase 8 migration only *added* a grant to
  `service_role` — it never revoked the implicit `PUBLIC` one. Verified
  live: an `authenticated` test user's JWT could call the RPC with an
  arbitrary `target_user_id` and got HTTP 200, not 403. **Not an active
  data leak** — confirmed by seeding a real second user's chunk via
  service role and attempting to read it as the first user: it correctly
  came back empty, because the function isn't `SECURITY DEFINER`, so
  `document_chunks`'s own RLS policy (scoped to `auth.uid()`) still
  applied underneath it. That protection was **incidental, not
  intentional** — it would silently vanish if this function (or a copy of
  its pattern) were ever changed to `SECURITY DEFINER` for a performance
  reason without revisiting this. Fixed in migration
  `20260808150000_revoke_public_service_rpc.sql`
  (`revoke execute ... from public`); re-verified live afterward:
  `authenticated` now gets a real `42501`/403 `permission denied`,
  `service_role` is unaffected. **This fix was itself incomplete on
  production** — see the note below.
- Full RLS/grants audit performed with two real `authenticated` JWTs
  (via GoTrue's password grant, not just service-role assumptions):
  `documents` (self-insert succeeds, insert claiming another user's
  `user_id` correctly 403s), `ingestion_jobs` (same pattern, plus
  cross-user `SELECT` by ID returns empty, not an error), `document_chunks`
  (a user only ever sees their own rows), Storage `document-uploads`
  bucket (upload into another user's folder rejected, cross-user download
  returns 404 not found rather than confirming existence), `memories`
  (the new `'document'` source value insertable by a user for their own
  row, matching the existing permissive `'auto'` pattern; an invalid
  source value correctly rejected by the check constraint).
- OCR latency measured for real (Apple Silicon Mac, uncached): Gemini
  vision ~1–4s when not rate-limited; **Ollama (`qwen2.5vl:7b`) local
  inference: 32–41s** across two separate real images. This is
  substantially slower than assumed earlier in the session and concretely
  justifies Phase 4's async/polling design — a synchronous request held
  open that long would time out or read as broken well before completing.
- Stuck-job cleanup verified live: seeded a real `ingestion_jobs` row
  stuck in `status='processing'` with `updated_at` 15 minutes in the past,
  loaded the real Documents page as that user, confirmed the row flipped
  to `status='failed'`, `error_message='Ingestion timed out'` — not just
  that the code looks right, that the actual page load did it.

**Post-deploy correction**: pushing migrations to the real production
Supabase project surfaced that the `revoke execute ... from public`
fix above was **incomplete on the hosted platform**. Verified live against
production directly: after that migration, `authenticated` *still* had
`EXECUTE` on `match_document_chunks_for_service`. Cause: Supabase Cloud
projects carry their own `ALTER DEFAULT PRIVILEGES` rule (owned by
`supabase_admin`) that auto-grants `EXECUTE` on every new public-schema
function directly to `anon`/`authenticated`/`service_role` as individual
grants — not through `PUBLIC` — so a `revoke ... from public` alone never
touches them. Local `supabase start` doesn't reproduce this rule, which is
exactly why the local-only verification above looked complete but wasn't.
Fixed for real in migration
`20260808160000_revoke_anon_authenticated_service_rpc.sql`
(`revoke execute ... from anon, authenticated`, explicitly by name), and
this time verified against the **actual production** database — created a
real throwaway user there, got a real JWT, called the RPC: `403 permission
denied`. Lesson for any future `service_role`-only function: verifying
against local Supabase is not sufficient proof for a grants/RLS claim;
verify against the real hosted project before calling a security fix done.

All 10 phases of this plan are now done and verified for real, including
against the actual production database, not just local.

---

## Cross-cutting verification checklist

Applies at every phase, not just the phase that introduces something:

- `npx tsc --noEmit`, lint, `npm run build` clean on the TS side; `pytest`
  clean on the Python side.
- Every new/altered table: explicit `grant` statements in the same
  migration, RLS policy attempted as `authenticated` role for real (not
  just read from `pg_policies`).
- Any user-facing change gets a real browser walkthrough, not just a
  passing test — this project's established standard (see Phase 1's
  verification for the bar to match).
