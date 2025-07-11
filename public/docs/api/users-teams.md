# Users & Teams API

## Overview
Manage users, teams, and permissions for collaborative experiment management.

## Users API

### List Users
`GET /users`

**Required Permissions**: `User List` or `User Admin`

**Parameters**:
- `search` (string): Search by name or email
- `role` (string): Filter by role
- `team_id` (integer): Filter by team membership
- `status` (string): active, inactive, pending

### Get User
`GET /users/{userId}`

Returns user profile, permissions, and team memberships.

### Create User
`POST /users`

**Required Permissions**: `User Admin`

**Request Body**:
```json
{
  "first_name": "John",
  "last_name": "Doe", 
  "email": "john.doe@company.com",
  "role": "experimenter",
  "teams": [123, 456],
  "permissions": ["experiment_list", "experiment_create"],
  "send_invitation": true
}
```

## Teams API

### List Teams
`GET /teams`

**Required Permissions**: `Team List` or `Team Admin`

### Create Team
`POST /teams`

**Required Permissions**: `Team Admin`

**Request Body**:
```json
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
```

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
- `experiment_list`: View experiments
- `experiment_admin`: Full experiment management
- `experiment_create`: Create new experiments
- `experiment_edit`: Edit existing experiments
- `experiment_delete`: Delete experiments

### Goal & Metric Permissions
- `goal_list`: View goals
- `goal_admin`: Manage goals
- `metric_list`: View metrics
- `metric_admin`: Manage metrics

### Administrative Permissions
- `user_admin`: Manage users
- `team_admin`: Manage teams
- `application_admin`: Manage applications
- `system_admin`: System configuration

## Team Collaboration

### Experiment Ownership
Experiments can be owned by users or teams:
```json
{
  "owner_id": 123,        // Individual owner
  "team_id": 456,         // Team ownership
  "collaborators": [789]  // Additional collaborators
}
```

### Team Permissions
Teams inherit permissions that apply to all members:
- Team permissions override individual permissions
- Users can be members of multiple teams
- Team leads have additional privileges

### Notification Settings
Configure team notifications:
```json
{
  "notifications": {
    "experiment_started": true,
    "experiment_stopped": true,
    "significant_results": true,
    "weekly_summary": false
  },
  "channels": ["email", "slack"]
}
```

## Access Control

### Resource-Level Permissions
Control access to specific resources:
```json
{
  "applications": [123, 456],  // Accessible applications
  "experiments": [789, 101],   // Specific experiment access
  "teams": [222]               // Team-based access
}
```

### IP Restrictions
Restrict access by IP address:
```json
{
  "ip_whitelist": [
    "192.168.1.0/24",
    "10.0.0.1"
  ]
}
```

## Authentication

### Single Sign-On (SSO)
Configure SSO integration:
```json
{
  "sso": {
    "provider": "okta",
    "domain": "company.okta.com",
    "auto_provision": true,
    "default_role": "viewer"
  }
}
```

### API Keys
Users can generate personal API keys:
- Limited to user's permissions
- Can be scoped to specific applications
- Support expiration dates

## Audit Logging

### User Activity
Track user actions:
```json
{
  "user_id": 123,
  "action": "experiment_created",
  "resource_type": "experiment",
  "resource_id": 456,
  "timestamp": "2024-01-15T10:30:00Z",
  "ip_address": "192.168.1.100"
}
```

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