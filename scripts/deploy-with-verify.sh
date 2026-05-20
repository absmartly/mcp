#!/bin/bash
# Build + deploy + verify the DXT, working around a wrangler asset bug.
#
# Observed bug (cloudflare/workers-sdk#9157 and related):
#   On a single `wrangler deploy`, new static assets are uploaded but the new
#   worker version is published with the PREVIOUS asset manifest. The asset
#   survives briefly in edge cache, then evicts to 404 after a few minutes.
#   A second `wrangler deploy` creates a fresh worker version that DOES
#   reference the uploaded assets, fixing the issue permanently.
#
# Workaround: always deploy twice when assets changed, then verify the live
# bytes match the local build. Fail the deploy if they don't.
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

DXT_LOCAL_PATH="public/absmartly-mcp.dxt"
DXT_PUBLIC_URL="https://mcp.absmartly.com/absmartly-mcp.dxt"
PROPAGATION_WAIT_SECONDS=8
MAX_VERIFY_ATTEMPTS=3

if [ ! -f "$DXT_LOCAL_PATH" ]; then
    echo -e "${RED}❌ Local DXT not found at $DXT_LOCAL_PATH — run build:dxt first${NC}"
    exit 1
fi

LOCAL_SHA=$(shasum "$DXT_LOCAL_PATH" | cut -d' ' -f1)
echo -e "${BLUE}🔐 Local DXT SHA: $LOCAL_SHA${NC}"

echo -e "${BLUE}🚀 Deploy 1/2 — uploads any changed static assets${NC}"
npx wrangler deploy

echo -e "${BLUE}⏳ Waiting ${PROPAGATION_WAIT_SECONDS}s before second deploy...${NC}"
sleep $PROPAGATION_WAIT_SECONDS

echo -e "${BLUE}🚀 Deploy 2/2 — ensures the worker version references the uploaded assets${NC}"
npx wrangler deploy

echo -e "${BLUE}⏳ Waiting ${PROPAGATION_WAIT_SECONDS}s for edge propagation...${NC}"
sleep $PROPAGATION_WAIT_SECONDS

for attempt in $(seq 1 $MAX_VERIFY_ATTEMPTS); do
    REMOTE_SHA=$(curl -fsS "${DXT_PUBLIC_URL}?cb=$(date +%s%N)" 2>/dev/null | shasum | cut -d' ' -f1 || echo "fetch_failed")

    if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
        echo -e "${GREEN}✅ DXT live at $DXT_PUBLIC_URL (SHA matches local build)${NC}"
        exit 0
    fi

    echo -e "${YELLOW}⚠️  Verify attempt $attempt/$MAX_VERIFY_ATTEMPTS: live SHA $REMOTE_SHA != local $LOCAL_SHA${NC}"
    sleep $PROPAGATION_WAIT_SECONDS
done

echo -e "${RED}❌ DXT verification failed after $MAX_VERIFY_ATTEMPTS attempts — manual inspection required${NC}"
exit 1
