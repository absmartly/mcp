#!/bin/bash
# Run wrangler deploy and verify the DXT actually serves with the right SHA.
#
# Background: wrangler sometimes reports a new static asset as "uploaded" but
# the worker version goes live referencing the previous asset manifest, so the
# new file 404s until the next deploy. See cloudflare/workers-sdk#9157.
# This wrapper retries until the live content matches the local build.
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

MAX_ATTEMPTS=3
PROPAGATION_WAIT_SECONDS=5
DXT_LOCAL_PATH="public/absmartly-mcp.dxt"
DXT_PUBLIC_URL="https://mcp.absmartly.com/absmartly-mcp.dxt"

if [ ! -f "$DXT_LOCAL_PATH" ]; then
    echo -e "${RED}❌ Local DXT not found at $DXT_LOCAL_PATH — run build:dxt first${NC}"
    exit 1
fi

LOCAL_SHA=$(shasum "$DXT_LOCAL_PATH" | cut -d' ' -f1)
echo -e "${BLUE}🔐 Local DXT SHA: $LOCAL_SHA${NC}"

for attempt in $(seq 1 $MAX_ATTEMPTS); do
    echo -e "${BLUE}🚀 Deploy attempt $attempt of $MAX_ATTEMPTS${NC}"
    npx wrangler deploy

    echo -e "${BLUE}⏳ Waiting ${PROPAGATION_WAIT_SECONDS}s for edge propagation...${NC}"
    sleep $PROPAGATION_WAIT_SECONDS

    # Cache-bust to avoid hitting a stale edge 404.
    REMOTE_SHA=$(curl -fsS "${DXT_PUBLIC_URL}?cb=$(date +%s)" 2>/dev/null | shasum | cut -d' ' -f1 || echo "fetch_failed")

    if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
        echo -e "${GREEN}✅ DXT live at $DXT_PUBLIC_URL (SHA matches local)${NC}"
        exit 0
    fi

    echo -e "${YELLOW}⚠️  Live SHA mismatch (got: $REMOTE_SHA, expected: $LOCAL_SHA)${NC}"
    if [ $attempt -lt $MAX_ATTEMPTS ]; then
        echo -e "${YELLOW}   Redeploying to work around wrangler asset-manifest bug...${NC}"
    fi
done

echo -e "${RED}❌ DXT still not serving correctly after $MAX_ATTEMPTS attempts${NC}"
echo -e "${RED}   Last live SHA: $REMOTE_SHA${NC}"
echo -e "${RED}   Expected SHA:  $LOCAL_SHA${NC}"
exit 1
