# Dynamic Custom Fields Testing Guide

This guide explains how to test the dynamic custom fields functionality in the ABsmartly MCP server.

## Overview

The dynamic custom fields feature automatically discovers custom fields from your ABsmartly instance and exposes them as tool parameters in the `create_experiment` tool. This eliminates the need for LLMs to manually fetch field IDs and makes experiment creation more intuitive.

## Features Tested

1. **Dynamic Schema Generation**: Custom fields are automatically added as parameters to the `create_experiment` tool
2. **Field Type Support**: Proper handling of string, boolean, and JSON field types
3. **Named Field Translation**: Support for human-readable field names that get translated to API format
4. **Experiment Type Filtering**: Different fields available for test vs feature experiments
5. **Required Field Validation**: Proper validation of required custom fields

## Running the Tests

### Quick Test (Direct)

```bash
npm run test:dynamic
```

This runs the test script directly, assuming your environment is set up.

### Comprehensive Test (with Validation)

```bash
npm run test:dynamic:full
```

This runs the full test suite with environment and server validation.

### Manual Test

```bash
# 1. Start the local MCP server
npm run dev

# 2. In another terminal, run the test
./run-dynamic-fields-test.sh
```

## Test Environment Setup

### Prerequisites

1. **Local MCP Server**: Must be running on port 8787
   ```bash
   npm run dev
   ```

2. **ABsmartly API**: Either local (port 8000) or remote instance

3. **Environment File**: Create `.env.local` with your credentials:
   ```bash
   ABSMARTLY_API_KEY=your_api_key_here
   ABSMARTLY_API_ENDPOINT=http://localhost:8000/v1  # or your remote endpoint
   ```

### Test Flow

The comprehensive test performs these steps:

1. **Baseline Check**: Verifies no custom fields before configuration
2. **API Configuration**: Configures ABsmartly API and fetches custom fields
3. **Schema Validation**: Confirms dynamic parameters were added to tool schema
4. **Documentation Fetch**: Retrieves custom fields documentation
5. **Dynamic Parameters Test**: Creates experiment using auto-generated custom field parameters
6. **Named Fields Test**: Creates experiment using the `custom_fields_named` format

## Expected Output

When the test runs successfully, you should see:

```
🧪 COMPREHENSIVE DYNAMIC CUSTOM FIELDS TEST
================================================================================

📋 PHASE 1: Check tool schema BEFORE API configuration
------------------------------------------------------------
📊 Parameters before configuration: 34 total
🔧 Custom field parameters: 0
✅ Expected: 0 custom field parameters (not configured yet)

⚙️  PHASE 2: Configure ABsmartly API to fetch custom fields
------------------------------------------------------------
Configuration result:
✅ ABsmartly API configured for LOCAL DEVELOPMENT!
...

🔍 PHASE 3: Validate dynamic schema generation with custom fields
------------------------------------------------------------
📊 Parameters after configuration: 47 total
🔧 Custom field parameters: 13
🧪 Test-specific fields: 8
🎛️  Feature-specific fields: 5

🎉 SUCCESS! Dynamic custom field parameters found:
  • custom_7_availability_rules (**REQUIRED**)
    📝 Availability Rules (JSON field - provide as JSON string). When is this...
  • custom_111_test_field (**REQUIRED**)
    📝 test field. ...
  ... and 11 more custom field parameters

🚀 PHASE 5: Create test experiment using dynamic custom field parameters
------------------------------------------------------------
📝 Using 6 custom field parameters:
  • custom_40_purpose: "Validate dynamic schema with custom fields"
  • custom_111_test_field: "Dynamic test value 1 for custom_111_test_field"
  • custom_7_availability_rules: "{"test": true, "value": 2}"

🎯 Creating experiment with dynamic custom field parameters...
🎉 SUCCESS! Experiment created using dynamic custom field parameters!
✅ Experiment ID: 523
✅ Experiment Name: dynamic_test_1735591234567

🔧 Custom field values in API response:
  • Field ID 40: "Validate dynamic schema with custom fields"
  • Field ID 111: "Dynamic test value 1 for custom_111_test_field"
  • Field ID 7: "{"test": true, "value": 2}"

✅ VALIDATION: Custom fields were properly translated from dynamic parameters to API format!

📊 TEST SUMMARY
================================================================================

✅ Dynamic Schema Generation: Custom fields automatically added as tool parameters
✅ Custom Field Discovery: Fields fetched from API during configuration
✅ Parameter Translation: Dynamic parameters correctly translated to API format
✅ Named Fields Support: Human-readable field names work alongside dynamic parameters
✅ Type Validation: Field types (string, boolean, json) properly handled
✅ Experiment Creation: Both approaches successfully create experiments

🎉 DYNAMIC CUSTOM FIELDS IMPLEMENTATION: FULLY FUNCTIONAL!
```

## Troubleshooting

### Common Issues

1. **No custom fields found**: 
   - Check that your ABsmartly instance has custom fields configured
   - Verify API credentials are correct

2. **Server connection failed**:
   - Ensure MCP server is running: `npm run dev`
   - Check that port 8787 is available

3. **API connection failed**:
   - Verify ABsmartly API endpoint in `.env.local`
   - Check API key permissions

### Debug Mode

For verbose output, modify the test script to add debug logging:

```javascript
// In test-dynamic-fields-complete.js, add after configuration
console.log('Debug - Full config response:', JSON.stringify(configResult, null, 2));
```

## Integration with LLMs

Once the dynamic fields are working, LLMs can create experiments using custom fields in two ways:

### Method 1: Dynamic Parameters (Recommended)
```javascript
await client.callTool({
  name: 'create_experiment',
  arguments: {
    // ... standard experiment parameters ...
    custom_7_availability_rules: '{"enabled": true}',
    custom_40_purpose: 'Test new checkout flow',
    custom_111_test_field: 'Required field value'
  }
});
```

### Method 2: Named Fields
```javascript
await client.callTool({
  name: 'create_experiment', 
  arguments: {
    // ... standard experiment parameters ...
    custom_fields_named: {
      'Availability Rules': '{"enabled": true}',
      'Purpose': 'Test new checkout flow', 
      'test field': 'Required field value'
    }
  }
});
```

Both methods are fully supported and will produce the same API calls to ABsmartly.