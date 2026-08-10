# Sofii vs Sarvam AI — competitive analysis and build plan

Goal as stated: make Sofii India's most advanced agentic AI app, competing
with ChatGPT and Gemini.

All Sarvam facts below were read from `docs.sarvam.ai` on 2026-08-10 and are
cited to the page they came from. All Sofii facts were verified against this
repository on the same day. Anything I could not verify is marked
**[unverified]** rather than asserted — this document is meant to be acted
on, so a wrong number here costs real money or a wrong architecture.

---

## 1. The strategic call, stated first

**Sarvam is not primarily your competitor. It is your best available
supplier.** Treating it as a rival is the single most expensive mistake
available in this plan.

Sarvam is a model-and-API company: it trains 105B-parameter Indic models and
sells them per token. You are building a consumer application. You cannot
out-train Sarvam on Indic language quality — they have the corpora, the GPU
allocation and a research team. Nor can you out-train OpenAI or Google.

But neither Sarvam, ChatGPT, nor Gemini currently ships what Sofii already
has: **cross-conversation memory with visible provenance, plus an agentic
tool loop, in Indian languages.** That is the wedge, and it is genuinely
defensible, because it is a product-and-data problem rather than a
model-scale problem.

So the plan is:

- **Buy** Indic language capability from Sarvam (speech, OCR, translation,
  and optionally Indic chat). Do not attempt to build it.
- **Keep** Groq for fast general-purpose reasoning and the tool loop.
- **Compete** on the application layer — memory, provenance, agency,
  WhatsApp reach, offline tolerance — where the model vendors are weak in
  India and structurally slow to move.

The honest framing: head-to-head against ChatGPT on general model quality is
not winnable and not worth attempting. "The assistant that remembers you, in
your language, on WhatsApp" is winnable.

---

## 2. What Sarvam actually sells

Verified from `docs.sarvam.ai` and `docs.sarvam.ai/api/getting-started/pricing.md`.

| Product | Model | Coverage | Notes |
|---|---|---|---|
| Chat / LLM | `sarvam-105b`, `sarvam-105b-conversations` | 11 langs (10 Indic + En) | 128K context; `-conversations` variant tuned for real-time voice agents |
| Speech-to-text | Saaras v3 | **23 langs (22 Indic + En)** | Modes: transcribe, translate, verbatim, transliteration, **code-mixed** |
| Text-to-speech | Bulbul v3 | 11 langs (10 Indic + En) | 30+ voices; pitch, pace, speaker control |
| Translation | Mayura (11), Sarvam-Translate (23) | up to 23 langs | plus transliteration and language ID |
| Document AI | Sarvam Vision | 23 langs | OCR + structured output, incl. scans and handwriting |
| Dubbing | — | Indic | speaker voice cloning, tone control |

**Sarvam-105B supports tool calling.** Confirmed: `tools`, `tool_choice`
(`auto`/`none`/`required`/forced), `response_format` (`json_schema`,
`json_object`, `text`), `stream`, and `reasoning_effort`
(`low`/`medium`/`high`). Endpoint `POST /v1/chat/completions`.

Important caveat: the docs describe it as following OpenAI *conventions* but
**not a full drop-in replacement** — primary auth is an
`api-subscription-key` header, with `Authorization: Bearer` accepted for
OpenAI-compatible tooling. Budget integration time accordingly; do not
assume the existing Groq client works unchanged.

Separately, Sarvam resells **GLM-5.2** (512K context, tool calling, visible
reasoning) and **Gemma 4 31B** (image input, tool calling) on an
OpenAI-compatible `/v2/chat/completions` endpoint. Both beta.

### Pricing (₹, from Sarvam's pricing page)

| Service | Price |
|---|---|
| Sarvam-105B | ₹29.28 / 1M input · ₹10.98 cached · ₹73.2 / 1M output |
| Speech-to-text | ₹30/hour (per-second billing); ₹45/hour with diarization |
| Bulbul v2 TTS | ₹15 / 10K characters |
| Bulbul v3 TTS | ₹30 / 10K characters (beta) |
| Translate / transliterate | ₹20 / 10K characters |
| Language identification | ₹3.5 / 10K characters |
| Document digitization | ₹0.50 / page (max 10 pages per job) |
| Free credits | ₹100 for new accounts |
| Rate limits | Starter 60 rpm · Pro 200 · Business 1,000 |

At roughly ₹88/USD that puts Sarvam-105B near **$0.33 in / $0.83 out per 1M
tokens** — the same order as mid-tier hosted models, not a premium tier.

---

## 3. Sofii's real Indic support today (verified, and worse than advertised)

The landing page says Sofii speaks "Hindi, Chinese, Arabic, Spanish, French
and around 30 other languages." For India specifically that is not accurate,
and this is the most important gap in the product.

Verified in this repo:

- **`src/lib/voice/cloud-tts.ts`** — `CLOUD_LANGS` (the ElevenLabs
  `eleven_multilingual_v2` set) contains exactly **two** Indian languages:
  `hi` and `ta`.
- **`src/lib/voice/select-voice.ts`** — `SCRIPT_RANGES` routes only 9
  scripts: Japanese, Chinese, Korean, Arabic, Cyrillic, Devanagari, Thai,
  Hebrew, Greek.
- **There is no Tamil script range.** So Tamil is in the TTS language set but
  script detection returns `null` for Tamil text, which falls through to the
  browser locale — in practice an English voice mispronouncing Tamil. It is
  unreachable in the normal path.
- **Devanagari collapses to a single `hi-IN`.** Marathi, Nepali, Konkani,
  Sanskrit and Bhojpuri are all spoken as Hindi.
- **No routing at all** for Bengali, Telugu, Kannada, Malayalam, Gujarati,
  Punjabi, Odia, Assamese — together several hundred million speakers.

Speech-to-text uses Groq `whisper-large-v3-turbo`. Whisper is genuinely
multilingual, so transcription is better than playback, but it is weak on
Indian languages relative to Indic-specific models and notably weak on
**code-mixed Hinglish**, which is how a very large share of urban India
actually speaks. Saaras v3 has an explicit code-mixed mode; this is the
single clearest quality gap.

Document OCR uses a Gemini + Ollama ensemble with cross-validation. Neither
is strong on Indic scripts or handwriting.

**Net:** Sofii today is an English-first assistant with Hindi bolted on. The
stated goal requires this to be false.

---

## 4. Head-to-head

| Capability | Sofii today | Sarvam | ChatGPT / Gemini |
|---|---|---|---|
| Indic STT | Whisper — weak, poor code-mixing | **Saaras v3, 23 langs, code-mixed** | moderate |
| Indic TTS | Hindi + Tamil, Tamil broken | **Bulbul v3, 11 langs, 30+ voices** | limited Indic prosody |
| Indic OCR / handwriting | Gemini + Ollama, weak on Indic | **Sarvam Vision, 23 langs** | moderate |
| Translation / transliteration | none | **Mayura + Translate, 23 langs** | good translation, no transliteration UX |
| General reasoning | Groq gpt-oss-120b | Sarvam-105B (Indic-tuned) | **best in class** |
| Tool calling / agency | **yes — 4-round loop, 8+ tools** | yes (API primitive) | yes |
| Cross-conversation memory | **yes, with recall + provenance** | not a product | partial, weaker provenance |
| Reply provenance | **yes — "Why this answer"** | no | no |
| Conversation branching | **yes** | no | partial (edit/regenerate) |
| Consumer app | yes | API-first + agent products | **yes, at scale** |
| WhatsApp presence | no | no | no |

**Where Sofii genuinely leads:** provenance, cross-conversation recall, and
branching. None of the three big players ship all of these. Provenance in
particular is a trust feature, and trust is the binding constraint on AI
adoption in India, where a wrong answer about a government form or a medical
dose has real consequences.

**Where Sofii is behind and it matters:** Indic voice and Indic documents.
Both are purchasable from Sarvam, immediately.

---

## 5. The plan

Ordered by value per unit of effort. Each phase is independently shippable
and independently verifiable, matching how the rest of this project is built.

### Phase 1 — Buy the Indic layer (highest value, ~1 week)

1. **Swap STT to Saaras v3** for Indic and code-mixed input; keep Whisper for
   English-only. Route on detected language, not on user setting — users do
   not know which engine they want.
2. **Swap TTS to Bulbul** for the 10 Indic languages. Keep ElevenLabs for
   European languages only. This also relieves the ElevenLabs 10K
   chars/month ceiling, which is a live constraint.
3. **Replace script-regex language detection with Sarvam's Language ID**
   (₹3.5/10K chars — effectively free at this scale). This fixes the
   Devanagari collapse and the unreachable-Tamil bug at the root rather than
   by adding nine more regexes.
4. **Add Sarvam Vision as a third OCR source.** The ingestion service already
   implements multi-source cross-validation with agreement scoring — this
   drops into the existing `cross_validate` pattern with no architectural
   change, and it is the piece that makes Indian documents (Aadhaar, forms,
   handwritten notes, regional-language PDFs) actually work.

**Verification gate:** a Marathi, Tamil, Bengali and Hinglish utterance each
transcribe correctly, get answered in-language, and play back in a
language-matched voice. Test with real audio, not synthetic text.

### Phase 2 — Indic reasoning routing (~1 week)

Route conversations detected as Indic to `sarvam-105b`; keep Groq for
English and for latency-critical paths. Sarvam-105B supports the same tool
protocol, so the existing `MAX_TOOL_ROUNDS` loop in
`src/app/api/chat/route.ts` should port with modest adaptation — but budget
for the auth-header difference and confirm streaming chunk shape matches
before assuming the Groq client works unchanged.

Keep the existing model picker so this stays observable and reversible.

### Phase 3 — Transliteration input (the unglamorous India win, ~3 days)

Let users type "mujhe kal 5 baje yaad dilana" and have it become Devanagari,
or stay Hinglish, per preference. Sarvam's transliterate API costs ₹20/10K
characters. Most Indians do not have a comfortable Indic keyboard; this
removes a real daily friction that neither ChatGPT nor Gemini addresses.

### Phase 4 — WhatsApp channel (the actual distribution unlock, ~2–3 weeks)

India runs on WhatsApp. A memory-backed agentic assistant reachable at a
WhatsApp number, with voice notes in and voice notes out, is a product
neither OpenAI, Google, nor Sarvam ships in India.

This is the highest-ceiling item in the document and also the highest-risk:
it needs WhatsApp Business API approval, a Meta business verification, and a
per-conversation cost model. **[unverified]** — I have not checked current
Meta pricing or approval timelines. Treat as a bet to validate, not a
scheduled deliverable.

### Phase 5 — Gesture and mobile layer

You asked specifically about gestures. Sofii is currently desktop-shaped;
India is overwhelmingly mobile-first. Concretely:

- **Hold-to-talk** on the composer mic, release to send — the WhatsApp voice
  gesture every Indian user already knows. Currently voice is tap-to-toggle.
- **Swipe right on a message → branch** from it. Branching already exists in
  the backend; it has no gesture.
- **Long-press a message → save as memory.** Makes the memory system
  tangible instead of implicit.
- **Swipe left on a conversation → archive/delete**, with undo.
- **Pull-to-refresh → catch-up briefing.** The catch-up logic already exists.
- **Haptic feedback** on tool completion and on wake-word detection.
- **Double-tap to regenerate.**

None of these are new backend work — they surface capabilities that already
exist but are currently buried in menus.

### Phase 6 — Infrastructure honesty

Before any of this reaches scale, the ingestion service must move off your
Mac. Today it runs behind a Cloudflare *quick* tunnel whose hostname changes
on every restart; the app now self-heals via the `service_endpoints`
registry, but the underlying dependency — that one laptop being awake — is
not a foundation for a national consumer product. Options: a small always-on
VPS, or Vercel Functions now that they support 5GB packages and 300s
timeouts.

Also unresolved: SMTP. Supabase's built-in email is rate-limited and lands
in spam. This gates user growth regardless of everything above.

---

## 6. Cost model

Rough monthly cost at **1,000 active users**, assuming 20 messages, 5 minutes
of speech in, and 3,000 characters of speech out per user per month.

| Line item | Volume | Cost |
|---|---|---|
| STT (Saaras) | 83 hours | ~₹2,500 |
| TTS (Bulbul v2) | 3M characters | ~₹4,500 |
| Chat (Sarvam-105B) | ~20M in / 6M out | ~₹1,025 |
| Language ID | 2M characters | ~₹700 |
| Document OCR | 2,000 pages | ~₹1,000 |
| **Total** | | **~₹9,700 / month (~$110)** |

That is a genuinely affordable Indic layer — the speech APIs dominate, not
the LLM. Two implications:

1. **TTS is the cost driver, not reasoning.** Cache aggressively: identical
   replies, greetings, and error messages should never be re-synthesised.
   Bulbul v2 at ₹15/10K is half the price of v3 — use v2 unless the quality
   difference is audible in blind comparison.
2. Sarvam's Starter tier is **60 rpm**, which is fine now and a hard ceiling
   later. Plan the tier upgrade before a launch push, not during one.

Comparative prices for Groq and ElevenLabs are **[unverified]** — I did not
re-check them today, and the ElevenLabs comparison in particular should be
confirmed before being used to justify the migration on cost grounds. The
*capability* argument for the swap stands on its own regardless.

---

## 7. Risks I would not paper over

- **"Compete with ChatGPT and Gemini" is not achievable head-on.** They have
  orders of magnitude more capital, compute and distribution. What is
  achievable is being clearly better for a specific user — an Indian
  multilingual user who needs memory, provenance and voice. Aim there.
- **Sarvam dependency.** Moving Indic quality onto Sarvam makes them a single
  point of failure for the differentiator. Keep the provider interface
  abstract enough to swap, and keep Whisper/ElevenLabs paths alive as
  fallbacks rather than deleting them.
- **The 105B is Indic-tuned, not universally better.** Do not route English
  through it reflexively; benchmark before switching defaults.
- **Free-tier ceilings compound.** Groq TPM, Gemini embeddings, Vercel Hobby
  cron (already at its one-per-day limit), ElevenLabs characters, Supabase.
  Any one of these throttles growth before the product does.
- **Sarvam may move up the stack.** They already ship Voice/Work/Content
  agent products. If they launch a consumer assistant, the supplier becomes a
  competitor. That argues for building the moat in memory, provenance and
  distribution — things they cannot copy from an API — rather than in
  anything a model vendor can absorb.

---

## 8. What I would do first, if only one thing

Phase 1, items 1–3: Saaras for speech in, Bulbul for speech out, Language ID
for routing.

It is roughly a week, it costs about ₹10K/month at 1,000 users, and it turns
the central marketing claim — that Sofii speaks India's languages — from
approximately false into verifiably true. Everything else in this document is
worth less than that until it is done.
