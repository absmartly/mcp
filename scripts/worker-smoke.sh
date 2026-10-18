#!/usr/bin/env bash
# Starts the Worker locally (wrangler dev) and checks that /health answers.
# A Worker that throws at module load never serves a request, which is how the
# supports-color crash reached production deploys (Cloudflare error 10021)
# while typecheck and unit tests passed.
set -euo pipefail

PORT="${WORKER_SMOKE_PORT:-8790}"
READY_TIMEOUT_SECONDS="${WORKER_SMOKE_TIMEOUT:-90}"
LOG_FILE="$(mktemp)"

cd "$(dirname "$0")/.."

npx wrangler dev --port "$PORT" >"$LOG_FILE" 2>&1 &
WRANGLER_PID=$!
trap 'kill "$WRANGLER_PID" 2>/dev/null || true; rm -f "$LOG_FILE"' EXIT

for _ in $(seq 1 "$READY_TIMEOUT_SECONDS"); do
	if BODY="$(curl -sf "http://127.0.0.1:$PORT/health")"; then
		echo "Worker started: $BODY"
		exit 0
	fi
	if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
		break
	fi
	sleep 1
done

echo "Worker did not serve /health on port $PORT within ${READY_TIMEOUT_SECONDS}s. wrangler output:" >&2
cat "$LOG_FILE" >&2
exit 1
