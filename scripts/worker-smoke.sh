#!/usr/bin/env bash
# Start a Worker and require /health to answer, cleaning up its process group.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/worker-smoke.mjs
