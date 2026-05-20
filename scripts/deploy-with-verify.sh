#!/bin/bash
# Build + deploy + verify the DXT.
#
# The DXT is bundled into the worker code (not served as a static asset)
# because wrangler's static asset binding is unreliable for newly uploaded
# files (cloudflare/workers-sdk#9157). Embedding makes the served bytes
# part of the worker version, guaranteed to ship atomically.
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

DXT_LOCAL_PATH="dist/absmartly-mcp.dxt"
DXT_PUBLIC_URL="https://mcp.absmartly.com/absmartly-mcp.dxt"
PROPAGATION_WAIT_SECONDS=8
MAX_VERIFY_ATTEMPTS=3

if [ ! -f "$DXT_LOCAL_PATH" ]; then
    echo -e "${RED}❌ Local DXT not found at $DXT_LOCAL_PATH — run build:dxt first${NC}"
    exit 1
fi

LOCAL_SHA=$(shasum "$DXT_LOCAL_PATH" | cut -d' ' -f1)
echo -e "${BLUE}🔐 Local DXT SHA: $LOCAL_SHA${NC}"

echo -e "${BLUE}🚀 Deploying worker (DXT embedded in bundle)${NC}"
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
