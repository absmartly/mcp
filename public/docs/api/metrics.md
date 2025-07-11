# Metrics API

## Overview
Metrics are measurements derived from goals that experiments use to determine success. While goals represent raw events, metrics transform those events into measurable data points that can be compared between experiment variants.

## Key Concept: How Metrics Use Goals
- **Goals provide the events**: Raw actions like "purchase", "signup_button_click"
- **Metrics measure the events**: Conversion rates, revenue per user, click-through rates
- **Experiments track metrics**: Not goals directly, but the metrics derived from goals

**Example**: A "purchase" goal can create multiple metrics:
- Purchase conversion rate (goal_ratio metric)
- Revenue per user (goal_count with value aggregation)  
- Purchase count (goal_count metric)

## Endpoints

### List Metrics
`GET /metrics`

**Required Permissions**: `Metric List` or `Metric Admin`

**Parameters**:
- `sort` (string): Sort field (created_at, name, category)
- `page` (integer): Page number
- `items` (integer): Items per page
- `category` (string): Filter by metric category
- `type` (string): Filter by metric type

### Get Metric
`GET /metrics/{metricId}`

Returns detailed metric configuration and recent performance data.

### Create Metric
`POST /metrics`

**Required Permissions**: `Metric Admin`

**Request Body** (Basic goal_ratio example):
```json
{
  "goal_id": 4,
  "name": "Signup Button CTR",
  "description": "Click-through rate for the signup button",
  "type": "goal_ratio",
  "effect": "positive",
  
  // Numerator configuration (goal being measured)
  "numerator_type": "goal_unique_count",
  "value_source_property": "",
  "property_filter": "{\"filter\":{\"and\":[]}}",
  "outlier_limit_method": "unlimited",
  "outlier_limit_lower_arg": null,
  "outlier_limit_upper_arg": null,
  "retention_time": null,
  "retention_time_reference": null,
  
  // Denominator configuration (baseline goal)  
  "denominator_goal_id": 5,
  "denominator_type": "goal_unique_count",
  "denominator_value_source_property": "",
  "denominator_property_filter": "{\"filter\":{\"and\":[]}}",
  "denominator_outlier_limit_method": "unlimited",
  "denominator_outlier_limit_lower_arg": null,
  "denominator_outlier_limit_upper_arg": null,
  "denominator_retention_time": null,
  "denominator_retention_time_reference": null,
  
  // Time filtering (optional)
  "time_filter_earliest": null,
  "time_filter_latest": null,
  "denominator_time_filter_earliest": null,
  "denominator_time_filter_latest": null,
  
  // Cancellation and relations (advanced, usually null)
  "cancellation_foreign_goal_id": null,
  "cancellation_key_path": null,
  "cancellation_foreign_key_path": null,
  "relation_kind": null,
  "relation_foreign_goal_id": null,
  "relation_key_path": null,
  "relation_foreign_key_path": null,
  "relation_foreign_value_path": null,
  "relation_foreign_duplicate_operation": null,
  "relation_refund_operation": null,
  "denominator_cancellation_foreign_goal_id": null,
  "denominator_cancellation_key_path": null,
  "denominator_cancellation_foreign_key_path": null,
  "denominator_relation_kind": null,
  "denominator_relation_foreign_goal_id": null,
  "denominator_relation_key_path": null,
  "denominator_relation_foreign_key_path": null,
  "denominator_relation_foreign_value_path": null,
  "denominator_relation_foreign_duplicate_operation": null,
  "denominator_relation_refund_operation": null,
  
  // Display formatting
  "format_str": "{}",
  "scale": 1,
  "precision": 0,
  "mean_format_str": "{}%",
  "mean_scale": 100,
  "mean_precision": 2,
  
  // Impact alerts (optional)
  "impact_alert_threshold_upper": null,
  "impact_alert_threshold_lower": null,
  
  // Ownership and tags
  "tags": [
    { "metric_tag_id": 10 }
  ],
  "owners": [
    { "user_id": 3 }
  ],
  "teams": [
    { "team_id": 4 }
  ]
}
```

### Goal Ratio Parameters Explained

**Core Configuration:**
- `goal_id`: The numerator goal (what you're measuring)
- `denominator_goal_id`: The denominator goal (your baseline)
- `numerator_type`/`denominator_type`: How to count events (`goal_count`, `goal_unique_count`, `goal_sum`, etc.)

**Property Filtering:**
- `property_filter`/`denominator_property_filter`: JSON filters to include/exclude events based on properties
- `value_source_property`/`denominator_value_source_property`: Property to extract values from (for sum/average)

**Outlier Handling:**
- `outlier_limit_method`: How to handle outliers (`unlimited`, `percentile`, `absolute`)
- `outlier_limit_lower_arg`/`outlier_limit_upper_arg`: Outlier threshold values

**Time Windows:**
- `retention_time`: How long after exposure to count events (e.g., "1d", "7d", "30d")
- `time_filter_earliest`/`time_filter_latest`: Global time filters for the metric

**Advanced Relations:**
- `relation_kind`: For complex relationships between events (`foreign_key`, `session`, etc.)
- `cancellation_*`: For handling refunds/cancellations in revenue metrics

**Display Formatting:**
- `format_str`: How to display individual values (e.g., "{}", "${}") 
- `mean_format_str`: How to display averages (e.g., "{}%")
- `scale`/`mean_scale`: Multiplication factor for display (100 for percentages)
- `precision`/`mean_precision`: Decimal places to show

## Metric Types

### Goal Count Metrics
Count occurrences of a goal event:
```json
{
  "type": "goal_count",
  "goal_id": 4,
  "numerator_type": "goal_count"
}
```

### Goal Ratio Metrics  
Calculate conversion rates between two goals:
```json
{
  "type": "goal_ratio",
  "goal_id": 4,
  "numerator_type": "goal_unique_count",
  "denominator_goal_id": 5,
  "denominator_type": "goal_unique_count"
}
```

### Goal Value Metrics
Aggregate numeric values from goal events:
```json
{
  "type": "goal_value",
  "goal_id": 4,
  "value_source_property": "revenue",
  "numerator_type": "goal_sum"
}
```

## Aggregation Types
- **goal_count**: Total number of goal events
- **goal_unique_count**: Number of unique users who triggered the goal
- **goal_sum**: Sum of numeric property values from goal events
- **goal_average**: Average of numeric property values

## Metric Properties
- **effect**: Whether metric improvement is "positive" or "negative"
- **format_str**: Display format (e.g., "{}%", "${}")
- **scale**: Scaling factor for display (e.g., 100 for percentages)
- **precision**: Number of decimal places
```

### Retention Metrics
Measure user retention over time:
```json
{
  "type": "retention",
  "initial_event": "user_signup",
  "return_event": "session_start", 
  "time_window": "7_days"
}
```

## Experiment Analytics

### Get Experiment Metrics
`POST /experiments/{experimentId}/metrics/{metricId}`

**Request Body**:
```json
{
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "segments": ["device_type", "traffic_source"],
  "confidence_level": 0.95
}
```

**Response**:
```json
{
  "metric": {
    "name": "Conversion Rate",
    "value": 0.1234,
    "unit": "percentage"
  },
  "variants": [
    {
      "id": 0,
      "name": "Control",
      "value": 0.1200,
      "confidence_interval": [0.1150, 0.1250],
      "sample_size": 10000,
      "conversions": 1200
    },
    {
      "id": 1, 
      "name": "Treatment",
      "value": 0.1350,
      "confidence_interval": [0.1300, 0.1400],
      "sample_size": 10000,
      "conversions": 1350,
      "lift": 0.125,
      "significance": 0.023
    }
  ],
  "statistical_analysis": {
    "method": "bayesian",
    "probability_to_win": 0.977,
    "expected_loss": 0.002
  }
}
```

### Get Metric History
`POST /experiments/{experimentId}/metrics/{metricId}/history`

Returns time-series data showing metric performance over time.

## Segmentation

### Available Segments
- **Device Type**: desktop, mobile, tablet
- **Traffic Source**: organic, paid, direct, referral
- **Geography**: country, region, city
- **User Type**: new, returning, premium
- **Custom Properties**: Any event properties

### Segment Analysis
```json
{
  "segments": {
    "device_type": {
      "desktop": {
        "control": { "value": 0.145, "sample_size": 6000 },
        "treatment": { "value": 0.162, "sample_size": 6000 }
      },
      "mobile": {
        "control": { "value": 0.089, "sample_size": 4000 },
        "treatment": { "value": 0.095, "sample_size": 4000 }
      }
    }
  }
}
```

## Statistical Methods

### Bayesian Analysis
- **Advantages**: Intuitive probability interpretation, early stopping
- **Metrics**: Probability to win, expected loss, credible intervals
- **Best For**: Most experiments, especially with business stakeholders

### Frequentist Analysis  
- **Advantages**: Traditional statistical approach, regulatory compliance
- **Metrics**: P-values, confidence intervals, statistical power
- **Best For**: Academic research, regulated industries

### Sequential Testing
- **Advantages**: Early stopping, reduced experiment duration
- **Metrics**: Spending functions, alpha allocation
- **Best For**: High-traffic experiments with clear effects

## Data Quality

### Sample Size Calculations
Before starting experiments:
```json
{
  "baseline_rate": 0.12,
  "minimum_detectable_effect": 0.15,
  "statistical_power": 0.8,
  "significance_level": 0.05,
  "estimated_sample_size": 12500
}
```

### Quality Checks
- **Sample Ratio Mismatch**: Detect traffic allocation issues
- **Novelty Effects**: Monitor for unusual patterns in early days
- **Carryover Effects**: Check for persistent effects after stopping
- **Interaction Effects**: Test for metric correlations

## Best Practices
1. **Metric Selection**: Choose metrics aligned with business objectives
2. **Leading Indicators**: Include both leading and lagging indicators
3. **Segmentation**: Analyze key user segments separately
4. **Multiple Comparisons**: Adjust for multiple testing when needed
5. **Context**: Always interpret results in business context