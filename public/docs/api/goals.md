# Goals API

## Overview
Goals represent specific user events or actions that can be tracked and measured. Goals are the foundation for creating metrics that experiments use to measure success. A goal is simply an event definition (like "purchase", "signup", "page_view") that gets transformed into measurable metrics.

## Key Concept: Goals vs Metrics
- **Goals**: Raw events/actions (e.g., "purchase_completed", "signup_button_click")  
- **Metrics**: Measurements derived from goals (e.g., "Purchase conversion rate", "Signup CTR")
- **Experiments**: Use metrics (not goals directly) to measure performance

## Endpoints

### List Goals
`GET /goals`

**Required Permissions**: `Goal List` or `Goal Admin`

**Parameters**:
- `sort` (string): Sort field (created_at, name, etc.)
- `page` (integer): Page number (default: 1)
- `items` (integer): Items per page (default: 1500)
- `search` (string): Search goals by name or description

### Get Goal
`GET /goals/{goalId}`

Returns detailed goal information including configuration and usage.

### Create Goal
`POST /goals`

**Required Permissions**: `Goal Admin`

**Request Body**:
```json
{
  "name": "purchase",
  "description": "A user made a purchase",
  "tags": [
    { "goal_tag_id": 36 }
  ],
  "owners": [
    { "user_id": 3 }
  ],
  "teams": [
    { "team_id": 4 }
  ]
}
```

### Update Goal
`PUT /goals/{goalId}`

**Required Permissions**: `Goal Admin`

Updates goal configuration. Changes may affect ongoing experiments.

### Delete Goal
`DELETE /goals/{goalId}`

**Required Permissions**: `Goal Admin`

Soft deletes the goal. Cannot delete goals used in active experiments.

## Goal Types

### Conversion Goals
- **Purpose**: Track binary events (did/didn't convert)
- **Aggregation**: `unique_count` or `count`
- **Example**: Sign-ups, purchases, downloads

### Revenue Goals  
- **Purpose**: Track monetary value
- **Aggregation**: `sum`, `average`, `median`
- **Example**: Revenue per user, average order value

### Engagement Goals
- **Purpose**: Track user behavior metrics
- **Aggregation**: `count`, `average`, `sum`
- **Example**: Page views, time on site, clicks

### Custom Goals
- **Purpose**: Track custom metrics
- **Aggregation**: Depends on metric type
- **Example**: NPS score, custom events

## Goal Configuration

### Event Filtering
Filter events based on properties:
```json
{
  "filter_conditions": {
    "revenue": { "operator": ">=", "value": 10 },
    "category": { "operator": "in", "value": ["electronics", "books"] },
    "user_type": { "operator": "=", "value": "premium" }
  }
}
```

### Aggregation Methods
- `count`: Total number of events
- `unique_count`: Unique users who triggered event
- `sum`: Sum of numeric property values
- `average`: Average of numeric property values
- `median`: Median of numeric property values

### Time Windows
Goals can be configured with time windows:
- `immediate`: Event must occur immediately 
- `session`: Event must occur within same session
- `1_day`: Event must occur within 1 day
- `7_days`: Event must occur within 7 days
- `30_days`: Event must occur within 30 days

## Goal Tags
Organize goals with tags:
```json
{
  "tags": ["ecommerce", "mobile", "high-priority"]
}
```

## Usage in Experiments
Goals are attached to experiments to measure success:
```json
{
  "primary_goals": [123, 456],    // Primary metrics to optimize
  "secondary_goals": [789, 101],  // Additional metrics to monitor  
  "guardrail_goals": [111, 222]   // Metrics that shouldn't degrade
}
```

## Statistical Analysis
Metrics support two statistical methods:
- **Frequentist**: Traditional hypothesis testing with p-values
- **Sequential**: Continuous monitoring with early stopping rules

## Best Practices
1. **Clear Definition**: Goals should have unambiguous definitions
2. **Primary vs Secondary**: Limit primary goals to 1-3 most important metrics
3. **Guardrails**: Always include guardrail metrics to catch negative effects
4. **Naming**: Use descriptive names that explain what's being measured
5. **Documentation**: Include clear descriptions for team understanding