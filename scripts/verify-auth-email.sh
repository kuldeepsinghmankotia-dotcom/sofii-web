#!/usr/bin/env bash
# Check that Supabase can actually send an auth email.
#
# Signup and password reset both depend on an SMTP credential that lives
# outside this repo, in the Supabase project's auth settings. Nothing in a
# build, a test run or a deploy touches it, so when that credential is
# revoked the app keeps deploying green while every new user hits
# "Error sending confirmation email" and no existing user can reset a
# password. That is exactly how it failed: a Resend key went invalid and the
# only symptom was a red line of text on the sign-up form.
#
# The credential is checked directly rather than by sending mail, because a
# send that lands in spam still counts as a pass and a send to a real person
# is not something a check should do casually. SMTP AUTH either succeeds or
# it does not, and that is the thing that breaks.
#
# Usage:  ./scripts/verify-auth-email.sh
# Reads RESEND_API_KEY, and optionally SUPABASE_URL and SUPABASE_ANON_KEY,
# from the environment or from .env.local.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pull a value from the environment, falling back to .env.local.
from_env_local() {
  local name="$1" value="${!1:-}"
  if [ -z "$value" ] && [ -f "$ROOT_DIR/.env.local" ]; then
    value="$(grep -m1 "^${name}=" "$ROOT_DIR/.env.local" | cut -d= -f2- | tr -d '"' || true)"
  fi
  printf '%s' "$value"
}

RESEND_KEY="$(from_env_local RESEND_API_KEY)"
SB_URL="$(from_env_local SUPABASE_URL)"
[ -n "$SB_URL" ] || SB_URL="$(from_env_local NEXT_PUBLIC_SUPABASE_URL)"
SB_ANON="$(from_env_local SUPABASE_ANON_KEY)"
[ -n "$SB_ANON" ] || SB_ANON="$(from_env_local NEXT_PUBLIC_SUPABASE_ANON_KEY)"

if [ -z "$RESEND_KEY" ]; then
  echo "No RESEND_API_KEY found in the environment or .env.local." >&2
  echo "Get one at https://resend.com/api-keys, then add it to .env.local." >&2
  exit 1
fi

FAILED=0

# --- 1. Is the key live? ---------------------------------------------------
# The REST call and the SMTP login use the same credential but different
# front doors. Checking the API alone would miss a key that exists but was
# never granted sending access.
echo "1/3  Resend API key..."
DOMAINS_JSON="$(mktemp)"
trap 'rm -f "$DOMAINS_JSON"' EXIT
API_CODE="$(curl -sS -o "$DOMAINS_JSON" -w '%{http_code}' https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_KEY")"

if [ "$API_CODE" != "200" ]; then
  echo "     FAILED (HTTP $API_CODE) - $(head -c 200 "$DOMAINS_JSON")" >&2
  echo "     The key is revoked or malformed. Create a new one at" >&2
  echo "     https://resend.com/api-keys and update it in Vercel AND in" >&2
  echo "     Supabase → Authentication → Emails → SMTP." >&2
  exit 1
fi
echo "     OK - key is live"

# --- 2. Can it authenticate to the SMTP endpoint Supabase uses? ------------
echo "2/3  SMTP login at smtp.resend.com..."
if python3 - "$RESEND_KEY" <<'PY'
import smtplib, sys
try:
    s = smtplib.SMTP_SSL("smtp.resend.com", 465, timeout=20)
    s.login("resend", sys.argv[1])
    s.quit()
except Exception as e:
    print(f"     FAILED - {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
PY
then
  echo "     OK - Supabase can authenticate with this key"
else
  echo "     This is the exact failure that breaks signup." >&2
  exit 1
fi

# --- 3. Is there a verified sender domain? ---------------------------------
# Without one, Resend accepts the login and then refuses every recipient
# except the account owner - which looks like working email right up until
# the first real user signs up.
echo "3/3  Verified sender domain..."
python3 - "$DOMAINS_JSON" <<'PY' || FAILED=1
import json, sys
with open(sys.argv[1]) as f:
    domains = json.load(f).get("data") or []
verified = [d for d in domains if d.get("status") == "verified"]
for d in domains:
    print(f"     {d.get('name')} - {d.get('status')}")
if not domains:
    print("     No domains at all. Supabase can only mail your own Resend", file=sys.stderr)
    print("     account address; every other signup will bounce.", file=sys.stderr)
    sys.exit(1)
if not verified:
    print("     None verified. Finish DNS setup at https://resend.com/domains", file=sys.stderr)
    sys.exit(1)
PY
[ "$FAILED" = 0 ] && echo "     OK - can send to any address"

# --- Optional: is email actually load-bearing on this project? ------------
# Only meaningful with a real project's keys. Skipped rather than guessed,
# because the local stack auto-confirms and would report a false all-clear.
if [ -n "$SB_URL" ] && [ -n "$SB_ANON" ]; then
  echo
  echo "Supabase project at $SB_URL"
  curl -sS "$SB_URL/auth/v1/settings" -H "apikey: $SB_ANON" | python3 -c '
import json, sys
s = json.load(sys.stdin)
auto = s.get("mailer_autoconfirm")
enabled = not s.get("disable_signup")
print(f"     email signups enabled : {enabled}")
print(f"     confirmation required : {not auto}")
if not auto:
    print("     Every signup sends an email, so the checks above are load-bearing.")
else:
    print("     Auto-confirm is on: signup works without email, but password")
    print("     reset still needs the SMTP credential above.")
'
else
  echo
  echo "Set SUPABASE_URL and SUPABASE_ANON_KEY to also check whether the"
  echo "project requires email confirmation."
fi

if [ "$FAILED" != 0 ]; then
  echo
  echo "Sending is not fully working - see above." >&2
  exit 1
fi

echo
echo "Auth email is configured correctly."
