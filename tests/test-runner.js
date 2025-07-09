#!/usr/bin/env node
/**
 * ABsmartly MCP Test Runner
 * Runs all tests before deployment to ensure system integrity
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TestRunner {
  constructor() {
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.results = [];
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

  async runTest(testFile, testPath) {
    this.log(`\n📋 Running ${testFile}...`);
    
    try {
      // Import the test module
      const testModule = await import(testPath);
      
      if (typeof testModule.default === 'function') {
        const result = await testModule.default();
        
        if (result && result.success) {
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
        const jsTests = unitTests.filter(file => file.endsWith('.js'));
        
        for (const testFile of jsTests) {
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
      try {
        const integrationTests = await readdir(integrationTestDir);
        const jsTests = integrationTests.filter(file => file.endsWith('.js'));
        
        for (const testFile of jsTests) {
          await this.runTest(testFile, join(integrationTestDir, testFile));
        }
      } catch (error) {
        this.log(`No integration tests directory found: ${error.message}`, 'warning');
      }
    }

    // Print summary
    this.printSummary();
    
    // Exit with appropriate code
    process.exit(this.failedTests > 0 ? 1 : 0);
  }

  printSummary() {
    this.log('\n' + '='.repeat(60));
    this.log('📊 Test Summary', 'info');
    this.log('='.repeat(60));
    
    this.log(`Total Tests: ${this.totalTests}`);
    this.log(`Passed: ${this.passedTests}`, 'success');
    this.log(`Failed: ${this.failedTests}`, this.failedTests > 0 ? 'error' : 'success');
    
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
  const options = {
    unitOnly: args.includes('--unit-only'),
    integrationOnly: args.includes('--integration-only')
  };
  
  const runner = new TestRunner();
  runner.runAllTests(options).catch(error => {
    console.error('Test runner crashed:', error);
    process.exit(1);
  });
}

export default TestRunner;