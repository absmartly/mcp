#!/usr/bin/env node
/**
 * Unit Tests for Legacy Features
 * Migrated from individual test scripts to ensure backwards compatibility
 */

export default function runLegacyFeaturesTests() {
  let passed = 0;
  let failed = 0;
  const results = [];

  function test(name, testFn) {
    try {
      const result = testFn();
      if (result) {
        passed++;
        results.push({ name, status: 'PASS' });
      } else {
        failed++;
        results.push({ name, status: 'FAIL', error: 'Test returned false' });
      }
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
    }
  }

  function assertEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
    return true;
  }

  function assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
    return true;
  }

  // Test dynamic field name generation (from test-type-based-naming.js)
  test('Dynamic field name generation', () => {
    function generateCleanFieldName(title) {
      return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    const testCases = [
      { input: 'Purpose', expected: 'purpose' },
      { input: 'Test Field!', expected: 'test_field' },
      { input: 'Feature @#$ Name', expected: 'feature_name' },
      { input: '  Leading Trailing  ', expected: 'leading_trailing' },
      { input: 'Multiple   Spaces', expected: 'multiple_spaces' },
      { input: '123 Numeric Field', expected: '123_numeric_field' }
    ];

    for (const testCase of testCases) {
      const result = generateCleanFieldName(testCase.input);
      if (result !== testCase.expected) {
        throw new Error(`Field name generation failed for "${testCase.input}". Expected: ${testCase.expected}, Got: ${result}`);
      }
    }

    return true;
  });

  // Test experiment type-based field resolution
  test('Experiment type-based field resolution', () => {
    // Simulate custom fields with different types
    const mockCustomFields = [
      { id: 1, title: 'Purpose', custom_section: { type: 'test' } },
      { id: 2, title: 'Purpose', custom_section: { type: 'feature' } },
      { id: 3, title: 'Test Field', custom_section: { type: 'test' } },
      { id: 4, title: 'Test Field', custom_section: { type: 'test' } },
      { id: 5, title: 'Feature Config', custom_section: { type: 'feature' } }
    ];

    function getFieldForExperimentType(fieldName, experimentType, fields) {
      const matchingFields = fields.filter(field => {
        const cleanName = field.title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_')
          .replace(/^_+|_+$/g, '');
        return cleanName === fieldName && field.custom_section?.type === experimentType;
      });

      return matchingFields.length > 0 ? matchingFields[0] : null;
    }

    // Test cross-type field (Purpose exists in both test and feature)
    const testPurposeField = getFieldForExperimentType('purpose', 'test', mockCustomFields);
    const featurePurposeField = getFieldForExperimentType('purpose', 'feature', mockCustomFields);
    
    assertTrue(testPurposeField && testPurposeField.id === 1, 'Should find test Purpose field');
    assertTrue(featurePurposeField && featurePurposeField.id === 2, 'Should find feature Purpose field');

    // Test type-specific field
    const featureConfigField = getFieldForExperimentType('feature_config', 'feature', mockCustomFields);
    const testConfigField = getFieldForExperimentType('feature_config', 'test', mockCustomFields);
    
    assertTrue(featureConfigField && featureConfigField.id === 5, 'Should find feature config field');
    assertTrue(testConfigField === null, 'Should not find feature config in test type');

    return true;
  });

  // OAuth configuration validation removed - using API key authentication instead

  // Test experiment data validation
  test('Experiment data validation', () => {
    function validateExperimentData(experiment) {
      const required = ['name', 'type'];
      const missing = required.filter(field => !experiment[field]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }

      if (experiment.type === 'feature' && experiment.analysis_type) {
        throw new Error('analysis_type should not be specified for feature experiments');
      }

      return true;
    }

    // Test valid test experiment
    const validTestExp = {
      name: 'Test Experiment',
      type: 'test',
      analysis_type: 'fixed_horizon'
    };
    assertTrue(validateExperimentData(validTestExp), 'Valid test experiment should pass');

    // Test valid feature experiment
    const validFeatureExp = {
      name: 'Feature Flag',
      type: 'feature'
    };
    assertTrue(validateExperimentData(validFeatureExp), 'Valid feature experiment should pass');

    // Test invalid feature experiment with analysis_type
    const invalidFeatureExp = {
      name: 'Feature Flag',
      type: 'feature',
      analysis_type: 'fixed_horizon'
    };

    try {
      validateExperimentData(invalidFeatureExp);
      throw new Error('Should have thrown validation error');
    } catch (error) {
      assertTrue(error.message.includes('analysis_type should not be specified'), 'Should reject analysis_type for feature');
    }

    return true;
  });

  // Test URL normalization
  test('URL normalization', () => {
    function normalizeApiEndpoint(endpoint) {
      // Remove trailing slash first, then remove version, then add /v1
      return endpoint.replace(/\/$/, '').replace(/\/v\d+$/, '') + '/v1';
    }

    const testCases = [
      { input: 'https://sandbox.absmartly.com', expected: 'https://sandbox.absmartly.com/v1' },
      { input: 'https://sandbox.absmartly.com/', expected: 'https://sandbox.absmartly.com/v1' },
      { input: 'https://sandbox.absmartly.com/v1', expected: 'https://sandbox.absmartly.com/v1' },
      { input: 'https://sandbox.absmartly.com/v1/', expected: 'https://sandbox.absmartly.com/v1' },
      { input: 'https://api.example.com/v2', expected: 'https://api.example.com/v1' }
    ];

    for (const testCase of testCases) {
      const result = normalizeApiEndpoint(testCase.input);
      assertEquals(result, testCase.expected, `URL normalization failed for ${testCase.input}`);
    }

    return true;
  });

  // Test custom field validation
  test('Custom field validation', () => {
    function validateCustomFieldValue(field, value) {
      if (field.required && (!value || value.trim() === '')) {
        throw new Error(`Field "${field.title}" is required`);
      }

      if (field.type === 'json' && value) {
        try {
          JSON.parse(value);
        } catch (error) {
          throw new Error(`Field "${field.title}" must be valid JSON`);
        }
      }

      if (field.type === 'boolean' && value) {
        if (!['true', 'false'].includes(value.toLowerCase())) {
          throw new Error(`Field "${field.title}" must be 'true' or 'false'`);
        }
      }

      return true;
    }

    // Test required field validation
    const requiredField = { title: 'Required Field', required: true, type: 'string' };
    
    try {
      validateCustomFieldValue(requiredField, '');
      throw new Error('Should have thrown required field error');
    } catch (error) {
      assertTrue(error.message.includes('is required'), 'Should validate required fields');
    }

    // Test JSON field validation
    const jsonField = { title: 'JSON Field', required: false, type: 'json' };
    assertTrue(validateCustomFieldValue(jsonField, '{"valid": "json"}'), 'Should accept valid JSON');
    
    try {
      validateCustomFieldValue(jsonField, '{invalid json}');
      throw new Error('Should have thrown JSON validation error');
    } catch (error) {
      assertTrue(error.message.includes('must be valid JSON'), 'Should validate JSON format');
    }

    // Test boolean field validation
    const booleanField = { title: 'Boolean Field', required: false, type: 'boolean' };
    assertTrue(validateCustomFieldValue(booleanField, 'true'), 'Should accept true');
    assertTrue(validateCustomFieldValue(booleanField, 'false'), 'Should accept false');
    
    try {
      validateCustomFieldValue(booleanField, 'maybe');
      throw new Error('Should have thrown boolean validation error');
    } catch (error) {
      assertTrue(error.message.includes('must be \'true\' or \'false\''), 'Should validate boolean format');
    }

    return true;
  });

  // Return test results
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}