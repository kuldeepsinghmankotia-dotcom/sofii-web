#!/usr/bin/env bash
# Detects a dead/stale Cloudflare quick tunnel for the ingestion service,
# restarts it, and updates the root .env.local so local dev keeps working.
#
# Quick tunnels (trycloudflare.com) have no uptime guarantee and can go
# stale (stop resolving) without the cloudflared process itself dying --
# this happened for real once already. This script only handles the
# local side; it deliberately does NOT touch the Vercel production env
# var or redeploy, since that's a standing-config change on a live
# deployment and should stay a conscious, confirmed step, not something
# silently rewritten by a script. Re-run this whenever the ingestion
# service seems unreachable from the deployed app, then follow the
# printed next steps.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/ingestion-agent"
ENV_LOCAL="$ROOT_DIR/.env.local"
CLOUDFLARED_LOG="$SERVICE_DIR/cloudflared.log"

SECRET="$(grep -m1 '^INGEST_SERVICE_SECRET=' "$SERVICE_DIR/.env" | cut -d= -f2- | tr -d '"')"
CURRENT_URL="$(grep -m1 '^INGEST_SERVICE_URL=' "$ENV_LOCAL" | cut -d= -f2- | tr -d '"')"

if [ -z "$SECRET" ]; then
  echo "Could not read INGEST_SERVICE_SECRET from $SERVICE_DIR/.env" >&2
  exit 1
fi

echo "Current tunnel URL: ${CURRENT_URL:-<none set>}"

is_healthy() {
  local url="$1"
  # --doh-url: this Mac's local/router DNS resolver has been observed
  # taking well over a minute to pick up a freshly-created
  # *.trycloudflare.com record even though the record itself is live
  # immediately (confirmed against 1.1.1.1/8.8.8.8 directly) - resolving
  # via Cloudflare's own DoH endpoint sidesteps that local lag entirely
  # instead of needing a long, fragile retry loop.
  [ -n "$url" ] && curl -sS -m 8 --doh-url https://cloudflare-dns.com/dns-query -o /dev/null -w '%{http_code}' \
    "$url/health" -H "Authorization: Bearer $SECRET" 2>/dev/null | grep -q '^200$'
}

if is_healthy "$CURRENT_URL"; then
  echo "Tunnel is healthy - no action needed."
  exit 0
fi

echo "Tunnel is unreachable or stale. Restarting cloudflared..."

# Kill any existing quick-tunnel process for this service (matched by the
# fixed --url argument, so this won't touch an unrelated cloudflared
# tunnel if one is ever added for something else).
pkill -f "cloudflared tunnel --url http://localhost:8000" 2>/dev/null || true
sleep 2

: > "$CLOUDFLARED_LOG"
nohup cloudflared tunnel --url http://localhost:8000 >> "$CLOUDFLARED_LOG" 2>&1 &
disown

NEW_URL=""
for _ in $(seq 1 15); do
  sleep 1
  NEW_URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$CLOUDFLARED_LOG" | head -1 || true)"
  [ -n "$NEW_URL" ] && break
done

if [ -z "$NEW_URL" ]; then
  echo "Failed to obtain a new tunnel URL - check $CLOUDFLARED_LOG" >&2
  exit 1
fi

echo "New tunnel URL: $NEW_URL"
echo "Waiting for it to become reachable..."

for _ in $(seq 1 15); do
  sleep 1
  if is_healthy "$NEW_URL"; then
    echo "New tunnel is healthy."
    break
  fi
done

if ! is_healthy "$NEW_URL"; then
  echo "New tunnel did not become healthy in time - check $CLOUDFLARED_LOG and that uvicorn is running on :8000." >&2
  exit 1
fi

# Update .env.local in place (portable sed -i for both macOS/BSD and GNU).
if grep -q '^INGEST_SERVICE_URL=' "$ENV_LOCAL"; then
  sed -i.bak "s#^INGEST_SERVICE_URL=.*#INGEST_SERVICE_URL=\"$NEW_URL\"#" "$ENV_LOCAL"
  rm -f "$ENV_LOCAL.bak"
else
  echo "INGEST_SERVICE_URL=\"$NEW_URL\"" >> "$ENV_LOCAL"
fi

cat <<EOF

Done. .env.local updated for local dev.

To make production use this new URL too, run:
  vercel env rm INGEST_SERVICE_URL production --yes
  echo -n "$NEW_URL" | vercel env add INGEST_SERVICE_URL production
  vercel --prod
EOF
