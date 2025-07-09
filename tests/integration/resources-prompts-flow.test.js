/**
 * Resources and Prompts Integration Tests
 * 
 * Tests the MCP server's resources and prompts functionality
 */

const BASE_URL = process.env.TEST_SERVER_URL || 'http://localhost:8787';

/**
 * Test if MCP server is reachable
 */
async function isServerReachable() {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok || response.status === 404; // 404 is ok, means server is up
  } catch (error) {
    return false;
  }
}

/**
 * Mock MCP client for testing resources and prompts
 */
class MockMcpClient {
  constructor(endpoint, headers = {}) {
    this.endpoint = endpoint;
    this.headers = headers;
  }

  async sendRequest(method, params = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC Error: ${data.error.message}`);
    }

    return data.result;
  }

  async listResources() {
    try {
      return await this.sendRequest('resources/list');
    } catch (error) {
      // If method not found, return empty array (server doesn't support resources)
      if (error.message.includes('Method not found')) {
        return { resources: [] };
      }
      throw error;
    }
  }

  async readResource(uri) {
    return await this.sendRequest('resources/read', { uri });
  }

  async listPrompts() {
    try {
      return await this.sendRequest('prompts/list');
    } catch (error) {
      // If method not found, return empty array (server doesn't support prompts)
      if (error.message.includes('Method not found')) {
        return { prompts: [] };
      }
      throw error;
    }
  }

  async getPrompt(id) {
    return await this.sendRequest('prompts/get', { id });
  }
}

/**
 * Test Resources functionality
 */
async function testResources() {
  console.log('\n📚 Testing Resources...');
  
  const client = new MockMcpClient(`${BASE_URL}/sse`, {
    'x-absmartly-endpoint': 'https://test.absmartly.com/v1',
    'x-absmartly-api-key': 'test-key'
  });

  let passed = 0;
  let failed = 0;

  // Test 1: List resources
  try {
    const result = await client.listResources();
    if (result.resources && Array.isArray(result.resources)) {
      console.log('✅ List resources returns array');
      passed++;
      
      // Check for expected resources
      const apiDoc = result.resources.find(r => r.uri === 'absmartly://docs/api');
      if (apiDoc) {
        console.log('✅ API documentation resource exists');
        passed++;
      } else {
        console.log('❌ API documentation resource not found');
        failed++;
      }
    } else {
      console.log('❌ List resources failed - invalid response');
      failed++;
    }
  } catch (error) {
    console.log(`❌ List resources error: ${error.message}`);
    failed++;
  }

  // Test 2: Read API documentation
  try {
    const content = await client.readResource('absmartly://docs/api');
    if (content && content.text) {
      console.log('✅ Read API documentation successful');
      passed++;
      
      // Verify content
      if (content.text.includes('# ABsmartly API Documentation')) {
        console.log('✅ API documentation has correct content');
        passed++;
      } else {
        console.log('❌ API documentation content invalid');
        failed++;
      }
    } else {
      console.log('❌ Read API documentation failed');
      failed++;
    }
  } catch (error) {
    console.log(`❌ Read resource error: ${error.message}`);
    failed++;
  }

  return { passed, failed };
}

/**
 * Test Prompts functionality
 */
async function testPrompts() {
  console.log('\n💡 Testing Prompts...');
  
  const client = new MockMcpClient(`${BASE_URL}/sse`, {
    'x-absmartly-endpoint': 'https://test.absmartly.com/v1',
    'x-absmartly-api-key': 'test-key'
  });

  let passed = 0;
  let failed = 0;

  // Test 1: List prompts
  try {
    const result = await client.listPrompts();
    if (result.prompts && Array.isArray(result.prompts)) {
      console.log('✅ List prompts returns array');
      passed++;
      
      // Check for expected prompts
      const expectedPrompts = ['experiment-status', 'create-experiment', 'analyze-results', 'debug-auth'];
      let foundAll = true;
      
      for (const expectedId of expectedPrompts) {
        const prompt = result.prompts.find(p => p.id === expectedId);
        if (!prompt) {
          console.log(`❌ Missing prompt: ${expectedId}`);
          foundAll = false;
        }
      }
      
      if (foundAll) {
        console.log('✅ All expected prompts exist');
        passed++;
      } else {
        failed++;
      }
    } else {
      console.log('❌ List prompts failed - invalid response');
      failed++;
    }
  } catch (error) {
    console.log(`❌ List prompts error: ${error.message}`);
    failed++;
  }

  // Test 2: Get specific prompt
  try {
    const prompt = await client.getPrompt('experiment-status');
    if (prompt && prompt.messages && Array.isArray(prompt.messages)) {
      console.log('✅ Get prompt successful');
      passed++;
      
      // Verify prompt content
      const firstMessage = prompt.messages[0];
      if (firstMessage && firstMessage.role === 'user' && firstMessage.content.text.includes('running experiments')) {
        console.log('✅ Prompt has correct content');
        passed++;
      } else {
        console.log('❌ Prompt content invalid');
        failed++;
      }
    } else {
      console.log('❌ Get prompt failed');
      failed++;
    }
  } catch (error) {
    console.log(`❌ Get prompt error: ${error.message}`);
    failed++;
  }

  return { passed, failed };
}

/**
 * Main test runner
 */
export default async function runResourcesPromptsTests() {
  console.log('🚀 Starting Resources and Prompts Integration Tests\n');

  // Check if server is reachable
  const serverReachable = await isServerReachable();
  if (!serverReachable) {
    console.log('⚠ MCP server not reachable, skipping resources and prompts tests');
    return {
      success: true,
      message: 'MCP server not reachable - tests skipped',
      testCount: 0
    };
  }

  let totalPassed = 0;
  let totalFailed = 0;

  // Run resource tests
  const resourceResults = await testResources();
  totalPassed += resourceResults.passed;
  totalFailed += resourceResults.failed;

  // Run prompt tests
  const promptResults = await testPrompts();
  totalPassed += promptResults.passed;
  totalFailed += promptResults.failed;

  // Summary
  console.log('\n📊 Summary:');
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);

  return {
    success: totalFailed === 0,
    message: `${totalPassed} passed, ${totalFailed} failed`,
    testCount: totalPassed + totalFailed
  };
}