# Experiments API

## Overview
The Experiments API allows you to create, manage, and analyze A/B tests and feature flags.

## Endpoints

### List Experiments
`GET /experiments`

**Required Permissions**: `Experiment List` or `Experiment Admin`

**Parameters**:
- `search` (string): Search experiments by name or description
- `sort` (string): Sort field (created_at, name, state, etc.)
- `page` (integer): Page number (default: 1)
- `items` (integer): Items per page (default: 1500, max: 1500)
- `state` (array): Filter by states (created, ready, running, development, full_on, stopped, archived, scheduled)
- `significance` (boolean): Filter by statistical significance
- `application_id` (integer): Filter by application
- `owner_id` (integer): Filter by owner
- `team_id` (integer): Filter by team

**Example**:
```bash
GET /experiments?state=running,development&items=50&sort=created_at
```

### Get Experiment
`GET /experiments/{experimentId}`

**Required Permissions**: `Experiment List` or `Experiment Admin`

Returns detailed experiment information including variants, metrics, and custom fields.

### Create Experiment
`POST /experiments`

**Required Permissions**: `Experiment Admin`

**Request Body**:
```json
{
  "name": "Checkout Flow Test",
  "description": "Testing new checkout flow design",
  "hypothesis": "New design will increase conversion by 15%",
  "type": "experiment",
  "application_id": 123,
  "owner_id": 456,
  "team_id": 789,
  "unit_type": "session_id",
  "variants": [
    {
      "name": "Control",
      "description": "Current checkout flow",
      "config": { "checkout_version": "v1" }
    },
    {
      "name": "Treatment", 
      "description": "New streamlined flow",
      "config": { "checkout_version": "v2" }
    }
  ],
  "nr_variants": 2,
  "percentages": "50/50"
}
```

### Update Experiment
`PUT /experiments/{experimentId}`

**Required Permissions**: `Experiment Admin`

Updates experiment configuration. Cannot change certain fields while experiment is running.

## Experiment States

### State Transitions
- `draft` → `ready` → `running` → `stopped`
- `draft` → `development` (for testing)
- `running` → `full_on` (100% traffic to winning variant)

### State Management Endpoints
- `PUT /experiments/{id}/start` - Start experiment (ready → running)
- `PUT /experiments/{id}/stop` - Stop experiment (running → stopped)  
- `PUT /experiments/{id}/restart` - Restart stopped experiment
- `PUT /experiments/{id}/full_on` - Set to full_on state
- `PUT /experiments/{id}/development` - Set to development state

## Feature Flags
Feature flags are experiments with `type: "feature"` and On/Off variants:

```json
{
  "name": "Dark Mode Feature",
  "type": "feature",
  "variants": [
    { "name": "Off", "config": { "enabled": false } },
    { "name": "On", "config": { "enabled": true } }
  ]
}
```

## Analytics Endpoints

### Get Experiment Metrics
`POST /experiments/{experimentId}/metrics/{metricId}`

Returns statistical analysis for a specific metric.

### Get Experiment Activity
`GET /experiments/{experimentId}/activity`

Returns activity log including comments and state changes.

### Add Experiment Comment  
`POST /experiments/{experimentId}/activity`

Add a comment to the experiment activity log.

## Custom Fields
Experiments support custom fields defined in your organization for additional metadata and context.

## Best Practices
1. **Naming**: Use descriptive names that indicate the test purpose
2. **Hypothesis**: Always include a clear, measurable hypothesis
3. **Sample Size**: Calculate required sample size before starting
4. **Duration**: Run tests for full business cycles (include weekends)
5. **Segmentation**: Consider user segments that might respond differently