# ABsmartly API Request Examples

## Authentication Examples

### Using API Key
```bash
curl -X GET "https://sandbox.absmartly.com/v1/experiments" \
  -H "Authorization: Api-Key your-api-key-here" \
  -H "Content-Type: application/json"
```

### Using JWT Token
```bash
curl -X GET "https://sandbox.absmartly.com/v1/experiments" \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json"
```

## Experiment Management

### Create A/B Test
```bash
curl -X POST "https://sandbox.absmartly.com/v1/experiments" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Checkout Flow Optimization",
    "description": "Testing streamlined checkout process",
    "hypothesis": "Reducing checkout steps will increase conversion by 15%",
    "type": "experiment",
    "application_id": 123,
    "unit_type": "session_id",
    "variants": [
      {
        "name": "Control",
        "description": "Current 3-step checkout",
        "config": { "checkout_steps": 3 }
      },
      {
        "name": "Treatment", 
        "description": "New 2-step checkout",
        "config": { "checkout_steps": 2 }
      }
    ],
    "nr_variants": 2,
    "percentages": "50/50"
  }'
```

### Create Feature Flag
```bash
curl -X POST "https://sandbox.absmartly.com/v1/experiments" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dark Mode Feature",
    "description": "Enable dark mode for users",
    "type": "feature",
    "application_id": 123,
    "unit_type": "user_id",
    "variants": [
      {
        "name": "Off",
        "description": "Dark mode disabled", 
        "config": { "dark_mode_enabled": false }
      },
      {
        "name": "On",
        "description": "Dark mode enabled",
        "config": { "dark_mode_enabled": true }
      }
    ],
    "nr_variants": 2,
    "percentages": "85/15"
  }'
```

### Start Experiment
```bash
curl -X PUT "https://sandbox.absmartly.com/v1/experiments/456/start" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json"
```

## Analytics and Reporting

### Get Experiment Results
```bash
curl -X POST "https://sandbox.absmartly.com/v1/experiments/456/metrics/789" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "date_range": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    },
    "confidence_level": 0.95,
    "segments": ["device_type", "traffic_source"]
  }'
```

### Get Experiment Activity
```bash
curl -X GET "https://sandbox.absmartly.com/v1/experiments/456/activity" \
  -H "Authorization: Api-Key your-api-key"
```

## Goal and Metric Management

### Create Conversion Goal
```bash
curl -X POST "https://sandbox.absmartly.com/v1/goals" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Purchase Conversion",
    "description": "Users who complete a purchase",
    "type": "conversion",
    "aggregation": "unique_count",
    "event_name": "purchase_completed",
    "filter_conditions": {
      "revenue": { "operator": ">", "value": 0 }
    }
  }'
```

### Create Revenue Metric
```bash
curl -X POST "https://sandbox.absmartly.com/v1/metrics" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Revenue Per User",
    "description": "Average revenue per converting user",
    "type": "ratio",
    "numerator_event": "purchase_completed",
    "numerator_property": "revenue",
    "denominator_event": "user_converted", 
    "aggregation": "average"
  }'
```

## User and Team Management

### List Users
```bash
curl -X GET "https://sandbox.absmartly.com/v1/users?role=experimenter" \
  -H "Authorization: Api-Key your-api-key"
```

### Create Team
```bash
curl -X POST "https://sandbox.absmartly.com/v1/teams" \
  -H "Authorization: Api-Key your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Growth Team",
    "description": "User acquisition and retention experiments",
    "members": [
      { "user_id": 123, "role": "lead" },
      { "user_id": 456, "role": "member" }
    ]
  }'
```

## Pagination Examples

### List with Pagination
```bash
curl -X GET "https://sandbox.absmartly.com/v1/experiments?page=2&items=50&sort=created_at" \
  -H "Authorization: Api-Key your-api-key"
```

### Search and Filter
```bash
curl -X GET "https://sandbox.absmartly.com/v1/experiments?search=checkout&state=running,development" \
  -H "Authorization: Api-Key your-api-key"
```

## Error Handling Examples

### Check Response Status
```bash
# Save response with status code
curl -w "%{http_code}" -X GET "https://sandbox.absmartly.com/v1/experiments/999" \
  -H "Authorization: Api-Key your-api-key" \
  -o response.json

# Check if request was successful
if [ "$(cat response.json | jq -r '.errors | length')" -eq 0 ]; then
  echo "Success"
else
  echo "Error: $(cat response.json | jq -r '.errors[0]')"
fi
```