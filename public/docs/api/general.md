# ABsmartly API Documentation

## MCP Server Tools

This server exposes the ABsmartly API through 4 tools:

- **discover_commands** — Browse command groups or search by keyword
- **get_command_docs** — Get detailed parameter docs for any command
- **execute_command** — Execute any command by group and name with auto-summarization
- **get_auth_status** — Check authentication status

Use `discover_commands` first to find the right group and command, then `execute_command` to call it. To create experiments, use `execute_command` with group "experiments" and command "createExperimentFromTemplate".

## Auto-Summarization

Results for experiments, metrics, goals, teams, users, and segments are auto-summarized. Use `show` to include extra fields, `exclude` to hide fields, or `raw: true` for full responses.

## Pagination

List methods return 20 items by default. Use `limit` to control, or pass `items`/`page` in the method params.

## Custom Fields

When creating experiments, custom fields are auto-populated with defaults. Override by passing `custom_fields` by name in the data object.

## Base URL
{{ABSMARTLY_ENDPOINT}}

## Authentication

### API Key Authentication
- Pass API key in an HTTP header as `Authorization: Api-Key <key>`
- Used for server-to-server communication
- Full access to all endpoints

### JWT Token Authentication (OAuth)
- Pass JWT as `Authorization: Bearer <token>` header
- Used for user-authenticated requests
- Access based on user permissions

## Response Format
All API responses follow this structure:
```json
{
  "ok": true,
  "data": { ... },
  "errors": [ ... ]
}
```

## Error Codes
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `422` - Unprocessable Entity (business logic errors)
- `500` - Internal Server Error

## Rate Limiting
- 1000 requests per minute per API key
- Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Custom Fields
Custom fields can be configured per organization to extend experiment metadata. Available fields for this instance:

{{CUSTOM_FIELDS}}
