# ABsmartly MCP Server Features

## 1. Architecture Overview

The ABsmartly MCP server exposes the entire ABsmartly API (208 methods across 32 categories) through **3 meta-tools** plus 1 status tool, rather than registering 200+ individual MCP tools.

```
discover_api_methods  -->  Browse/search the 208-method catalog
get_api_method_docs   -->  Get detailed docs for a specific method
execute_api_method    -->  Call any method by name
get_auth_status       -->  Check authentication and connection info
```

On initialization, the server:

1. Authenticates via API key or OAuth JWT
2. Fetches all entities in parallel (applications, unit types, users, teams, metrics, goals, tags, custom fields)
3. Caches entities in KV (Cloudflare Workers) with a configurable TTL
4. Registers tools, resources, and prompts
5. Auto-summarizes API responses to reduce token usage

---

## 2. Tools Reference

### get_auth_status

Check the current authentication state and user identity.

**Parameters:** none

**Example response:**
```
Authenticated with API access

Email: user@company.com
Name: Jane Doe
Endpoint: https://your-instance.absmartly.com
Authentication Type: API Key
API Access: Available
```

If any entity fetches failed during initialization, warnings are appended.

---

### discover_api_methods

Browse or search the full API catalog.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| category | string | No | Filter by category (e.g. `experiments`, `metrics`, `teams`) |
| search | string | No | Keyword search across method names, descriptions, and categories |

**Behavior:**

- **No params:** Returns a summary of all 32 categories with method counts and names.
- **With `category`:** Returns detailed docs for every method in that category.
- **With `search`:** Returns methods matching the keyword.

**Available categories:** experiments, experiment-metrics, experiment-notes, experiment-alerts, scheduled-actions, experiment-access, goals, segments, metrics, metric-review, metric-access, metric-categories, teams, users, applications, environments, unit-types, tags, roles, webhooks, annotations, insights, api-keys, cors, datasources, export-configs, update-schedules, custom-sections, notifications, follow-favorite, platform-config, asset-roles, access-control-policies, resolve-helpers

**Example:**
```json
{ "category": "experiments" }
```

---

### get_api_method_docs

Get detailed documentation for a single API method.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| method_name | string | Yes | Exact method name (e.g. `createMetric`, `listTeamMembers`) |

**Behavior:**

- Returns parameter table, return type, example payload, and a ready-to-use `execute_api_method` snippet.
- If the method is not found, suggests similar methods.
- For `createExperiment`, appends the available custom fields table.

**Example:**
```json
{ "method_name": "createExperiment" }
```

---

### execute_api_method

Execute any API method from the catalog.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| method_name | string | Yes | Method name from the catalog (supports auto-completion) |
| params | object | No | Method parameters as key-value pairs |
| show | string[] | No | Extra fields to include in experiment summaries |
| exclude | string[] | No | Fields to remove from experiment summaries |
| raw | boolean | No | Return full unsummarized response (default: false) |
| limit | number | No | Max items for list operations (default: 20) |

**Special behaviors:**

- **Auto-summarization:** Responses for experiments, metrics, goals, teams, users, and segments are automatically summarized to reduce token usage (see Section 5).
- **show/exclude:** Only applies to experiment methods. Use `show: ["experiment_report", "audience"]` to include normally-hidden fields, or `exclude: ["owners", "tags"]` to strip fields.
- **raw mode:** Pass `raw: true` to bypass all summarization and get the full API response.
- **Custom fields auto-population:** When calling `createExperiment`, custom fields are automatically populated with defaults (see Section 6).
- **Pagination defaults:** List methods default to 20 items per page. Use `limit` to override, or pass `items`/`page` directly in `params`.
- **Experiment links:** Summarized experiment results include a `link` field with a direct URL to the ABsmartly web console.
- **Destructive methods:** Methods like `deleteExperiment`, `stopExperiment` are marked as dangerous. The server uses MCP elicitation to confirm before executing (see Section 8).

**Example -- list 5 running experiments:**
```json
{
  "method_name": "listExperiments",
  "params": { "options": { "state": "running" } },
  "limit": 5,
  "show": ["experiment_report"]
}
```

**Example -- get raw experiment data:**
```json
{
  "method_name": "getExperiment",
  "params": { "id": 42 },
  "raw": true
}

```
**Example -- create experiment with custom fields:**
```json
{
  "method_name": "createExperiment",
  "params": {
    "data": {
      "name": "checkout_cta_test",
      "type": "test",
      "state": "created",
      "custom_fields": {
        "Hypothesis": "A green CTA will increase checkout rate by 5%"
      }
    }
  }
}
```

---

## 3. Resources

### Static Documentation Resources

Served from bundled markdown files under `/docs/api/`. The endpoint URL and custom fields are injected dynamically.

| URI | Description |
|-----|-------------|
| `absmartly://docs/api` | General API docs and authentication guide |
| `absmartly://docs/experiments` | Experiment management endpoints |
| `absmartly://docs/goals` | Goal definition and management |
| `absmartly://docs/metrics` | Custom metrics and measurement |
| `absmartly://docs/applications` | Application and environment management |
| `absmartly://docs/users-teams` | User management and team collaboration |
| `absmartly://docs/analytics` | Experiment analytics and reporting |
| `absmartly://docs/segments` | Audience segmentation and targeting |
| `absmartly://examples/api-requests` | Common API request examples and patterns |

### Dynamic Entity Resources

Populated at initialization from the live API, returned as JSON.

| URI | Description |
|-----|-------------|
| `absmartly://entities/applications` | Cached applications list |
| `absmartly://entities/unit-types` | Cached unit types list |
| `absmartly://entities/teams` | Cached teams list |
| `absmartly://entities/users` | Cached users (summarized: id, name, email) |
| `absmartly://entities/metrics` | Cached metrics list |
| `absmartly://entities/goals` | Cached goals list |
| `absmartly://entities/tags` | Cached experiment tags |
| `absmartly://entities/custom-fields` | Custom fields with title, type, default value, section type |

### Resource Template

| Template | Description |
|----------|-------------|
| `absmartly://experiments/{id}` | Fetch and summarize a specific experiment by ID |

The template accepts a numeric experiment ID and returns the summarized experiment object.

---

## 4. Prompts

### experiment-status

Quick overview of all running experiments with key metrics and performance. No arguments.

### create-experiment

Create a new A/B test with all required fields pre-populated.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| name | string | Yes | Experiment name (snake_case recommended) |
| type | string | No | `test` or `feature` (default: `test`) |

The prompt injects the full entity context (applications, unit types, metrics, teams, custom fields) so the LLM can use valid IDs.

### create-feature-flag

Create a feature flag (type=feature) with off/on variants.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| name | string | Yes | Feature flag name (snake_case recommended) |

### analyze-experiment

Fetch and analyze a specific experiment.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| id | string | Yes | Experiment ID to analyze |

Instructs the LLM to check state, alerts (SRM, audience mismatch, sample size), traffic split, report metrics, and provide actionable recommendations.

### experiment-review

Review all running experiments and identify ones needing attention. No arguments. Checks for SRM alerts, audience mismatches, sample size reached, assignment conflicts, and long-running experiments.

---

## 5. Auto-Summarization

API responses are automatically summarized to keep LLM context windows manageable. Each entity type has two summarizers: one for list rows and one for single-entity detail views.

### Experiments

| Method type | Summarizer | Notes |
|-------------|------------|-------|
| `listExperiments`, `searchExperiments` | `summarizeExperimentRow` | Compact row per experiment |
| `getExperiment`, `createExperiment`, `updateExperiment`, `startExperiment`, `stopExperiment`, `developmentExperiment`, `restartExperiment`, `fullOnExperiment` | `summarizeExperiment` | Detailed single-experiment view |

**show/exclude control (experiments only):**

- `show`: Array of field names to add to the summary (e.g. `["experiment_report", "audience", "archived"]`).
- `exclude`: Array of field names to strip from the summary (e.g. `["owners", "tags", "teams"]`).

### Other Entity Types

| Entity | List summarizer | Detail summarizer |
|--------|-----------------|-------------------|
| Metrics | `summarizeMetricRow` | `summarizeMetric` |
| Goals | `summarizeGoalRow` | `summarizeGoal` |
| Teams | `summarizeTeamRow` | `summarizeTeam` |
| Users | `summarizeUserRow` | `summarizeUserDetail` |
| Segments | `summarizeSegmentRow` | `summarizeSegment` |

### Bypassing Summarization

Pass `raw: true` to `execute_api_method` to get the full, unmodified API response.

---

## 6. Custom Fields

### Auto-Discovery

On initialization, the server fetches all custom section fields via `listCustomSectionFields()`. These are cached alongside other entities.

### Auto-Population on Experiment Creation

When `execute_api_method` is called with `createExperiment`, the server automatically:

1. Reads the experiment `type` (test or feature) from the data payload.
2. Finds all non-archived custom fields whose `custom_section.type` matches the experiment type.
3. Populates each field with its `default_value`.
4. For fields of type `user`, auto-fills with the current authenticated user's ID.
5. Writes the result to `custom_section_field_values` on the experiment data.

This only triggers if `custom_section_field_values` is empty or missing.

### Overriding by Name

To set specific custom field values, pass a `custom_fields` object (keyed by field name) inside `params.data`:

```json
{
  "method_name": "createExperiment",
  "params": {
    "data": {
      "name": "my_experiment",
      "type": "test",
      "custom_fields": {
        "Hypothesis": "Changing the CTA color will increase conversions",
        "Ticket Link": "https://jira.example.com/PROJ-123"
      }
    }
  }
}
```

The server resolves field names to their numeric IDs, merges with defaults, and removes `custom_fields` from the payload before sending to the API.

### User-Type Fields

Fields with `type: "user"` are automatically set to `{ selected: [{ userId: <currentUserId> }] }` when the authenticated user's ID is known.

---

## 7. Deployment Modes

### Remote (Cloudflare Workers)

- Deployed as a Cloudflare Worker with `npm run deploy`.
- MCP endpoint: `https://mcp.absmartly.com/sse`
- **OAuth authentication:** Public client registration (PKCE) for Claude Desktop and similar MCP clients. Redirects through ABsmartly SAML for user authentication.
- **API key authentication:** Pass `x-absmartly-api-key` and `x-absmartly-endpoint` headers. OAuth discovery is automatically blocked for API key sessions to prevent clients from falling into the OAuth flow.
- Entity caching uses Cloudflare KV (`OAUTH_KV` namespace).
- Health check: `GET /health`

### Local (stdio)

A standalone Node.js server using `StdioServerTransport` for local use with Claude Desktop and other MCP clients.

**Run:**
```bash
npx @absmartly/mcp
npx @absmartly/mcp --profile=test-1
```

**Config:** Reads from the ABsmartly CLI config:
- Endpoint: `~/.config/absmartly/config.yaml` (profile's `api.endpoint`)
- API key: macOS Keychain (`absmartly-cli` service, `api-key-{profile}` account)

**Claude Desktop config (`claude_desktop_config.json`):**
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

**Features:** Same 4 tools, 8 entity resources, 5 prompts, auto-summarization, custom fields, elicitation, and argument completions as the remote server. No KV caching (entities fetched fresh each session).

### Local Development (wrangler)

For developing the remote server locally:
```bash
npx wrangler dev --port 8787
```

---

## 8. MCP Protocol Features

### Tool Annotations

Tools declare hints for MCP clients:

| Tool | readOnlyHint | destructiveHint |
|------|-------------|-----------------|
| `get_auth_status` | true | - |
| `discover_api_methods` | true | - |
| `get_api_method_docs` | true | - |
| `execute_api_method` | - | true |

`execute_api_method` is marked destructive because it can call write/delete methods. Individual methods in the catalog have a `dangerous: boolean` flag for additional client-side warnings.

### Argument Completions

Tool parameters support auto-completion for faster input:

| Tool | Parameter | Completes with |
|------|-----------|---------------|
| `discover_api_methods` | `category` | API category names (34 categories) |
| `get_api_method_docs` | `method_name` | All 208 method names, filtered by substring |
| `execute_api_method` | `method_name` | Same as above |

Completions are limited to 20 results and match case-insensitively.

### Elicitation for Destructive Actions

Before executing methods marked as `dangerous` in the catalog (e.g. `deleteExperiment`, `deleteMetric`), the server uses MCP elicitation to prompt the user for confirmation. The user must type "yes" to proceed.

If the MCP client doesn't support elicitation, the action proceeds without confirmation (graceful fallback).

### listChanged Notifications

When the entity cache is refreshed, the server sends `notifications/resources/list_changed` so clients can re-read dynamic entity resources with fresh data.

### Resource Subscriptions

Declared via `capabilities.resources.subscribe = true`. Clients can subscribe to entity resource URIs and receive update notifications when entities change.

### Observability (sendLoggingMessage)

Key events are forwarded to the MCP client via `sendLoggingMessage`:

| Level | Event |
|-------|-------|
| `info` | Authentication success |
| `info` | Entity cache refresh (with counts) |
| `debug` | Using cached entities |
| `error` | API method execution failures |
| `info` | Destructive action cancelled via elicitation |

### Capabilities

The server declares:

```json
{
  "tools": {},
  "resources": { "subscribe": true, "listChanged": true },
  "prompts": {}
}
```

### Entity Caching and Freshness

Entities are cached in KV with a TTL. When the cache expires, fresh data is fetched on the next initialization. The KV entry TTL is set to the cache TTL plus a 60-second grace period. After a refresh, `sendResourceListChanged()` notifies subscribed clients.
