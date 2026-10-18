#!/usr/bin/env node
/**
 * ABsmartly MCP Test Runner
 * Runs all tests before deployment to ensure system integrity
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { isGated } from './integration/gate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// A gated run must execute at least this many integration tests. It stops a
// gated run from passing when a whole suite quietly stops running. The
// deterministic release suites currently total about 225; keep this floor
// just below that total so a missing suite cannot pass silently.
const GATED_MIN_INTEGRATION_TESTS = 210;

class TestRunner {
  constructor() {
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.results = [];
    this.skippedSuites = [];
    this.integrationTests = 0;
  }

  log(message, type = 'info') {
    const colors = {
      info: '\x1b[36m',    // cyan
      success: '\x1b[32m', // green
      error: '\x1b[31m',   // red
      warning: '\x1b[33m', // yellow
      reset: '\x1b[0m'
    };
    
    console.log(`${colors[type]}${message}${colors.reset}`);
  }

  async runTest(testFile, testPath, { integration = false } = {}) {
    this.log(`\n📋 Running ${testFile}...`);
    const before = this.totalTests;

    try {
      // Import the test module
      const testModule = await import(testPath);
      
      if (typeof testModule.default === 'function') {
        const result = await testModule.default();
        
        // A suite that reports success but ran nothing was skipped. Older
        // suites signal that with testCount: 0 and no `skipped` flag.
        if (result && result.success && (result.skipped || result.testCount === 0)) {
          this.skippedSuites.push({ file: testFile, message: result.message || 'skipped' });
          this.log(`⏭️  ${testFile}: ${result.message || 'SKIPPED'}`, 'warning');
          this.results.push({ file: testFile, ...result });
        } else if (result && result.success) {
          this.log(`✅ ${testFile}: ${result.message || 'PASSED'}`, 'success');
          this.passedTests += result.testCount || 1;
          this.totalTests += result.testCount || 1;
        } else {
          this.log(`❌ ${testFile}: ${result?.message || 'FAILED'}`, 'error');
          if (result && result.details) {
            result.details.filter(detail => detail.status === 'FAIL').forEach(detail => {
              this.log(`    • ${detail.name}: ${detail.error}`, 'error');
            });
          }
          this.failedTests += result?.testCount || 1;
          this.totalTests += result?.testCount || 1;
        }
        
        this.results.push({ file: testFile, ...result });
        
      } else {
        this.log(`⚠️  ${testFile}: No default export function found`, 'warning');
        this.failedTests += 1;
        this.totalTests += 1;
      }
      
    } catch (error) {
      this.log(`💥 ${testFile}: Error running test - ${error.message}`, 'error');
      this.log(`    Stack: ${error.stack}`, 'error');
      this.failedTests += 1;
      this.totalTests += 1;
      this.results.push({ 
        file: testFile, 
        success: false, 
        message: `Test execution error: ${error.message}`,
        testCount: 1
      });
    }

    if (integration) this.integrationTests += this.totalTests - before;
  }

  async runAllTests(options = {}) {
    this.log('🚀 ABsmartly MCP Test Suite Starting...', 'info');
    this.log('='.repeat(60));

    // Run unit tests
    if (!options.integrationOnly) {
      this.log('\n📚 Unit Tests', 'info');
      const unitTestDir = join(__dirname, 'unit');
      try {
        const unitTests = await readdir(unitTestDir);
        const testFiles = unitTests.filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'));

        for (const testFile of testFiles) {
          await this.runTest(testFile, join(unitTestDir, testFile));
        }
      } catch (error) {
        this.log(`No unit tests directory found: ${error.message}`, 'warning');
      }
    }

    // Run integration tests
    if (!options.unitOnly) {
      this.log('\n🔗 Integration Tests', 'info');
      const integrationTestDir = join(__dirname, 'integration');
      const integrationTests = await readdir(integrationTestDir);
      const testFiles = integrationTests
        .filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'));

      // Start wrangler dev so the Worker-backed suites test this checkout.
      // In a gated run always start a fresh one on a free port. Never reuse
      // whatever is already listening on 8787: it may be another checkout,
      // or code older than what is being published.
      const { ensureWranglerDev, stopWranglerDev } = await import('./integration/wrangler-fixture.js');
      let wranglerFixture = null;
      try {
        wranglerFixture = await ensureWranglerDev({ fresh: options.gated });
        process.env.MCP_WORKER_URL = wranglerFixture.url;
        this.log(
          `${wranglerFixture.alreadyRunning ? 'Using existing' : 'Started'} wrangler dev at ${wranglerFixture.url}`,
          'info'
        );
      } catch (err) {
        if (options.gated) {
          this.log(`💥 The Worker did not start, so the gated e2e run fails:\n${err.message}`, 'error');
          this.failedTests += 1;
          this.totalTests += 1;
          this.results.push({ file: 'wrangler dev', success: false, message: 'Worker failed to start' });
        } else {
          this.log(`Could not start wrangler dev (${err.message}). Worker suites will skip (local run only).`, 'warning');
        }
      }

      try {
        // In a gated run a Worker that failed to start already failed the
        // run. Running the suites anyway lists every suite it breaks.
        for (const testFile of testFiles) {
          await this.runTest(testFile, join(integrationTestDir, testFile), { integration: true });
        }
      } finally {
        if (wranglerFixture && !wranglerFixture.alreadyRunning) {
          stopWranglerDev(wranglerFixture);
          this.log('Stopped wrangler dev', 'info');
        }
      }

      if (options.gated) this.enforceGate();
    }

    // Print summary
    this.printSummary();
    
    // Exit with appropriate code
    process.exit(this.failedTests > 0 ? 1 : 0);
  }

  // Gated runs: no suite may skip, and enough tests must actually run.
  enforceGate() {
    for (const { file, message } of this.skippedSuites) {
      this.log(`❌ gate: ${file} skipped (${message})`, 'error');
      this.failedTests += 1;
      this.totalTests += 1;
      this.results.push({ file, success: false, message: `skipped in a gated run: ${message}` });
    }
    if (this.integrationTests < GATED_MIN_INTEGRATION_TESTS) {
      const message = `only ${this.integrationTests} integration tests ran; a gated run needs at least ${GATED_MIN_INTEGRATION_TESTS}`;
      this.log(`❌ gate: ${message}`, 'error');
      this.failedTests += 1;
      this.totalTests += 1;
      this.results.push({ file: 'gate', success: false, message });
    }
  }

  printSummary() {
    this.log('\n' + '='.repeat(60));
    this.log('📊 Test Summary', 'info');
    this.log('='.repeat(60));
    
    this.log(`Total Tests: ${this.totalTests}`);
    this.log(`Passed: ${this.passedTests}`, 'success');
    this.log(`Failed: ${this.failedTests}`, this.failedTests > 0 ? 'error' : 'success');
    if (this.skippedSuites.length > 0) {
      this.log(`Skipped suites: ${this.skippedSuites.map(s => s.file).join(', ')}`, 'warning');
    }
    
    if (this.failedTests > 0) {
      this.log('\n❌ Failed Tests:', 'error');
      this.results
        .filter(r => !r.success)
        .forEach(r => this.log(`  • ${r.file}: ${r.message}`, 'error'));
    }
    
    const successRate = ((this.passedTests / this.totalTests) * 100).toFixed(1);
    this.log(`\nSuccess Rate: ${successRate}%`, successRate === '100.0' ? 'success' : 'warning');
    
    if (this.failedTests === 0) {
      this.log('\n🎉 All tests passed! Ready for deployment.', 'success');
    } else {
      this.log('\n🚫 Some tests failed. Please fix before deploying.', 'error');
    }
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  // --gated is what `npm run test:e2e` (and so prepublishOnly) passes.
  // Setting it in the environment lets the suites see it too.
  if (args.includes('--gated')) process.env.REQUIRE_E2E = '1';
  const options = {
    unitOnly: args.includes('--unit-only'),
    integrationOnly: args.includes('--integration-only'),
    gated: isGated()
  };
  
  const runner = new TestRunner();
  runner.runAllTests(options).catch(error => {
    console.error('Test runner crashed:', error);
    process.exit(1);
  });
}

export default TestRunner;