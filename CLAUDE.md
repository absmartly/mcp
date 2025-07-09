# Claude Code Guidelines

## Path Handling
- **Never hardcode full paths** in scripts, configuration files, or hooks
- Always use relative paths so the code works when the repository is cloned to different locations
- This applies to:
  - Shell scripts
  - Configuration files
  - Hooks (like `.claude/settings.json`)
  - Build commands
  - Deployment scripts

## Deployment
- After making changes to TypeScript files in `/src/`, deploy with: `npx wrangler deploy --compatibility-date=2025-03-10`
- Deployment hooks are configured in `.claude/settings.json` but may need manual triggering

## Project Structure
- `src/` - TypeScript source files
- `wrangler.jsonc` - Cloudflare Workers configuration
- `.claude/` - Claude Code configuration and hooks