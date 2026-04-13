# ABsmartly MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that provides full access to the ABsmartly experimentation platform through **3 meta-tools** that expose 208 API methods across 34 categories.

## Architecture

Instead of registering hundreds of individual tools, the server uses a catalog-based approach:

```
discover_api_methods  →  Browse/search the 208-method catalog
get_api_method_docs   →  Get detailed docs for any method
execute_api_method    →  Execute any method by name
get_auth_status       →  Check authentication status
```

All API responses for experiments, metrics, goals, teams, users, and segments are **auto-summarized** to reduce token usage. Use `show`/`exclude` to control experiment fields, or `raw: true` for full responses.

## Quick Start

### Option 1: DXT Extension (Easiest)

1. Download from [mcp.absmartly.com/absmartly-mcp.dxt](https://mcp.absmartly.com/absmartly-mcp.dxt)
2. Double-click to install in Claude Desktop
3. Enter your ABsmartly endpoint when prompted

### Option 2: Remote MCP (Claude Pro/Teams)

Add in Claude Desktop Settings → Remote MCP Servers:
- **URL**: `https://mcp.absmartly.com/sse?absmartly-endpoint=https://your-instance.absmartly.com`
- Complete the OAuth flow when prompted

### Option 3: Local Server (stdio)

Uses the ABsmartly CLI config and macOS Keychain for credentials:

```bash
npx @absmartly/mcp
npx @absmartly/mcp --profile=production
```

Claude Desktop config (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": ["@absmartly/mcp", "--profile=production"]
    }
  }
}
```

### Option 4: Local Bridge (mcp-remote)

Works with any Claude version via the mcp-remote proxy:

```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": [
        "mcp-remote", "https://mcp.absmartly.com/sse",
        "--header", "Authorization:YOUR_API_KEY",
        "--header", "x-absmartly-endpoint:https://your-instance.absmartly.com"
      ]
    }
  }
}
```

### Option 5: Claude Code

#### Using `claude mcp add` (quickest)

**Remote SSE (API key):**
```bash
claude mcp add --transport sse --scope user absmartly \
  https://mcp.absmartly.com/sse \
  -H "Authorization:YOUR_API_KEY" \
  -H "x-absmartly-endpoint:https://your-instance.absmartly.com"
```

**Remote SSE (subdomain shorthand):**
```bash
claude mcp add --transport sse --scope user absmartly \
  https://mcp.absmartly.com/sse \
  -H "Authorization:<your-subdomain> YOUR_API_KEY"
```

This auto-constructs the endpoint as `https://<your-subdomain>.absmartly.com/v1`.

**Local stdio server:**
```bash
claude mcp add --scope user absmartly \
  npx @absmartly/mcp --profile=production
```

Use `--scope project` instead of `--scope user` to limit to the current project.

#### Using `.mcp.json` (project config)

```json
{
  "mcpServers": {
    "absmartly": {
      "type": "sse",
      "url": "https://mcp.absmartly.com/sse",
      "headers": {
        "Authorization": "YOUR_API_KEY",
        "x-absmartly-endpoint": "https://your-instance.absmartly.com"
      }
    }
  }
}
```

Or with the local stdio server:

```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": ["tsx", "/path/to/src/local-server.ts", "--profile=production"]
    }
  }
}
```

## Usage Examples

**Discover what's available:**
```
What ABsmartly operations can you help me with?
```

**List running experiments:**
```
Show me all running experiments
```

**Create an experiment:**
```
Create a new A/B test called "checkout_cta_test" with Control and Blue Button variants
```

**Full lifecycle:**
```
Create an experiment, move it to ready, start it, then show me its details
```

**Feature flags:**
```
Create a feature flag called "dark_mode" and start it
```

## Key Features

### Auto-Summarization

API responses are automatically summarized using the same summarizers as the ABsmartly CLI. Experiment lists return compact rows; single experiments return detailed summaries with links to the web console.

Control with `show`/`exclude` (experiments only):
```json
{ "method_name": "listExperiments", "show": ["experiment_report"], "exclude": ["tags"] }
```

### Custom Fields

When creating experiments, custom fields (Hypothesis, Next Steps, etc.) are **auto-populated** with defaults. Override by name:

```json
{
  "method_name": "createExperiment",
  "params": {
    "data": {
      "name": "my_test",
      "type": "test",
      "custom_fields": { "Hypothesis": "Blue CTA increases conversions by 5%" }
    }
  }
}
```

### Pagination

List methods default to 20 items. Use `limit` for quick control:
```json
{ "method_name": "listExperiments", "limit": 5 }
```

### Argument Completions

Tool parameters (`method_name`, `category`) support auto-completion, helping LLMs discover the right method names.

### Elicitation

Destructive operations (delete, archive) trigger a confirmation prompt via MCP elicitation before executing.

### Resources

| Type | URIs | Description |
|------|------|-------------|
| Entity data | `absmartly://entities/*` | Live cached data for apps, unit types, teams, users, metrics, goals, tags, custom fields |
| Experiment lookup | `absmartly://experiments/{id}` | Fetch and summarize any experiment |
| API docs | `absmartly://docs/*` | API reference documentation |

### Prompts

| Prompt | Description |
|--------|-------------|
| `create-experiment` | Guided experiment creation with full entity context |
| `create-feature-flag` | Simplified feature flag creation |
| `analyze-experiment` | Deep analysis of a specific experiment |
| `experiment-review` | Review all running experiments for issues |

## Authorization Formats

The server supports multiple Authorization header formats:

| Format | Example |
|--------|---------|
| Simple API key | `Authorization: BxYKd1U2...` |
| Explicit Api-Key | `Authorization: Api-Key BxYKd1U2...` |
| Subdomain shorthand | `Authorization: demo-1 BxYKd1U2...` |
| Full domain | `Authorization: demo-1.absmartly.com BxYKd1U2...` |

All formats auto-add `/v1` suffix and strip `Bearer` prefix if present.

## Development

### Prerequisites

- Node.js 18+
- Cloudflare account (for remote deployment)
- ABsmartly account and API key

### Setup

```bash
git clone <repository-url>
cd absmartly-mcp
npm install
```

### Local Development

```bash
npx wrangler dev --port 8787    # Run Worker locally
npx @absmartly/mcp               # Run stdio server
```

### Testing

```bash
npm test                                                    # Unit tests (2977 tests)
node tests/integration/claude-user-experience.test.js       # Natural language UX tests
node tests/integration/claude-tool-discovery.test.js        # Tool-level integration tests
```

### Deployment

```bash
npm run deploy          # Deploy to Cloudflare Workers
npm run build:dxt       # Build DXT extension
```

### Project Structure

```
src/
├── index.ts              # Main Cloudflare Worker (tools, resources, prompts)
├── local-server.ts       # Standalone stdio server for local use
├── api-catalog.ts        # 208-method API catalog with categories
├── fetch-adapter.ts      # HTTP client bridging APIClient to fetch
├── resources.ts          # MCP resources (docs + entity data)
├── absmartly-oauth-handler.ts  # OAuth flow handler
├── shared.ts             # Shared utilities
└── types.ts              # TypeScript types
```

## Documentation

- [MCP Features Reference](docs/mcp-features.md) — Complete reference for tools, resources, prompts, summarization, custom fields, and protocol features
- [OAuth Flow](docs/oauth-flow-diagram.md) — OAuth implementation details

## Security

- No server-side secrets — credentials provided by the MCP client
- Session-based isolation — each connection has its own credentials
- OAuth discovery protection — API key sessions block OAuth endpoints
- Elicitation — destructive actions require user confirmation

## License

MIT License - see LICENSE file for details.
