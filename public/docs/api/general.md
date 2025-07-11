# ABsmartly API Documentation

## Base URL
https://sandbox.absmartly.com/v1

## Authentication

### API Key Authentication
- Pass API key in an HTTP header as `Authorization: Api-Key <key>`
- Used for server-to-server communication
- Full access to all endpoints

### JWT Token Authentication (OAuth)
- Pass JWT as `Authorization: Bearer <token>` header  
- Used for user-authenticated requests
- Access based on user permissions

## Response Format
All API responses follow this structure:
```json
{
  "ok": true/false   // Whether the request was successful
  "data": { ... },   // Response data
  "errors": [ ... ]  // Array of error messages
}
```

## Error Codes
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `422` - Unprocessable Entity (business logic errors)
- `500` - Internal Server Error

## Rate Limiting
- 1000 requests per minute per API key
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## Custom Fields
Custom fields can be configured per organization to extend experiment metadata and provide additional context for analysis.