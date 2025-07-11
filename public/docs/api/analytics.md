# Analytics API

## Overview
The Analytics API provides deep insights into experiment performance, statistical analysis, and business impact.

## Experiment Analytics

### Get Experiment Metrics
`POST /experiments/{experimentId}/metrics/{metricId}`

Analyze metric performance across variants.

### Get Participants History
`POST /experiments/{experimentId}/participants/history`

Track participant enrollment over time.

### Get Metric History
`POST /experiments/{experimentId}/metrics/{metricId}/history`

View metric performance trends.

## Statistical Analysis

### Bayesian Analysis
Returns probability-based insights:
```json
{
  "method": "bayesian",
  "results": {
    "probability_to_beat_control": 0.89,
    "expected_loss": 0.002,
    "credible_interval": [0.125, 0.145],
    "risk_assessment": "low"
  }
}
```

### Frequentist Analysis
Traditional hypothesis testing:
```json
{
  "method": "frequentist", 
  "results": {
    "p_value": 0.023,
    "confidence_interval": [0.121, 0.149],
    "statistical_power": 0.85,
    "effect_size": 0.15
  }
}
```

## Segmentation Analysis

### Segment Performance
Analyze results by user segments:
```json
{
  "segments": {
    "device_type": {
      "mobile": {
        "sample_size": 5000,
        "conversion_rate": 0.142,
        "lift": 0.18,
        "significance": 0.012
      },
      "desktop": {
        "sample_size": 3000,
        "conversion_rate": 0.156,
        "lift": 0.12,
        "significance": 0.045
      }
    }
  }
}
```

### Custom Segments
Create custom segments for analysis:
```json
{
  "custom_segments": [
    {
      "name": "high_value_users",
      "definition": {
        "revenue_30d": { "operator": ">", "value": 100 }
      }
    }
  ]
}
```

## Insights API

### Summary Insights
`GET /insights/summary`

High-level dashboard metrics:
```json
{
  "active_experiments": 12,
  "significant_wins": 8,
  "estimated_revenue_impact": 125000,
  "total_users_in_experiments": 450000
}
```

### Velocity Insights
`GET /insights/velocity/widgets`

Team productivity metrics:
```json
{
  "experiments_launched": {
    "this_month": 15,
    "last_month": 12,
    "growth": 0.25
  },
  "average_experiment_duration": 21,
  "time_to_significance": 14
}
```

### Decision Insights
`GET /insights/decisions/widgets`

Decision-making analytics:
```json
{
  "decision_timeline": {
    "average_days": 28,
    "median_days": 21
  },
  "decision_outcomes": {
    "implement": 0.45,
    "discard": 0.35, 
    "iterate": 0.20
  }
}
```

## Reporting

### Automated Reports
Configure automated experiment reports:
```json
{
  "report_config": {
    "frequency": "weekly",
    "recipients": ["team@company.com"],
    "include_metrics": ["conversion_rate", "revenue"],
    "format": "pdf"
  }
}
```

### Custom Dashboards
Create custom analytics dashboards:
```json
{
  "dashboard": {
    "name": "Growth Team Dashboard",
    "widgets": [
      {
        "type": "experiment_performance",
        "filters": { "team_id": 123 }
      },
      {
        "type": "conversion_trends", 
        "date_range": "30_days"
      }
    ]
  }
}
```

## Data Export

### Export Experiment Data
`GET /experiments/{experimentId}/export`

Export raw experiment data:
- CSV format for analysis
- Includes all events and conversions
- Configurable date ranges

### Export Analytics
`POST /analytics/export`

Export aggregated analytics:
```json
{
  "export_type": "experiment_summary",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "format": "csv",
  "include_segments": true
}
```

## Statistical Methods

### Sample Size Calculation
Calculate required sample sizes:
```json
{
  "baseline_rate": 0.12,
  "minimum_detectable_effect": 0.15,
  "statistical_power": 0.8,
  "significance_level": 0.05,
  "required_sample_size": 12500,
  "estimated_duration_days": 28
}
```

### Power Analysis
Analyze statistical power:
```json
{
  "current_sample_size": 8000,
  "observed_effect": 0.08,
  "statistical_power": 0.65,
  "days_to_target_power": 12
}
```

### Multiple Comparisons
Handle multiple testing:
```json
{
  "correction_method": "bonferroni",
  "family_wise_error_rate": 0.05,
  "adjusted_p_values": [0.003, 0.045, 0.089]
}
```

## Real-Time Analytics

### Live Experiment Monitoring
Monitor experiments in real-time:
```json
{
  "live_metrics": {
    "participants_today": 1250,
    "conversion_rate_control": 0.121,
    "conversion_rate_treatment": 0.134,
    "current_significance": 0.078
  }
}
```

### Alerts and Notifications
Set up experiment alerts:
```json
{
  "alerts": [
    {
      "metric": "conversion_rate",
      "condition": "significance < 0.05",
      "notification": "slack"
    },
    {
      "metric": "sample_ratio_mismatch",
      "condition": "p_value < 0.01",
      "notification": "email"
    }
  ]
}
```

## Best Practices

### Statistical Rigor
1. **Pre-register Hypotheses**: Define success metrics before starting
2. **Adequate Sample Size**: Calculate and wait for sufficient data
3. **Multiple Comparisons**: Adjust for multiple testing when needed
4. **Practical Significance**: Consider business impact, not just statistical significance

### Analysis Workflow
1. **Continuous Monitoring**: Check for data quality issues
2. **Segmentation Analysis**: Understand different user behaviors
3. **Context Consideration**: Interpret results with business context
4. **Decision Documentation**: Record decisions and rationale