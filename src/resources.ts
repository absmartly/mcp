/**
 * MCP Resources for ABsmartly API Documentation
 * 
 * This file contains all the documentation resources that are exposed via MCP.
 * Each resource provides detailed documentation for specific API endpoint groups.
 */

import type { ABsmartlyMCP } from './index';
import { readFileSync } from 'fs';
import { join } from 'path';

export class ABsmartlyResources {
    constructor(private mcpServer: ABsmartlyMCP) {}

    /**
     * Read markdown file from public/docs/api directory
     */
    private readMarkdownFile(filename: string): string {
        try {
            const filePath = join(process.cwd(), 'public', 'docs', 'api', filename);
            return readFileSync(filePath, 'utf-8');
        } catch (error) {
            console.error(`Error reading markdown file ${filename}:`, error);
            return `# Error\n\nCould not load documentation for ${filename}`;
        }
    }

    /**
     * Register all documentation resources
     */
    setupResources() {
        console.log("📚 Setting up documentation resources");
        
        // General API Documentation
        this.setupGeneralApiDocs();
        
        // Experiments API Documentation
        this.setupExperimentsApiDocs();
        
        // Goals API Documentation  
        this.setupGoalsApiDocs();
        
        // Metrics API Documentation
        this.setupMetricsApiDocs();
        
        // Applications API Documentation
        this.setupApplicationsApiDocs();
        
        // Users & Teams API Documentation
        this.setupUsersTeamsApiDocs();
        
        // Analytics API Documentation
        this.setupAnalyticsApiDocs();
        
        // Segments API Documentation
        this.setupSegmentsApiDocs();
        
        // Templates and Examples
        this.setupTemplatesAndExamples();
    }

    private setupGeneralApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/api",
            "text/markdown",
            {
                name: "ABsmartly API Documentation",
                description: "General API documentation and authentication guide"
            },
            async () => {
                let content = this.readMarkdownFile('general.md');
                
                // Replace placeholder URL with actual endpoint if available
                if (this.mcpServer.props?.absmartly_endpoint) {
                    content = content.replace(
                        'https://sandbox.absmartly.com/v1',
                        this.mcpServer.props.absmartly_endpoint
                    );
                }
                
                // Add custom fields information if available
                if (this.mcpServer.customFields?.length) {
                    const customFieldsInfo = `\n\n### Available Custom Fields\n${this.mcpServer.customFields.map(f => `- **${f.name}** (${f.type}): ${f.description || 'No description'}`).join('\n')}`;
                    content = content.replace(
                        'Custom fields can be configured per organization to extend experiment metadata and provide additional context for analysis.',
                        `Custom fields can be configured per organization to extend experiment metadata and provide additional context for analysis.${customFieldsInfo}`
                    );
                }
                
                return { text: content };
            }
        );
    }

    private setupExperimentsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/experiments",
            "text/markdown", 
            {
                name: "Experiments API Documentation",
                description: "Complete documentation for experiment management endpoints"
            },
            async () => {
                let content = this.readMarkdownFile('experiments.md');
                
                // Add custom fields information if available
                if (this.mcpServer.customFields?.length) {
                    const customFieldsInfo = `\n\n### Available Custom Fields\n${this.mcpServer.customFields.map(f => `- **${f.name}** (${f.type}): ${f.description || 'No description'}`).join('\n')}`;
                    content = content.replace(
                        'Experiments support custom fields defined in your organization for additional metadata and context.',
                        `Experiments support custom fields defined in your organization for additional metadata and context.${customFieldsInfo}`
                    );
                }
                
                return { text: content };
            }
        );
    }

    private setupGoalsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/goals",
            "text/markdown",
            {
                name: "Goals API Documentation", 
                description: "Documentation for goal definition and management"
            },
            async () => {
                return {
                    text: this.readMarkdownFile('goals.md')
                };
            }
        );
    }

    private setupMetricsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/metrics",
            "text/markdown",
            {
                name: "Metrics API Documentation",
                description: "Documentation for custom metrics and measurement"
            },
            async () => {
                return {
                    text: this.readMarkdownFile('metrics.md') || `## Key Concept: How Metrics Use Goals
- **Goals provide the events**: Raw actions like "purchase", "signup_button_click"
- **Metrics measure the events**: Conversion rates, revenue per user, click-through rates
- **Experiments track metrics**: Not goals directly, but the metrics derived from goals

**Example**: A "purchase" goal can create multiple metrics:
- Purchase conversion rate (goal_ratio metric)
- Revenue per user (goal_count with value aggregation)  
- Purchase count (goal_count metric)

## Endpoints

### List Metrics
\`GET /metrics\`

**Required Permissions**: \`Metric List\` or \`Metric Admin\`

**Parameters**:
- \`sort\` (string): Sort field (created_at, name, category)
- \`page\` (integer): Page number
- \`items\` (integer): Items per page
- \`category\` (string): Filter by metric category
- \`type\` (string): Filter by metric type

### Get Metric
\`GET /metrics/{metricId}\`

Returns detailed metric configuration and recent performance data.

### Create Metric
\`POST /metrics\`

**Required Permissions**: \`Metric Admin\`

**Request Body** (Basic goal_ratio example):
\\\`\\\`\\\`json
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
\\\`\\\`\\\`

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
\\\`\\\`\\\`json
{
  "type": "goal_count",
  "goal_id": 4,
  "numerator_type": "goal_count"
}
\\\`\\\`\\\`

### Goal Ratio Metrics  
Calculate conversion rates between two goals:
\\\`\\\`\\\`json
{
  "type": "goal_ratio",
  "goal_id": 4,
  "numerator_type": "goal_unique_count",
  "denominator_goal_id": 5,
  "denominator_type": "goal_unique_count"
}
\\\`\\\`\\\`

### Goal Value Metrics
Aggregate numeric values from goal events:
\\\`\\\`\\\`json
{
  "type": "goal_value",
  "goal_id": 4,
  "value_source_property": "revenue",
  "numerator_type": "goal_sum"
}
\\\`\\\`\\\`

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
\`\`\`

### Retention Metrics
Measure user retention over time:
\`\`\`json
{
  "type": "retention",
  "initial_event": "user_signup",
  "return_event": "session_start", 
  "time_window": "7_days"
}
\`\`\`

## Experiment Analytics

### Get Experiment Metrics
\`POST /experiments/{experimentId}/metrics/{metricId}\`

**Request Body**:
\`\`\`json
{
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "segments": ["device_type", "traffic_source"],
  "confidence_level": 0.95
}
\`\`\`

**Response**:
\`\`\`json
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
\`\`\`

### Get Metric History
\`POST /experiments/{experimentId}/metrics/{metricId}/history\`

Returns time-series data showing metric performance over time.

## Segmentation

### Available Segments
- **Device Type**: desktop, mobile, tablet
- **Traffic Source**: organic, paid, direct, referral
- **Geography**: country, region, city
- **User Type**: new, returning, premium
- **Custom Properties**: Any event properties

### Segment Analysis
\`\`\`json
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
\`\`\`

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
\`\`\`json
{
  "baseline_rate": 0.12,
  "minimum_detectable_effect": 0.15,
  "statistical_power": 0.8,
  "significance_level": 0.05,
  "estimated_sample_size": 12500
}
\`\`\`

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
`
                };
            }
        );
    }

    private setupApplicationsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/applications",
            "text/markdown",
            {
                name: "Applications API Documentation",
                description: "Documentation for application and environment management"
            },
            async () => {
                return {
                    text: `# Applications API

## Overview
Applications represent different products, services, or environments where experiments run. They provide isolation and organization for your experiments.

## Endpoints

### List Applications
\`GET /applications\`

**Required Permissions**: \`Application List\` or \`Application Admin\`

**Parameters**:
- \`search\` (string): Search by application name
- \`page\` (integer): Page number
- \`items\` (integer): Items per page
- \`environment\` (string): Filter by environment

### Get Application
\`GET /applications/{applicationId}\`

Returns detailed application information including configuration and statistics.

### Create Application
\`POST /applications\`

**Required Permissions**: \`Application Admin\`

**Request Body**:
\`\`\`json
{
  "name": "Mobile App - iOS",
  "description": "iOS mobile application",
  "environment": "production",
  "settings": {
    "sdk_version": "2.1.0",
    "refresh_interval": 60,
    "timeout": 5000,
    "event_logger": "console"
  },
  "units": [
    {
      "type": "session_id",
      "description": "Unique session identifier"
    },
    {
      "type": "user_id", 
      "description": "Authenticated user identifier"
    }
  ]
}
\`\`\`

### Update Application
\`PUT /applications/{applicationId}\`

**Required Permissions**: \`Application Admin\`

Updates application configuration and settings.

### Archive Application
\`PUT /applications/{applicationId}/archive\`

**Required Permissions**: \`Application Admin\`

Archives or unarchives an application. Archived applications cannot run new experiments.

## Application Configuration

### Environments
Applications can be configured for different environments:
- \`development\`: For testing and development
- \`staging\`: For pre-production testing
- \`production\`: For live user experiments

### SDK Settings
Configure SDK behavior per application:
\`\`\`json
{
  "settings": {
    "refresh_interval": 60,        // Context refresh interval (seconds)
    "timeout": 5000,               // Network timeout (milliseconds)
    "event_logger": "datadog",     // Event logging destination
    "cache_size": 1000,            // Local cache size
    "offline_mode": true,          // Support offline operation
    "debug_mode": false            // Enable debug logging
  }
}
\`\`\`

### Unit Types
Define how users are identified:
\`\`\`json
{
  "units": [
    {
      "type": "session_id",
      "description": "Browser session identifier",
      "required": true
    },
    {
      "type": "user_id",
      "description": "Authenticated user ID", 
      "required": false
    },
    {
      "type": "device_id",
      "description": "Device fingerprint",
      "required": false
    }
  ]
}
\`\`\`

## Context Configuration

### Context Variables
Define variables available to experiments:
\`\`\`json
{
  "context_variables": [
    {
      "name": "country",
      "type": "string",
      "description": "User's country code"
    },
    {
      "name": "subscription_tier", 
      "type": "string",
      "enum": ["free", "premium", "enterprise"]
    },
    {
      "name": "account_age_days",
      "type": "number",
      "description": "Days since account creation"
    }
  ]
}
\\\`\\\`\\\`

### Default Context
Set default values for context variables:
\\\`\\\`\\\`json
{
  "default_context": {
    "country": "US",
    "subscription_tier": "free",
    "account_age_days": 0
  }
}
\\\`\\\`\\\`

## Integration

### SDK Integration
Each application gets unique SDK configuration:
\\\`\\\`\\\`javascript
// JavaScript SDK
const absmartly = new ABSmartly({
  endpoint: "https://sandbox.absmartly.com/v1",
  apiKey: "your-api-key",
  application: "mobile-app-ios",
  environment: "production"
});
\\\`\\\`\\\`

### Event Tracking
Configure event tracking per application:
\`\`\`json
{
  "event_tracking": {
    "enabled": true,
    "endpoints": [
      {
        "name": "analytics",
        "url": "https://analytics.example.com/events",
        "format": "json"
      }
    ],
    "batching": {
      "enabled": true,
      "batch_size": 100,
      "flush_interval": 30
    }
  }
}
\`\`\`

## Application Statistics

### Get Application Stats
\`GET /applications/{applicationId}/stats\`

Returns usage statistics:
\`\`\`json
{
  "active_experiments": 12,
  "total_experiments": 156,
  "monthly_requests": 2500000,
  "monthly_events": 850000,
  "unique_users": 125000,
  "last_activity": "2024-01-15T10:30:00Z"
}
\`\`\`

### Performance Metrics
- **Request Latency**: Average API response time
- **Event Volume**: Number of events tracked per day
- **Error Rate**: Percentage of failed requests
- **Cache Hit Rate**: Percentage of cached responses

## Best Practices

### Application Design
1. **Separation**: Use separate applications for different products
2. **Environments**: Maintain separate dev/staging/prod applications
3. **Naming**: Use consistent, descriptive naming conventions
4. **Documentation**: Document purpose and configuration

### Configuration Management
1. **Version Control**: Track configuration changes
2. **Gradual Rollout**: Test configuration changes gradually
3. **Monitoring**: Monitor application health and performance
4. **Backup**: Maintain configuration backups

### Security
1. **API Keys**: Rotate API keys regularly
2. **Access Control**: Limit access to production applications
3. **Audit Logs**: Monitor configuration changes
4. **Encryption**: Use HTTPS for all communications
`
                };
            }
        );
    }

    private setupUsersTeamsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/users-teams",
            "text/markdown",
            {
                name: "Users & Teams API Documentation",
                description: "Documentation for user management and team collaboration"
            },
            async () => {
                return {
                    text: `# Users & Teams API

## Overview
Manage users, teams, and permissions for collaborative experiment management.

## Users API

### List Users
\`GET /users\`

**Required Permissions**: \`User List\` or \`User Admin\`

**Parameters**:
- \`search\` (string): Search by name or email
- \`role\` (string): Filter by role
- \`team_id\` (integer): Filter by team membership
- \`status\` (string): active, inactive, pending

### Get User
\`GET /users/{userId}\`

Returns user profile, permissions, and team memberships.

### Create User
\`POST /users\`

**Required Permissions**: \`User Admin\`

**Request Body**:
\`\`\`json
{
  "first_name": "John",
  "last_name": "Doe", 
  "email": "john.doe@company.com",
  "role": "experimenter",
  "teams": [123, 456],
  "permissions": ["experiment_list", "experiment_create"],
  "send_invitation": true
}
\`\`\`

## Teams API

### List Teams
\`GET /teams\`

**Required Permissions**: \`Team List\` or \`Team Admin\`

### Create Team
\`POST /teams\`

**Required Permissions**: \`Team Admin\`

**Request Body**:
\`\`\`json
{
  "name": "Growth Team",
  "description": "Focused on user acquisition and retention",
  "members": [
    {
      "user_id": 123,
      "role": "lead"
    },
    {
      "user_id": 456, 
      "role": "member"
    }
  ],
  "permissions": ["experiment_admin", "goal_admin"]
}
\`\`\`

## User Roles

### Admin
- Full access to all features
- User and team management
- System configuration

### Experimenter
- Create and manage experiments
- View all experiments and results
- Manage goals and metrics

### Analyst
- View experiments and results
- Create reports and analyses
- No experiment modification

### Viewer
- Read-only access to experiments
- View results and reports
- No creation or modification

## Permissions System

### Experiment Permissions
- \`experiment_list\`: View experiments
- \`experiment_admin\`: Full experiment management
- \`experiment_create\`: Create new experiments
- \`experiment_edit\`: Edit existing experiments
- \`experiment_delete\`: Delete experiments

### Goal & Metric Permissions
- \`goal_list\`: View goals
- \`goal_admin\`: Manage goals
- \`metric_list\`: View metrics
- \`metric_admin\`: Manage metrics

### Administrative Permissions
- \`user_admin\`: Manage users
- \`team_admin\`: Manage teams
- \`application_admin\`: Manage applications
- \`system_admin\`: System configuration

## Team Collaboration

### Experiment Ownership
Experiments can be owned by users or teams:
\`\`\`json
{
  "owner_id": 123,        // Individual owner
  "team_id": 456,         // Team ownership
  "collaborators": [789]  // Additional collaborators
}
\`\`\`

### Team Permissions
Teams inherit permissions that apply to all members:
- Team permissions override individual permissions
- Users can be members of multiple teams
- Team leads have additional privileges

### Notification Settings
Configure team notifications:
\`\`\`json
{
  "notifications": {
    "experiment_started": true,
    "experiment_stopped": true,
    "significant_results": true,
    "weekly_summary": false
  },
  "channels": ["email", "slack"]
}
\`\`\`

## Access Control

### Resource-Level Permissions
Control access to specific resources:
\`\`\`json
{
  "applications": [123, 456],  // Accessible applications
  "experiments": [789, 101],   // Specific experiment access
  "teams": [222]               // Team-based access
}
\`\`\`

### IP Restrictions
Restrict access by IP address:
\`\`\`json
{
  "ip_whitelist": [
    "192.168.1.0/24",
    "10.0.0.1"
  ]
}
\`\`\`

## Authentication

### Single Sign-On (SSO)
Configure SSO integration:
\`\`\`json
{
  "sso": {
    "provider": "okta",
    "domain": "company.okta.com",
    "auto_provision": true,
    "default_role": "viewer"
  }
}
\`\`\`

### API Keys
Users can generate personal API keys:
- Limited to user's permissions
- Can be scoped to specific applications
- Support expiration dates

## Audit Logging

### User Activity
Track user actions:
\`\`\`json
{
  "user_id": 123,
  "action": "experiment_created",
  "resource_type": "experiment",
  "resource_id": 456,
  "timestamp": "2024-01-15T10:30:00Z",
  "ip_address": "192.168.1.100"
}
\`\`\`

### Permission Changes
Log permission modifications:
- Role changes
- Team membership updates
- Permission grants/revokes

## Best Practices

### User Management
1. **Principle of Least Privilege**: Grant minimum necessary permissions
2. **Regular Reviews**: Audit user permissions periodically
3. **Offboarding**: Remove access promptly when users leave
4. **Strong Authentication**: Require strong passwords/2FA

### Team Organization
1. **Clear Ownership**: Assign clear experiment ownership
2. **Team Structure**: Align teams with business structure
3. **Communication**: Set up appropriate notification channels
4. **Documentation**: Document team responsibilities
`
                };
            }
        );
    }

    private setupAnalyticsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/analytics",
            "text/markdown",
            {
                name: "Analytics API Documentation", 
                description: "Documentation for experiment analytics and reporting"
            },
            async () => {
                return {
                    text: `# Analytics API

## Overview
The Analytics API provides deep insights into experiment performance, statistical analysis, and business impact.

## Experiment Analytics

### Get Experiment Metrics
\`POST /experiments/{experimentId}/metrics/{metricId}\`

Analyze metric performance across variants.

### Get Participants History
\`POST /experiments/{experimentId}/participants/history\`

Track participant enrollment over time.

### Get Metric History
\`POST /experiments/{experimentId}/metrics/{metricId}/history\`

View metric performance trends.

## Statistical Analysis

### Bayesian Analysis
Returns probability-based insights:
\`\`\`json
{
  "method": "bayesian",
  "results": {
    "probability_to_beat_control": 0.89,
    "expected_loss": 0.002,
    "credible_interval": [0.125, 0.145],
    "risk_assessment": "low"
  }
}
\`\`\`

### Frequentist Analysis
Traditional hypothesis testing:
\`\`\`json
{
  "method": "frequentist", 
  "results": {
    "p_value": 0.023,
    "confidence_interval": [0.121, 0.149],
    "statistical_power": 0.85,
    "effect_size": 0.15
  }
}
\`\`\`

## Segmentation Analysis

### Segment Performance
Analyze results by user segments:
\`\`\`json
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
\`\`\`

### Custom Segments
Create custom segments for analysis:
\`\`\`json
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
\`\`\`

## Insights API

### Summary Insights
\`GET /insights/summary\`

High-level dashboard metrics:
\`\`\`json
{
  "active_experiments": 12,
  "significant_wins": 8,
  "estimated_revenue_impact": 125000,
  "total_users_in_experiments": 450000
}
\`\`\`

### Velocity Insights
\`GET /insights/velocity/widgets\`

Team productivity metrics:
\`\`\`json
{
  "experiments_launched": {
    "this_month": 15,
    "last_month": 12,
    "growth": 0.25
  },
  "average_experiment_duration": 21,
  "time_to_significance": 14
}
\`\`\`

### Decision Insights
\`GET /insights/decisions/widgets\`

Decision-making analytics:
\`\`\`json
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
\`\`\`

## Reporting

### Automated Reports
Configure automated experiment reports:
\`\`\`json
{
  "report_config": {
    "frequency": "weekly",
    "recipients": ["team@company.com"],
    "include_metrics": ["conversion_rate", "revenue"],
    "format": "pdf"
  }
}
\`\`\`

### Custom Dashboards
Create custom analytics dashboards:
\`\`\`json
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
\`\`\`

## Data Export

### Export Experiment Data
\`GET /experiments/{experimentId}/export\`

Export raw experiment data:
- CSV format for analysis
- Includes all events and conversions
- Configurable date ranges

### Export Analytics
\`POST /analytics/export\`

Export aggregated analytics:
\`\`\`json
{
  "export_type": "experiment_summary",
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  },
  "format": "csv",
  "include_segments": true
}
\`\`\`

## Statistical Methods

### Sample Size Calculation
Calculate required sample sizes:
\`\`\`json
{
  "baseline_rate": 0.12,
  "minimum_detectable_effect": 0.15,
  "statistical_power": 0.8,
  "significance_level": 0.05,
  "required_sample_size": 12500,
  "estimated_duration_days": 28
}
\`\`\`

### Power Analysis
Analyze statistical power:
\`\`\`json
{
  "current_sample_size": 8000,
  "observed_effect": 0.08,
  "statistical_power": 0.65,
  "days_to_target_power": 12
}
\`\`\`

### Multiple Comparisons
Handle multiple testing:
\`\`\`json
{
  "correction_method": "bonferroni",
  "family_wise_error_rate": 0.05,
  "adjusted_p_values": [0.003, 0.045, 0.089]
}
\`\`\`

## Real-Time Analytics

### Live Experiment Monitoring
Monitor experiments in real-time:
\`\`\`json
{
  "live_metrics": {
    "participants_today": 1250,
    "conversion_rate_control": 0.121,
    "conversion_rate_treatment": 0.134,
    "current_significance": 0.078
  }
}
\`\`\`

### Alerts and Notifications
Set up experiment alerts:
\`\`\`json
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
\`\`\`

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
`
                };
            }
        );
    }

    private setupSegmentsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/segments",
            "text/markdown",
            {
                name: "Segments API Documentation",
                description: "Documentation for audience segmentation and targeting"
            },
            async () => {
                return {
                    text: `# Segments API

## Overview
Segments allow you to define and target specific user groups for experiments, enabling precise audience control and analysis.

## Endpoints

### List Segments
\`GET /segments\`

**Required Permissions**: \`Segment List\` or \`Segment Admin\`

### Create Segment
\`POST /segments\`

**Required Permissions**: \`Segment Admin\`

**Request Body**:
\`\`\`json
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
\`\`\`

## Segment Definition

### Condition Operators
- \`equals\`: Exact match
- \`not_equals\`: Not equal to
- \`in\`: Value in list
- \`not_in\`: Value not in list
- \`greater_than\`: Numeric greater than
- \`less_than\`: Numeric less than
- \`contains\`: String contains substring
- \`starts_with\`: String starts with
- \`ends_with\`: String ends with
- \`regex\`: Regular expression match

### Logical Operators
- \`and\`: All conditions must be true
- \`or\`: Any condition must be true
- \`not\`: Negate the condition group

### Complex Segments
Create nested logical conditions:
\`\`\`json
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
\`\`\`

## Property Types

### User Properties
- \`user_id\`: Unique user identifier
- \`email\`: User email address
- \`subscription_tier\`: Subscription level
- \`registration_date\`: Account creation date
- \`lifetime_revenue\`: Total revenue from user

### Device Properties
- \`device_type\`: mobile, desktop, tablet
- \`operating_system\`: iOS, Android, Windows, macOS
- \`browser\`: Chrome, Safari, Firefox, Edge
- \`screen_resolution\`: Screen dimensions

### Geographic Properties
- \`country\`: ISO country code
- \`region\`: State/province
- \`city\`: City name
- \`timezone\`: User timezone

### Behavioral Properties
- \`last_login_date\`: Last activity date
- \`session_count\`: Total number of sessions
- \`page_views\`: Total page views
- \`feature_usage\`: Specific feature usage

## Dynamic Segments

### Time-Based Segments
Segments that change over time:
\`\`\`json
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
\`\`\`

### Cohort Segments
User cohorts based on acquisition date:
\`\`\`json
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
\`\`\`

## Segment Usage

### Experiment Targeting
Use segments to target experiments:
\`\`\`json
{
  "experiment": {
    "name": "Premium Feature Test",
    "target_segments": ["premium_users", "power_users"],
    "exclude_segments": ["new_users"]
  }
}
\`\`\`

### A/A Testing
Validate segments with A/A tests:
\`\`\`json
{
  "aa_test": {
    "segment": "mobile_users",
    "expected_split": [0.5, 0.5],
    "tolerance": 0.02
  }
}
\`\`\`

### Performance Analysis
Analyze segment performance:
\`\`\`json
{
  "segment_performance": {
    "segment_id": 123,
    "conversion_rate": 0.145,
    "sample_size": 15000,
    "revenue_per_user": 45.67
  }
}
\`\`\`

## Segment Quality

### Size Estimation
Estimate segment size:
\`\`\`json
{
  "segment_size": {
    "estimated_users": 25000,
    "percentage_of_total": 0.12,
    "daily_new_users": 450
  }
}
\`\`\`

### Stability Analysis
Monitor segment stability:
\`\`\`json
{
  "stability_metrics": {
    "daily_variance": 0.02,
    "weekly_trend": 0.05,
    "stability_score": 0.95
  }
}
\`\`\`

### Overlap Analysis
Analyze segment overlaps:
\`\`\`json
{
  "overlap_analysis": {
    "segment_a": "premium_users",
    "segment_b": "mobile_users", 
    "overlap_size": 5000,
    "overlap_percentage": 0.25
  }
}
\`\`\`

## Predefined Segments

### Standard Segments
Common segments available by default:
- \`new_users\`: Users registered in last 30 days
- \`returning_users\`: Users with multiple sessions
- \`mobile_users\`: Users on mobile devices
- \`desktop_users\`: Users on desktop devices
- \`high_value_users\`: Users with high lifetime value

### Geo Segments
Geographic segments:
- \`us_users\`: Users in United States
- \`eu_users\`: Users in European Union
- \`apac_users\`: Users in Asia-Pacific region

## Segment Management

### Segment Lifecycle
1. **Creation**: Define segment criteria
2. **Validation**: Test segment size and quality
3. **Activation**: Use in experiments
4. **Monitoring**: Track performance and stability
5. **Optimization**: Refine criteria based on results

### Version Control
Track segment definition changes:
\`\`\`json
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
\`\`\`

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
`
                };
            }
        );
    }

    private setupTemplatesAndExamples() {
        this.mcpServer.server.resource(
            "absmartly://templates/experiment",
            "application/json",
            {
                name: "Experiment Template",
                description: "Template for creating new experiments with custom fields"
            },
            async () => {
                const template = {
                    state: "ready",
                    name: "my_new_experiment",
                    display_name: "My New Experiment",
                    iteration: 1,
                    percentage_of_traffic: 100,
                    unit_type: {
                        unit_type_id: 1
                    },
                    nr_variants: 2,
                    percentages: "50/50",
                    audience: '{"filter":[{"and":[]}]}',
                    audience_strict: true,
                    owners: [
                        { user_id: 3 }
                    ],
                    teams: [],
                    experiment_tags: [],
                    applications: [
                        {
                            application_id: 1,
                            application_version: "0"
                        }
                    ],
                    primary_metric: {
                        metric_id: 4
                    },
                    secondary_metrics: [],
                    custom_fields: this.mcpServer.customFields?.reduce((acc, field) => {
                        acc[field.name] = field.type === 'boolean' ? false : '';
                        return acc;
                    }, {} as any) || {}
                };
                
                return {
                    text: JSON.stringify(template, null, 2)
                };
            }
        );

        this.mcpServer.server.resource(
            "absmartly://templates/feature-flag",
            "application/json", 
            {
                name: "Feature Flag Template",
                description: "Template for creating feature flags"
            },
            async () => {
                const template = {
                    state: "ready",
                    name: "my_new_feature_flag",
                    display_name: "My New Feature Flag",
                    iteration: 1,
                    type: "feature",
                    percentage_of_traffic: 100,
                    unit_type: {
                        unit_type_id: 1
                    },
                    nr_variants: 2,
                    percentages: "90/10",
                    audience: '{"filter":[{"and":[]}]}',
                    audience_strict: true,
                    owners: [
                        { user_id: 3 }
                    ],
                    teams: [],
                    experiment_tags: [],
                    applications: [
                        {
                            application_id: 1,
                            application_version: "0"
                        }
                    ],
                    primary_metric: {
                        metric_id: 4
                    },
                    secondary_metrics: []
                };
                
                return {
                    text: JSON.stringify(template, null, 2)
                };
            }
        );

        this.mcpServer.server.resource(
            "absmartly://examples/api-requests",
            "text/markdown",
            {
                name: "API Request Examples",
                description: "Common API request examples and patterns"
            },
            async () => {
                return {
                    text: `# ABsmartly API Request Examples

## Authentication Examples

### Using API Key
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments" \\
  -H "Authorization: Api-Key your-api-key-here" \\
  -H "Content-Type: application/json"
\`\`\`

### Using JWT Token
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments" \\
  -H "Authorization: Bearer your-jwt-token" \\
  -H "Content-Type: application/json"
\`\`\`

## Experiment Management

### Create A/B Test
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
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
\`\`\`

### Create Feature Flag
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
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
\`\`\`

### Start Experiment
\`\`\`bash
curl -X PUT "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments/456/start" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json"
\`\`\`

## Analytics and Reporting

### Get Experiment Results
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments/456/metrics/789" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "date_range": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    },
    "confidence_level": 0.95,
    "segments": ["device_type", "traffic_source"]
  }'
\`\`\`

### Get Experiment Activity
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments/456/activity" \\
  -H "Authorization: Api-Key your-api-key"
\`\`\`

## Goal and Metric Management

### Create Conversion Goal
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/goals" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
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
\`\`\`

### Create Revenue Metric
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/metrics" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Revenue Per User",
    "description": "Average revenue per converting user",
    "type": "ratio",
    "numerator_event": "purchase_completed",
    "numerator_property": "revenue",
    "denominator_event": "user_converted", 
    "aggregation": "average"
  }'
\`\`\`

## User and Team Management

### List Users
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/users?role=experimenter" \\
  -H "Authorization: Api-Key your-api-key"
\`\`\`

### Create Team
\`\`\`bash
curl -X POST "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/teams" \\
  -H "Authorization: Api-Key your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Growth Team",
    "description": "User acquisition and retention experiments",
    "members": [
      { "user_id": 123, "role": "lead" },
      { "user_id": 456, "role": "member" }
    ]
  }'
\`\`\`

## Pagination Examples

### List with Pagination
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments?page=2&items=50&sort=created_at" \\
  -H "Authorization: Api-Key your-api-key"
\`\`\`

### Search and Filter
\`\`\`bash
curl -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments?search=checkout&state=running,development" \\
  -H "Authorization: Api-Key your-api-key"
\`\`\`

## Error Handling Examples

### Check Response Status
\`\`\`bash
# Save response with status code
curl -w "%{http_code}" -X GET "${this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1'}/experiments/999" \\
  -H "Authorization: Api-Key your-api-key" \\
  -o response.json

# Check if request was successful
if [ "$(cat response.json | jq -r '.errors | length')" -eq 0 ]; then
  echo "Success"
else
  echo "Error: $(cat response.json | jq -r '.errors[0]')"
fi
\`\`\`
`
                };
            }
        );
    }
}