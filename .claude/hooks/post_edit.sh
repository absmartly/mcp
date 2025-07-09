#!/bin/bash

# Only deploy if we're editing TypeScript files in the src directory
if [[ "$1" == *"/src/"* && "$1" == *".ts" ]]; then
    echo "🚀 Deploying worker after TypeScript changes..."
    cd /Users/joalves/git_tree/absmartly-mcp
    npx wrangler deploy --compatibility-date=2025-03-10
fi