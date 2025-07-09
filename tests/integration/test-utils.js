/**
 * Test utilities for integration tests
 * NOT A TEST FILE - DO NOT RUN DIRECTLY
 */

// This file exports utilities, not tests
export default null;

export function describe(name, fn) {
  const suite = {
    name,
    tests: [],
    befores: [],
    afters: []
  };

  const context = {
    it: (testName, testFn) => {
      suite.tests.push({ name: testName, fn: testFn });
    },
    before: (fn) => {
      suite.befores.push(fn);
    },
    after: (fn) => {
      suite.afters.push(fn);
    },
    describe: (nestedName, nestedFn) => {
      const nestedSuite = describe(nestedName, nestedFn);
      suite.tests.push({ name: nestedName, fn: async () => nestedSuite });
    }
  };

  fn.call(context, context);

  return async function runSuite() {
    let passed = 0;
    let failed = 0;
    const results = [];

    console.log(`\n${name}`);

    // Run befores
    for (const before of suite.befores) {
      try {
        await before();
      } catch (error) {
        console.error('Before hook failed:', error);
        return {
          success: false,
          message: `Before hook failed: ${error.message}`,
          testCount: 0
        };
      }
    }

    // Run tests
    for (const test of suite.tests) {
      try {
        const result = await test.fn();
        
        // Handle nested suites
        if (result && typeof result.success !== 'undefined') {
          passed += result.passed || 0;
          failed += result.failed || 0;
          results.push(...(result.details || []));
          continue;
        }
        
        console.log(`  ✅ ${test.name}`);
        passed++;
        results.push({ name: test.name, status: 'PASS' });
      } catch (error) {
        console.log(`  ❌ ${test.name}`);
        console.log(`     ${error.message}`);
        failed++;
        results.push({ name: test.name, status: 'FAIL', error: error.message });
      }
    }

    // Run afters
    for (const after of suite.afters) {
      try {
        await after();
      } catch (error) {
        console.error('After hook failed:', error);
      }
    }

    const success = failed === 0;
    return {
      success,
      message: success ? `All ${passed} tests passed` : `${failed} out of ${passed + failed} tests failed`,
      testCount: passed + failed,
      details: results,
      passed,
      failed
    };
  };
}

export function it(name, fn) {
  return describe(name, (ctx) => {
    ctx.it(name, fn);
  });
}

export function before(fn) {
  return fn;
}

export function after(fn) {
  return fn;
}