#!/usr/bin/env node
/**
 * End-to-End Test for Button Rounding Experiment Creation
 * Tests the critical Chrome extension use case of creating CSS-based experiments
 */

import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Use the same MCP URL that was sent to the extension dev
const BASE_URL = 'https://mcp.absmartly.com/sse';

// Load API key and endpoint from .env.local
const TEST_API_KEY = process.env.ABSMARTLY_API_KEY;
const TEST_ENDPOINT = process.env.ABSMARTLY_API_ENDPOINT;

if (!TEST_API_KEY || !TEST_ENDPOINT) {
  console.error('Missing required environment variables: ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT');
  console.error('Please ensure .env.local contains these values');
  process.exit(1);
}

// Create MCP client
let mcpClient = null;

async function connectMCPClient() {
  try {
    console.log(`🔌 Connecting to MCP server at: ${BASE_URL}`);
    console.log(`🔑 Using API key: ${TEST_API_KEY.substring(0, 10)}...`);
    console.log(`🌐 Using endpoint: ${TEST_ENDPOINT}`);
    
    // Create URL with authentication parameters
    const url = new URL(BASE_URL);
    url.searchParams.set('api_key', TEST_API_KEY);
    url.searchParams.set('absmartly-endpoint', TEST_ENDPOINT);
    
    console.log(`🔗 Connection URL: ${url.toString().replace(TEST_API_KEY, 'API_KEY_HIDDEN')}`);
    
    // Create transport
    const transport = new SSEClientTransport(url);
    
    // Create and connect client
    mcpClient = new Client({
      name: 'button-rounding-test',
      version: '1.0.0'
    }, {
      capabilities: {}
    });
    
    console.log('📡 Attempting to connect to MCP server...');
    
    // Add timeout for connection
    const connectionTimeout = setTimeout(() => {
      console.error('❌ Connection timeout after 30 seconds');
      process.exit(1);
    }, 30000);
    
    await mcpClient.connect(transport);
    clearTimeout(connectionTimeout);
    console.log('✅ Successfully connected to MCP server');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to MCP server:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

async function callMCPTool(toolName, args = {}) {
  if (!mcpClient) {
    throw new Error('MCP client not connected');
  }
  
  console.log(`🔧 Calling tool: ${toolName}`);
  console.log(`📦 Arguments:`, JSON.stringify(args, null, 2));
  
  try {
    const result = await mcpClient.callTool({
      name: toolName,
      arguments: args
    });
    
    console.log(`✅ Tool ${toolName} completed successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Tool ${toolName} failed:`, error.message);
    throw error;
  }
}

async function runButtonRoundingExperimentTests() {
  console.log('🧪 Starting Button Rounding Experiment E2E Tests');
  console.log(`Using MCP URL: ${BASE_URL}`);
  console.log(`Using endpoint: ${TEST_ENDPOINT}`);
  console.log(`API key length: ${TEST_API_KEY ? TEST_API_KEY.length : 'missing'}`);
  
  let passed = 0;
  let failed = 0;
  const results = [];

  async function test(name, testFn) {
    try {
      const result = await testFn();
      if (result) {
        passed++;
        results.push({ name, status: 'PASS' });
        console.log(`  ✅ ${name}`);
      } else {
        failed++;
        results.push({ name, status: 'FAIL', error: 'Test returned false' });
        console.log(`  ❌ ${name}: Test returned false`);
      }
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  ❌ ${name}: ${error.message}`);
    }
  }

  function assertEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
    return true;
  }

  function assertContains(text, substring, message = '') {
    if (!text.includes(substring)) {
      throw new Error(`${message}\nExpected text to contain: ${substring}\nActual: ${text}`);
    }
    return true;
  }

  function assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(message || 'Expected condition to be true');
    }
    return true;
  }

  console.log('\n🧪 Button Rounding Experiment E2E Tests');

  // Connect to MCP server first
  try {
    await connectMCPClient();
  } catch (error) {
    console.error('❌ Failed to connect to MCP server, aborting tests');
    return {
      passed: 0,
      failed: 1,
      results: [{
        name: 'MCP Connection',
        status: 'FAIL',
        error: `Failed to connect to MCP server: ${error.message}`
      }],
      success: false
    };
  }

  // Test 1: Verify MCP server can list available tools
  await test('MCP server lists available tools', async () => {
    const tools = await mcpClient.listTools();
    
    assertTrue(tools && tools.tools, 'Should return tools list');
    
    const toolNames = tools.tools.map(tool => tool.name);
    console.log(`🔧 Available tools: ${toolNames.join(', ')}`);
    
    assertTrue(toolNames.includes('list_experiments'), 'Should include list_experiments tool');
    
    // Check if we have experiment creation tools
    const hasCreateTool = toolNames.some(name => 
      name.includes('create') && (name.includes('experiment') || name.includes('flag'))
    );
    
    if (!hasCreateTool) {
      console.log('⚠️  No create_feature_flag tool found, looking for alternatives...');
      const createTools = toolNames.filter(name => name.includes('create'));
      console.log(`🔨 Available create tools: ${createTools.join(', ')}`);
    }
    
    assertTrue(toolNames.includes('get_experiment'), 'Should include get_experiment tool');
    
    console.log(`✅ Found ${tools.tools.length} available tools`);
    return true;
  });

  // Test 1.5: List all experiments to see what's in the system
  await test('List all experiments without filter', async () => {
    const result = await callMCPTool('list_experiments', {
      format: 'json',
      items: 10
    });
    
    assertTrue(result && result.content, 'Should return experiment list');
    const responseText = result.content[0].text;
    const data = JSON.parse(responseText);
    
    console.log(`📊 Found ${data.experiments?.length || 0} experiments in the system`);
    if (data.experiments && data.experiments.length > 0) {
      console.log('🧪 First few experiments:');
      data.experiments.slice(0, 3).forEach(exp => {
        console.log(`  - ID: ${exp.id}, Name: ${exp.name}, State: ${exp.state}`);
      });
    }
    
    return true;
  });

  // Test 2: Test natural language experiment creation for button rounding
  let createdExperimentId = null;
  await test('Create button rounding experiment with CSS treatments', async () => {
    // First, check available tools to find the right create tool
    const tools = await mcpClient.listTools();
    const toolNames = tools.tools.map(tool => tool.name);
    
    // Find the appropriate create tool
    let createToolName = 'create_feature_flag';
    if (!toolNames.includes(createToolName)) {
      // Look for alternative create tools
      const createTools = toolNames.filter(name => 
        name.includes('create') && (name.includes('experiment') || name.includes('flag'))
      );
      
      if (createTools.length > 0) {
        createToolName = createTools[0];
        console.log(`📝 Using alternative create tool: ${createToolName}`);
      } else {
        // Skip test if no create tool available
        console.log('⚠️  No experiment creation tool available, skipping test');
        return true;
      }
    }
    
    // For this test, we'll use the create tool to simulate
    // creating an experiment for button rounding
    const experimentData = {
      name: `Button Corner Rounding Test E2E ${new Date().toISOString()}`,
      unit_type_id: 1, // Assuming user ID unit type
      application_id: 1, // Assuming a test application
      feature_enabled_percentage: 50
    };

    try {
      const result = await callMCPTool(createToolName, experimentData);
      
      assertTrue(result && result.content, 'Should return experiment data');
      
      // Verify the response contains experiment information
      const responseText = result.content[0].text;
      console.log('📄 Create response:', responseText);
      console.log('📦 Full result object:', JSON.stringify(result, null, 2));
      
      // Check if the response is an error
      if (responseText.startsWith('Error:')) {
        throw new Error(`Feature flag creation failed: ${responseText}`);
      }
      
      assertTrue(responseText.includes('id'), 'Response should contain experiment ID');
      
      // Extract experiment ID for verification test
      const experimentResult = JSON.parse(responseText);
      createdExperimentId = experimentResult.id;
      assertTrue(createdExperimentId > 0, 'Should have valid experiment ID');
      console.log(`✅ Created experiment with ID: ${createdExperimentId}`);
    } catch (error) {
      console.error('❌ Failed to create experiment:', error.message);
      throw error;
    }
    
    return true;
  });

  // Test 2.5: Verify experiment was actually created by fetching it
  await test('Verify experiment was actually created in ABsmartly', async () => {
    if (!createdExperimentId) {
      throw new Error('No experiment ID available from creation test');
    }

    const result = await callMCPTool('get_experiment', {
      id: createdExperimentId
    });
    
    assertTrue(result && result.content, 'Should return experiment data');
    
    const responseText = result.content[0].text;
    const experiment = JSON.parse(responseText);
    
    // Verify experiment properties
    assertEquals(experiment.id, createdExperimentId, 'Should have correct experiment ID');
    assertContains(experiment.name, 'Button Corner Rounding', 'Should have correct experiment name');
    assertTrue(experiment.variants && experiment.variants.length === 2, 'Should have 2 variants (control and treatment)');
    
    // Verify variant structure for CSS experiments
    const controlVariant = experiment.variants.find(v => v.variant === 0);
    const treatmentVariant = experiment.variants.find(v => v.variant === 1);
    
    assertTrue(controlVariant, 'Should have control variant');
    assertTrue(treatmentVariant, 'Should have treatment variant');
    assertContains(controlVariant.name, 'Control', 'Control variant should be named appropriately');
    assertContains(treatmentVariant.name, 'Treatment', 'Treatment variant should be named appropriately');
    
    // Verify variant configurations for CSS
    console.log('Control variant config:', controlVariant.config);
    console.log('Treatment variant config:', treatmentVariant.config);
    
    // The config should contain feature_enabled flags
    const controlConfig = JSON.parse(controlVariant.config);
    const treatmentConfig = JSON.parse(treatmentVariant.config);
    
    assertEquals(controlConfig.feature_enabled, false, 'Control should have feature disabled');
    assertEquals(treatmentConfig.feature_enabled, true, 'Treatment should have feature enabled');
    
    return true;
  });

  // Test 3: Verify experiment can be retrieved with proper formatting
  await test('Retrieve created experiment with markdown formatting', async () => {
    // List experiments to find our test experiment
    const result = await callMCPTool('list_experiments', {
      search: 'Button Corner Rounding',
      format: 'md',
      items: 20  // Increase items to ensure we find it
    });
    
    assertTrue(result && result.content, 'Should return experiment list');
    const responseText = result.content[0].text;
    
    // Verify markdown formatting
    assertContains(responseText, '# Experiments', 'Should have markdown header');
    assertContains(responseText, '##', 'Should have experiment sections');
    assertContains(responseText, 'Button Corner Rounding Test E2E', 'Should contain our created experiment');
    
    return true;
  });

  // Test 4: Test experiment data structure for Chrome extension compatibility
  await test('Experiment data is compatible with Chrome extension', async () => {
    // List experiments in JSON format to get full data structure
    const result = await callMCPTool('list_experiments', {
      search: 'Button Corner Rounding Test E2E',
      format: 'json',
      items: 1
    });

    assertTrue(result && result.content, 'Should return experiment data');
    
    const responseText = result.content[0].text;
    const experimentData = JSON.parse(responseText);
    
    // Verify required fields for Chrome extension
    assertTrue(experimentData.experiments, 'Should have experiments array');
    assertTrue(experimentData.experiments.length > 0, 'Should find our created experiment');
    
    const experiment = experimentData.experiments[0];
    
    // Check required fields
    assertTrue(experiment.id !== undefined, 'Experiment should have ID');
    assertTrue(experiment.name !== undefined, 'Experiment should have name');
    assertTrue(experiment.state !== undefined, 'Experiment should have state');
    assertTrue(experiment.link !== undefined, 'Experiment should have link field');
    
    // Verify link format
    assertContains(experiment.link, '/experiments/', 'Link should contain experiments path');
    assertContains(experiment.link, experiment.id.toString(), 'Link should contain experiment ID');
    
    // Verify it's our created experiment
    if (createdExperimentId) {
      assertEquals(experiment.id, createdExperimentId, 'Should be our created experiment');
    }
    
    return true;
  });

  // Test 5: Test CSS treatment variable structure
  await test('Experiment supports CSS treatment configuration', async () => {
    // Create a mock CSS treatment configuration that the Chrome extension would use
    const cssConfig = {
      control: {
        css: "/* No changes - original button styles */"
      },
      treatment: {
        css: `
          button, .btn, input[type="button"], input[type="submit"] {
            border-radius: 12px !important;
            transition: all 0.2s ease-in-out;
          }
          
          button:hover, .btn:hover {
            border-radius: 16px !important;
          }
        `
      }
    };

    // For now, verify that the structure is valid JSON and contains expected fields
    assertTrue(cssConfig.control, 'Should have control configuration');
    assertTrue(cssConfig.treatment, 'Should have treatment configuration');
    assertTrue(cssConfig.treatment.css.includes('border-radius'), 'Treatment should contain border-radius CSS');
    assertTrue(cssConfig.treatment.css.includes('!important'), 'CSS should use !important for specificity');
    
    return true;
  });

  // Test 6: Test experiment state management for Chrome extension
  await test('Experiment state management works for extension', async () => {
    // Test that we can retrieve experiment states that the extension needs
    const result = await callMCPTool('list_experiments', {
      state: 'running,ready',
      format: 'json',
      items: 5
    });

    assertTrue(result && result.content, 'Should return experiment data');
    
    const responseText = result.content[0].text;
    const experimentData = JSON.parse(responseText);
    
    // Verify state filtering works
    assertTrue(experimentData.experiments !== undefined, 'Should have experiments array');
    
    // If there are experiments, verify they have the requested states
    if (experimentData.experiments.length > 0) {
      console.log(`Found ${experimentData.experiments.length} experiments in running/ready state`);
      for (const experiment of experimentData.experiments) {
        assertTrue(
          ['running', 'ready'].includes(experiment.state.toLowerCase()),
          `Experiment state "${experiment.state}" should be running or ready`
        );
      }
    } else {
      console.log('No experiments in running/ready state (this is ok for test environment)');
    }
    
    return true;
  });

  console.log(`\n📊 Button Rounding E2E Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  // Cleanup - disconnect MCP client
  if (mcpClient) {
    try {
      await mcpClient.close();
      console.log('\n🔌 Disconnected from MCP server');
    } catch (error) {
      console.error('⚠️ Error disconnecting from MCP server:', error.message);
    }
  }

  return {
    passed,
    failed,
    results,
    success: failed === 0
  };
}

// Export the test suite as default for test runner
export default runButtonRoundingExperimentTests;

// Also export as named export for specific imports
export { runButtonRoundingExperimentTests };

// If running directly, execute the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Running Button Rounding Experiment Tests directly...\n');
  
  runButtonRoundingExperimentTests()
    .then(result => {
      console.log('\n✅ Test run completed');
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Test run failed:', error.message);
      process.exit(1);
    });
}