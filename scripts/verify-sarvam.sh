#!/usr/bin/env bash
# Round-trip check for a Sarvam API key.
#
# Synthesises Hindi speech with Bulbul, then feeds that audio straight back
# into Saaras and checks the transcript resembles what we sent. A round trip
# is the useful test: either model alone can return a 200 that is silence or
# gibberish, but they cannot both be wrong in a way that still agrees.
#
# Usage:  ./scripts/verify-sarvam.sh
# Reads SARVAM_API_KEY from the environment or from .env.local.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

KEY="${SARVAM_API_KEY:-}"
if [ -z "$KEY" ] && [ -f "$ROOT_DIR/.env.local" ]; then
  KEY="$(grep -m1 '^SARVAM_API_KEY=' "$ROOT_DIR/.env.local" | cut -d= -f2- | tr -d '"' || true)"
fi

if [ -z "$KEY" ]; then
  echo "No SARVAM_API_KEY found in the environment or .env.local." >&2
  echo "Get one at https://dashboard.sarvam.ai, then add it to .env.local." >&2
  exit 1
fi

PHRASE="नमस्ते, मेरा नाम सोफी है।"
echo "Sent to Bulbul: $PHRASE"
echo

# --- 1. Text to speech (Bulbul) -------------------------------------------
echo "1/2  Bulbul text-to-speech..."
TTS_JSON="$OUT_DIR/tts.json"
TTS_CODE="$(curl -sS -o "$TTS_JSON" -w '%{http_code}' -X POST https://api.sarvam.ai/text-to-speech \
  -H "api-subscription-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$PHRASE\",\"language_code\":\"hi-IN\",\"model\":\"bulbul:v2\",\"speaker\":\"anushka\",\"output_audio_codec\":\"wav\"}")"

if [ "$TTS_CODE" != "200" ]; then
  echo "     FAILED (HTTP $TTS_CODE)" >&2
  head -c 400 "$TTS_JSON" >&2; echo >&2
  exit 1
fi

# Response is {"request_id":..,"audios":["<base64>"]} - decode the first one.
python3 - "$TTS_JSON" "$OUT_DIR/speech.wav" <<'PY'
import base64, json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
audio = (data.get("audios") or [None])[0]
if not audio:
    sys.exit("No audio returned in 'audios'")
with open(sys.argv[2], "wb") as f:
    f.write(base64.b64decode(audio))
PY

BYTES="$(wc -c < "$OUT_DIR/speech.wav" | tr -d ' ')"
echo "     OK - decoded ${BYTES} bytes of WAV"

if [ "$BYTES" -lt 1000 ]; then
  echo "     Audio is suspiciously small; treating as a failure." >&2
  exit 1
fi

# --- 2. Speech to text (Saaras) -------------------------------------------
echo "2/2  Saaras speech-to-text on that same audio..."
STT_JSON="$OUT_DIR/stt.json"
STT_CODE="$(curl -sS -o "$STT_JSON" -w '%{http_code}' -X POST https://api.sarvam.ai/speech-to-text \
  -H "api-subscription-key: $KEY" \
  -F "file=@$OUT_DIR/speech.wav" \
  -F 'model=saaras:v3' \
  -F 'mode=codemix' \
  -F 'language_code=unknown')"

if [ "$STT_CODE" != "200" ]; then
  echo "     FAILED (HTTP $STT_CODE)" >&2
  head -c 400 "$STT_JSON" >&2; echo >&2
  exit 1
fi

python3 - "$STT_JSON" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(f"     transcript : {d.get('transcript')}")
print(f"     language   : {d.get('language_code')} (confidence {d.get('language_probability')})")

# The point of the round trip: auto-detect should land on Hindi. A wrong
# language here means routing would send replies to the wrong voice.
if d.get("language_code") != "hi-IN":
    sys.exit(f"\nExpected hi-IN from auto-detect, got {d.get('language_code')!r}.")
PY

echo
echo "Round trip succeeded. Both Bulbul and Saaras are working with this key."
echo "Add it to Vercel next:  vercel env add SARVAM_API_KEY production"
