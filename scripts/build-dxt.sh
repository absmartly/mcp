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

# Create public directory if it doesn't exist
mkdir -p public

# Build the DXT file
echo -e "${BLUE}🔨 Building DXT extension...${NC}"
dxt pack || {
    echo -e "${RED}❌ Failed to build DXT file${NC}"
    exit 1
}

# Check if the DXT file was created
if [ ! -f "absmartly-mcp.dxt" ]; then
    echo -e "${RED}❌ DXT file not found after build${NC}"
    exit 1
fi

# Copy DXT file to public directory for Cloudflare Pages assets
echo -e "${BLUE}📁 Copying DXT file to public directory...${NC}"
cp absmartly-mcp.dxt public/absmartly-mcp.dxt || {
    echo -e "${RED}❌ Failed to copy DXT file to public directory${NC}"
    exit 1
}

echo -e "${GREEN}✅ DXT file built and copied to public directory successfully!${NC}"
echo -e "${GREEN}📥 Download URL: https://mcp.absmartly.com/absmartly-mcp.dxt${NC}"