# Applications API

## Overview
Applications represent different products, services, or environments where experiments run. They provide isolation and organization for your experiments.

## Endpoints

### List Applications
`GET /applications`

**Required Permissions**: `Application List` or `Application Admin`

**Parameters**:
- `search` (string): Search by application name
- `page` (integer): Page number
- `items` (integer): Items per page
- `environment` (string): Filter by environment

### Get Application
`GET /applications/{applicationId}`

Returns detailed application information including configuration and statistics.

### Create Application
`POST /applications`

**Required Permissions**: `Application Admin`

**Request Body**:
```json
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
```

### Update Application
`PUT /applications/{applicationId}`

**Required Permissions**: `Application Admin`

Updates application configuration and settings.

### Archive Application
`PUT /applications/{applicationId}/archive`

**Required Permissions**: `Application Admin`

Archives or unarchives an application. Archived applications cannot run new experiments.

## Application Configuration

### Environments
Applications can be configured for different environments:
- `development`: For testing and development
- `staging`: For pre-production testing
- `production`: For live user experiments

### SDK Settings
Configure SDK behavior per application:
```json
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
```

### Unit Types
Define how users are identified:
```json
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
```

## Context Configuration

### Context Variables
Define variables available to experiments:
```json
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
```

### Default Context
Set default values for context variables:
```json
{
  "default_context": {
    "country": "US",
    "subscription_tier": "free",
    "account_age_days": 0
  }
}
```

## Integration

### SDK Integration
Each application gets unique SDK configuration:
```javascript
// JavaScript SDK
const absmartly = new ABSmartly({
  endpoint: "https://sandbox.absmartly.com/v1",
  apiKey: "your-api-key",
  application: "mobile-app-ios",
  environment: "production"
});
```

### Event Tracking
Configure event tracking per application:
```json
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
```

## Application Statistics

### Get Application Stats
`GET /applications/{applicationId}/stats`

Returns usage statistics:
```json
{
  "active_experiments": 12,
  "total_experiments": 156,
  "monthly_requests": 2500000,
  "monthly_events": 850000,
  "unique_users": 125000,
  "last_activity": "2024-01-15T10:30:00Z"
}
```

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