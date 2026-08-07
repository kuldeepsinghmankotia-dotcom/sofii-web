# Multi-modal agentic ingestion system (Python + LangGraph)

> **Status**: Phase 1 (admin-editable system prompt) is done, verified
> end-to-end, and deployed to production. Phases 2–8 (the Python/LangGraph
> service, Redis, OCR ensemble, etc.) are not started. Update this line as
> phases land — this file doesn't auto-track progress.
>
> **Admin account** was changed after Phase 1 shipped: it's
> `kuldeepsinghmankotia@gmail.com`, not `amit21aim@gmail.com` as written
> below — the `handle_new_user()` trigger now grants admin to that email
> automatically at signup (see `20260807182735_change_admin_account.sql`),
> not a one-time seed. The mentions of `amit21aim@gmail.com` further down
> reflect the original decision and are left as historical context.

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

## High-level architecture (end state, after all phases)

```
Browser ── existing Supabase-cookie auth
   │
   ▼
Next.js (Vercel) ── existing chat/doc code, unchanged
   ├─ /api/chat ────────────────► Groq/Gemini (existing; DB-backed system prompt — Phase 1, done)
   ├─ /api/ingest (proxy, authenticated) ──HTTPS+shared secret──► Python service (user's Mac)
   ├─ /api/ingest/status/[jobId] (polled)
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
call to the Python service (no bearer token) is rejected.

---

## Phase 3 — Redis + router-only graph

**Build:**
- Redis: local Docker container (`docker run -d -p 6379:6379
  redis:7-alpine`), reached at `127.0.0.1:6379` — free, zero added
  latency, nothing new exposed through the tunnel.
- Add `langgraph`, `langgraph-checkpoint-redis`, `redis` (asyncio) to
  dependencies.
- `app/graph/state.py`: Pydantic `IngestionState` — carries
  `storage_path`/`filename`/`mime_type`/`user_id`, **never raw file
  bytes** (the Redis checkpointer serializes the full state on every node
  transition — that IS the short-term/node memory — so a multi-MB file in
  state would bloat every checkpoint write).
- `app/graph/build.py`: `StateGraph` with just `router_node` for now.
- `app/graph/nodes/router.py`: classifies format from mime type +
  magic-byte sniff, echoes it back (no real extraction yet).
- `app/graph/checkpointer.py`: `langgraph-checkpoint-redis`'s
  `AsyncRedisSaver`, keyed by `job_id` as `thread_id`.

**Verify:** unit tests for `router_node` covering each mime type; run the
graph end to end for a test job and confirm Redis actually holds
checkpoint state afterward (`redis-cli KEYS '*'` shows entries).

---

## Phase 4 — Simple-format ingestion end to end (.txt/.html/.csv, no OCR)

The first phase that actually persists something and is user-visible.

**Build:**
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
  empty extraction raises, routing to a `failed_node`, same spirit as the
  existing TS upload route's "delete the document rather than leave an
  empty, unsearchable one behind" guard.
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
  non-PDF files call `/api/ingest` then poll status every ~2s
  (`queueMicrotask`-wrapped `setState`, matching this project's
  established `react-hooks/set-state-in-effect` workaround — copy the
  exact pattern from `reminder-poller.tsx`); per-row "Processing…" badge.

**Verify:** upload a real `.txt`, `.html`, and `.csv` fixture through the
actual UI; confirm `documents`/`document_chunks` rows land with correct
`source_type`/`modality`; ask a chat question whose answer only exists in
the uploaded `.csv` and confirm the assistant answers it correctly (proves
retrieval — the existing `matchDocumentChunks` call — works unmodified
against Python-authored chunks); confirm a second test user can't see the
first user's `ingestion_jobs` row or resulting `document_chunks` (RLS
check, attempted as `authenticated` role, not just reading policy
definitions).

---

## Phase 5 — .docx support

**Build:** `app/graph/nodes/extract_docx.py` (python-docx), wired into the
router's conditional edge. Add `python-docx` to dependencies.

**Verify:** upload a real multi-paragraph `.docx` through the actual UI,
confirm extraction + retrieval exactly as in Phase 4's verification.

---

## Phase 6 — OCR ensemble (Gemini + Ollama) with cross-validation

**Build:**
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

**Verify:** upload an image with clear printed text; confirm both
`sources` entries populate in `document_chunks.metadata`,
`agreement_score` >0.9, `status='agree'`; then deliberately stop the local
`cloudflared`/Ollama process and confirm ingestion still completes with
`status='single_source'` and `flagged_for_review=true` rather than failing
outright; confirm the UI shows the chip.

---

## Phase 7 — Long-term memory bridge

**Build:** `app/memory/long_term.py` — a node (or post-persist hook) that
extracts a durable fact from ingested content (mirrors the existing TS
`extractMemoryCandidate` fire-and-forget pattern in
`src/lib/memory/extract.ts`) and writes to the **existing** `memories`
table via `supabase-py` — no new memory storage mechanism. Check
`supabase/migrations/20260807125335_memory_source.sql` for the existing
`source` enum shape before adding a new value for ingestion-sourced
memories.

**Verify:** ingest a document containing an obvious durable fact, confirm
a row appears in `memories` with a `source` distinguishing it from
chat-extracted memories, and confirm that fact surfaces in a later,
unrelated chat via the existing `rankMemoriesByRelevance` retrieval path.

---

## Phase 8 — Hardening pass

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
