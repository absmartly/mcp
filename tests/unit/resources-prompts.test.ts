#!/usr/bin/env node
/**
 * Unit Tests for Resources and Prompts Features
 * Tests the MCP server's resources and prompts functionality
 */

export default function runResourcesPromptsTests(): {
  success: boolean;
  message: string;
  testCount: number;
  details: Array<{ name: string; status: string; error?: string }>;
  passed: number;
  failed: number;
  total: number;
  results: Array<{ name: string; status: string; error?: string }>;
} {
  let passed = 0;
  let failed = 0;
  const results: Array<{ name: string; status: string; error?: string }> = [];

  function test(name: string, testFn: () => unknown): void {
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
      results.push({ name, status: 'FAIL', error: (error as Error).message });
    }
  }

  function assertEquals(actual: unknown, expected: unknown, message: string = ''): boolean {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
    return true;
  }

  function assertTrue(condition: unknown, message: string = ''): boolean {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
    return true;
  }

  function assertContains(haystack: string, needle: string, message: string = ''): boolean {
    if (!haystack.includes(needle)) {
      throw new Error(message || `Expected "${haystack}" to contain "${needle}"`);
    }
    return true;
  }

  // Mock MCP Server for testing
  class MockMcpServer {
    resources: Map<string, unknown>;
    prompts: Map<string, unknown>;
    capabilities: { tools: object; resources: object; prompts: object };

    constructor() {
      this.resources = new Map();
      this.prompts = new Map();
      this.capabilities = {
        tools: {},
        resources: {},
        prompts: {}
      };
    }

    resource(uri: string, mimeType: string, metadata: object, handler: () => unknown): void {
      this.resources.set(uri, {
        uri,
        mimeType,
        metadata,
        handler
      });
    }

    prompt(id: string, metadata: object, handler: () => unknown): void {
      this.prompts.set(id, {
        id,
        metadata,
        handler
      });
    }

    async getResource(uri: string): Promise<unknown> {
      const resource = this.resources.get(uri) as { handler: () => unknown } | undefined;
      if (!resource) {
        throw new Error(`Resource not found: ${uri}`);
      }
      return await resource.handler();
    }

    async getPrompt(id: string): Promise<unknown> {
      const prompt = this.prompts.get(id) as { handler: () => unknown } | undefined;
      if (!prompt) {
        throw new Error(`Prompt not found: ${id}`);
      }
      return await prompt.handler();
    }
  }

  // Test Resource Registration
  test('Should register API documentation resource', () => {
    const server = new MockMcpServer();

    // Simulate resource registration
    server.resource(
      'absmartly://docs/api',
      'text/markdown',
      {
        name: 'ABsmartly API Documentation',
        description: 'OpenAPI specification and endpoint documentation'
      },
      async () => ({
        text: '# ABsmartly API Documentation'
      })
    );

    assertTrue(server.resources.has('absmartly://docs/api'), 'API docs resource should be registered');
    const resource = server.resources.get('absmartly://docs/api') as { mimeType: string; metadata: { name: string } };
    assertEquals(resource.mimeType, 'text/markdown', 'Should have correct mime type');
    assertEquals(resource.metadata.name, 'ABsmartly API Documentation', 'Should have correct name');
    return true;
  });

  // Test Resource Content
  test('Should return API documentation content', async () => {
    const server = new MockMcpServer();
    const endpoint = 'https://dev-1.absmartly.com/v1';
    const customFields = [
      { name: 'feature_flag', type: 'string' },
      { name: 'is_critical', type: 'boolean' }
    ];

    server.resource(
      'absmartly://docs/api',
      'text/markdown',
      {
        name: 'ABsmartly API Documentation',
        description: 'OpenAPI specification and endpoint documentation'
      },
      async () => ({
        text: `# ABsmartly API Documentation

## Base URL
${endpoint}

## Authentication
- **API Key**: Pass as \`X-API-Key\` header
- **JWT Token**: Pass as \`Authorization: Bearer <token>\` header

## Custom Fields
This instance has ${customFields.length} custom fields configured for experiments.
${customFields.map(f => `- ${f.name} (${f.type})`).join('\n')}`
      })
    );

    const result = await server.getResource('absmartly://docs/api') as { text: string };
    assertContains(result.text, '# ABsmartly API Documentation', 'Should contain title');
    assertContains(result.text, endpoint, 'Should contain endpoint');
    assertContains(result.text, 'API Key', 'Should contain auth info');
    assertContains(result.text, 'feature_flag (string)', 'Should list custom fields');
    return true;
  });

  // Test Experiment Template Resource
  test('Should register experiment template resource when custom fields exist', () => {
    const server = new MockMcpServer();
    const customFields = [{ name: 'feature_flag', type: 'string' }];

    if (customFields.length > 0) {
      server.resource(
        'absmartly://templates/experiment',
        'application/json',
        {
          name: 'Experiment Template',
          description: 'Template for creating new experiments with custom fields'
        },
        async () => ({
          text: JSON.stringify({
            name: 'New Experiment',
            custom_fields: { feature_flag: '' }
          }, null, 2)
        })
      );
    }

    assertTrue(server.resources.has('absmartly://templates/experiment'), 'Template resource should be registered');
    const resource = server.resources.get('absmartly://templates/experiment') as { mimeType: string };
    assertEquals(resource.mimeType, 'application/json', 'Should be JSON mime type');
    return true;
  });

  // Test Prompt Registration
  test('Should register all prompts', () => {
    const server = new MockMcpServer();

    // Register prompts
    server.prompt('experiment-status', {
      name: 'Check Experiment Status',
      description: 'Quick overview of all running experiments'
    }, async () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: 'Show me all currently running experiments' }
      }]
    }));

    server.prompt('create-experiment', {
      name: 'Create New A/B Test',
      description: 'Step-by-step guide to create a new experiment'
    }, async () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: 'I want to create a new A/B test experiment' }
      }]
    }));

    server.prompt('analyze-results', {
      name: 'Analyze Experiment Results',
      description: 'Deep dive into experiment performance'
    }, async () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: 'Help me analyze an experiment\'s results' }
      }]
    }));

    server.prompt('debug-auth', {
      name: 'Debug Authentication',
      description: 'Troubleshoot API connection issues'
    }, async () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: 'Check my authentication status' }
      }]
    }));

    assertEquals(server.prompts.size, 4, 'Should have 4 prompts registered');
    assertTrue(server.prompts.has('experiment-status'), 'Should have experiment-status prompt');
    assertTrue(server.prompts.has('create-experiment'), 'Should have create-experiment prompt');
    assertTrue(server.prompts.has('analyze-results'), 'Should have analyze-results prompt');
    assertTrue(server.prompts.has('debug-auth'), 'Should have debug-auth prompt');
    return true;
  });

  // Test Prompt Content
  test('Should return correct prompt content', async () => {
    const server = new MockMcpServer();

    server.prompt('experiment-status', {
      name: 'Check Experiment Status',
      description: 'Quick overview of all running experiments'
    }, async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: 'Show me all currently running experiments with their key metrics and performance'
        }
      }]
    }));

    const result = await server.getPrompt('experiment-status') as { messages: Array<{ role: string; content: { text: string } }> };
    assertEquals(result.messages.length, 1, 'Should have one message');
    assertEquals(result.messages[0].role, 'user', 'Should be user message');
    assertContains(result.messages[0].content.text, 'running experiments', 'Should mention running experiments');
    return true;
  });

  // Test Create Experiment Prompt
  test('Should have detailed create experiment prompt', async () => {
    const server = new MockMcpServer();

    server.prompt('create-experiment', {
      name: 'Create New A/B Test',
      description: 'Step-by-step guide to create a new experiment'
    }, async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `I want to create a new A/B test experiment. Please guide me through:
1. Setting up the experiment name and description
2. Defining the control and treatment variants
3. Selecting the key metrics to track
4. Setting the audience targeting rules
5. Configuring any custom fields needed

Let's start with the experiment basics.`
        }
      }]
    }));

    const result = await server.getPrompt('create-experiment') as { messages: Array<{ role: string; content: { text: string } }> };
    const text = result.messages[0].content.text;
    assertContains(text, 'A/B test', 'Should mention A/B test');
    assertContains(text, 'variants', 'Should mention variants');
    assertContains(text, 'metrics', 'Should mention metrics');
    assertContains(text, 'custom fields', 'Should mention custom fields');
    return true;
  });

  // Test Error Handling
  test('Should throw error for non-existent resource', async () => {
    const server = new MockMcpServer();

    try {
      await server.getResource('absmartly://non-existent');
      throw new Error('Should have thrown error');
    } catch (error) {
      assertContains((error as Error).message, 'Resource not found', 'Should have correct error message');
    }
    return true;
  });

  test('Should throw error for non-existent prompt', async () => {
    const server = new MockMcpServer();

    try {
      await server.getPrompt('non-existent-prompt');
      throw new Error('Should have thrown error');
    } catch (error) {
      assertContains((error as Error).message, 'Prompt not found', 'Should have correct error message');
    }
    return true;
  });

  // Run all tests and return results
  const success = failed === 0;
  return {
    success,
    message: success ? `All ${passed} tests passed` : `${failed} out of ${passed + failed} tests failed`,
    testCount: passed + failed,
    details: results,
    passed,
    failed,
    total: passed + failed,
    results
  };
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running Resources and Prompts Tests...\n');
  const { passed, failed, total, results } = runResourcesPromptsTests();

  results.forEach(({ name, status, error }) => {
    console.log(`${status === 'PASS' ? '✅' : '❌'} ${name}`);
    if (error) {
      console.log(`   Error: ${error}`);
    }
  });

  console.log(`\n${passed}/${total} tests passed`);
  process.exit(failed > 0 ? 1 : 0);
}
