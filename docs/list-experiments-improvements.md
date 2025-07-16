# List Experiments Tool Improvements

## Summary

I've successfully improved the `list_experiments` tool to support all filtering parameters from the ABsmartly API and added a link field to each experiment in the response.

## Changes Made

### 1. Updated list_experiments Tool Schema (index.ts:312-356)

Added all parameters from the OpenAPI specification:
- **Basic query parameters**: search, sort, page, items
- **Filter by experiment attributes**: state, significance, owners, teams, tags, templates, applications, unit_types
- **Range filters**: impact, created_at, updated_at, full_on_at
- **Boolean filters**: sample_ratio_mismatch, cleanup_needed, audience_mismatch, sample_size_reached, experiments_interact, group_sequential_updated, assignment_conflict, metric_threshold_reached, previews
- **String filters**: analysis_type, type
- **Number filters**: iterations

### 2. Updated Request Handler (index.ts:368-408)

Modified the handler to pass all parameters to the API client's listExperiments method.

### 3. Added Link Field to Response (index.ts:419-441)

- Extracts the base URL from the configured endpoint by removing the `/v1` suffix
- Adds a `link` field to each experiment with format: `https://{absmartly_endpoint_without_v1}/experiments/{experiment_id}`
- Returns the full experiment data as JSON including pagination info

### 4. Updated SimpleMCPServer (simple-mcp.ts)

- Updated constructor to accept an optional endpoint parameter (line 13)
- Updated the list_experiments tool definition to include all parameters
- Modified the response handler to add link fields to experiments

### 5. Updated Standalone Script (standalone.ts)

Added support for `ABSMARTLY_ENDPOINT` environment variable to configure the endpoint.

## Response Format

The updated list_experiments tool now returns:
```json
{
  "total": 150,
  "page": 1,
  "items": 10,
  "experiments": [
    {
      "id": 123,
      "name": "experiment-name",
      "state": "running",
      // ... other experiment fields
      "link": "https://app.absmartly.com/experiments/123"
    }
  ]
}
```

## Usage Examples

```javascript
// Basic search
list_experiments({ search: "checkout", page: 1, items: 20 })

// Filter by state and significance
list_experiments({ 
  state: "running,development", 
  significance: "positive,negative" 
})

// Filter by date range (timestamps in milliseconds)
list_experiments({ 
  created_at: "1740873600000,1742515199999",
  state: "running"
})

// Complex filtering
list_experiments({
  applications: "39,3",
  teams: "1,2",
  sample_size_reached: 1,
  type: "test"
})
```

## Note

The TypeScript compilation shows some unrelated errors in the oauth handler that were pre-existing and not caused by these changes. The list_experiments functionality improvements are complete and ready to use.