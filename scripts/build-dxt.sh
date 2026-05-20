#!/bin/bash
set -e

echo "🚀 Building DXT file..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if DXT CLI is installed
if ! command -v dxt &> /dev/null; then
    echo -e "${BLUE}📦 Installing DXT CLI...${NC}"
    npm install -g @anthropic-ai/dxt || {
        echo -e "${RED}❌ Failed to install DXT CLI${NC}"
        exit 1
    }
fi

# Ensure public directory exists (served by Cloudflare Workers Assets)
mkdir -p public

# Build the DXT file directly into the public directory
echo -e "${BLUE}🔨 Building DXT extension into public/...${NC}"
dxt pack . public/absmartly-mcp.dxt || {
    echo -e "${RED}❌ Failed to build DXT file${NC}"
    exit 1
}

# Verify the DXT file was created
if [ ! -f "public/absmartly-mcp.dxt" ]; then
    echo -e "${RED}❌ DXT file not found after build${NC}"
    exit 1
fi

echo -e "${GREEN}✅ DXT file built successfully at public/absmartly-mcp.dxt${NC}"
echo -e "${GREEN}📥 Download URL after deploy: https://mcp.absmartly.com/absmartly-mcp.dxt${NC}"