# Segments API

## Overview
Segments allow you to define and target specific user groups for experiments, enabling precise audience control and analysis.

## Endpoints

### List Segments
`GET /segments`

**Required Permissions**: `Segment List` or `Segment Admin`

### Create Segment
`POST /segments`

**Required Permissions**: `Segment Admin`

**Request Body**:
```json
{
  "name": "Premium Mobile Users",
  "description": "Premium subscribers using mobile devices",
  "definition": {
    "operator": "and",
    "conditions": [
      {
        "property": "subscription_tier",
        "operator": "equals",
        "value": "premium"
      },
      {
        "property": "device_type", 
        "operator": "equals",
        "value": "mobile"
      }
    ]
  },
  "tags": ["mobile", "premium"]
}
```

## Segment Definition

### Condition Operators
- `equals`: Exact match
- `not_equals`: Not equal to
- `in`: Value in list
- `not_in`: Value not in list
- `greater_than`: Numeric greater than
- `less_than`: Numeric less than
- `contains`: String contains substring
- `starts_with`: String starts with
- `ends_with`: String ends with
- `regex`: Regular expression match

### Logical Operators
- `and`: All conditions must be true
- `or`: Any condition must be true
- `not`: Negate the condition group

### Complex Segments
Create nested logical conditions:
```json
{
  "definition": {
    "operator": "and",
    "conditions": [
      {
        "property": "country",
        "operator": "in",
        "value": ["US", "CA", "GB"]
      },
      {
        "operator": "or",
        "conditions": [
          {
            "property": "subscription_tier",
            "operator": "equals", 
            "value": "premium"
          },
          {
            "property": "lifetime_revenue",
            "operator": "greater_than",
            "value": 500
          }
        ]
      }
    ]
  }
}
```

## Property Types

### User Properties
- `user_id`: Unique user identifier
- `email`: User email address
- `subscription_tier`: Subscription level
- `registration_date`: Account creation date
- `lifetime_revenue`: Total revenue from user

### Device Properties
- `device_type`: mobile, desktop, tablet
- `operating_system`: iOS, Android, Windows, macOS
- `browser`: Chrome, Safari, Firefox, Edge
- `screen_resolution`: Screen dimensions

### Geographic Properties
- `country`: ISO country code
- `region`: State/province
- `city`: City name
- `timezone`: User timezone

### Behavioral Properties
- `last_login_date`: Last activity date
- `session_count`: Total number of sessions
- `page_views`: Total page views
- `feature_usage`: Specific feature usage

## Dynamic Segments

### Time-Based Segments
Segments that change over time:
```json
{
  "definition": {
    "operator": "and",
    "conditions": [
      {
        "property": "last_login_date",
        "operator": "greater_than",
        "value": "30_days_ago"
      },
      {
        "property": "session_count",
        "operator": "greater_than", 
        "value": 5
      }
    ]
  }
}
```

### Cohort Segments
User cohorts based on acquisition date:
```json
{
  "definition": {
    "operator": "and",
    "conditions": [
      {
        "property": "registration_date",
        "operator": "between",
        "value": ["2024-01-01", "2024-01-31"]
      }
    ]
  }
}
```

## Segment Usage

### Experiment Targeting
Use segments to target experiments:
```json
{
  "experiment": {
    "name": "Premium Feature Test",
    "target_segments": ["premium_users", "power_users"],
    "exclude_segments": ["new_users"]
  }
}
```

### A/A Testing
Validate segments with A/A tests:
```json
{
  "aa_test": {
    "segment": "mobile_users",
    "expected_split": [0.5, 0.5],
    "tolerance": 0.02
  }
}
```

### Performance Analysis
Analyze segment performance:
```json
{
  "segment_performance": {
    "segment_id": 123,
    "conversion_rate": 0.145,
    "sample_size": 15000,
    "revenue_per_user": 45.67
  }
}
```

## Segment Quality

### Size Estimation
Estimate segment size:
```json
{
  "segment_size": {
    "estimated_users": 25000,
    "percentage_of_total": 0.12,
    "daily_new_users": 450
  }
}
```

### Stability Analysis
Monitor segment stability:
```json
{
  "stability_metrics": {
    "daily_variance": 0.02,
    "weekly_trend": 0.05,
    "stability_score": 0.95
  }
}
```

### Overlap Analysis
Analyze segment overlaps:
```json
{
  "overlap_analysis": {
    "segment_a": "premium_users",
    "segment_b": "mobile_users", 
    "overlap_size": 5000,
    "overlap_percentage": 0.25
  }
}
```

## Predefined Segments

### Standard Segments
Common segments available by default:
- `new_users`: Users registered in last 30 days
- `returning_users`: Users with multiple sessions
- `mobile_users`: Users on mobile devices
- `desktop_users`: Users on desktop devices
- `high_value_users`: Users with high lifetime value

### Geo Segments
Geographic segments:
- `us_users`: Users in United States
- `eu_users`: Users in European Union
- `apac_users`: Users in Asia-Pacific region

## Segment Management

### Segment Lifecycle
1. **Creation**: Define segment criteria
2. **Validation**: Test segment size and quality
3. **Activation**: Use in experiments
4. **Monitoring**: Track performance and stability
5. **Optimization**: Refine criteria based on results

### Version Control
Track segment definition changes:
```json
{
  "version_history": [
    {
      "version": 1,
      "created_date": "2024-01-01",
      "definition": { ... },
      "created_by": "user@company.com"
    }
  ]
}
```

## Best Practices

### Segment Design
1. **Clear Purpose**: Define why the segment exists
2. **Actionable Criteria**: Use criteria you can act upon
3. **Stable Definitions**: Avoid frequently changing criteria
4. **Adequate Size**: Ensure segments are large enough for experiments

### Performance Optimization
1. **Index Properties**: Index frequently used properties
2. **Cache Results**: Cache segment membership
3. **Batch Updates**: Update segments in batches
4. **Monitor Performance**: Track segment evaluation time