/**
 * OAuth Test Runner
 * 
 * Comprehensive test suite for all OAuth flow implementations.
 * Runs all OAuth-related tests and provides unified reporting.
 */

import { runManual401Tests } from './manual-401-response.test.js';
import { runPublicClientRegistrationTests } from './public-client-registration.test.js';
import { runAutoRegistrationTests } from './auto-registration.test.js';
import { runPKCETokenExchangeTests } from './pkce-token-exchange.test.js';
import { runOAuthFlowTests } from '../integration/oauth-flow.test.js';

/**
 * Main test runner for all OAuth tests
 */
async function runAllOAuthTests() {
    console.log('🚀 Starting Comprehensive OAuth Test Suite\\n');
    console.log('========================================\\n');
    
    const testSuites = [
        {
            name: 'Manual 401 Response Tests',
            runner: runManual401Tests,
            description: 'Tests manual 401 responses to trigger OAuth flow'
        },
        {
            name: 'Public Client Registration Tests',
            runner: runPublicClientRegistrationTests,
            description: 'Tests client registration without client_secret'
        },
        {
            name: 'Auto-Registration Tests',
            runner: runAutoRegistrationTests,
            description: 'Tests auto-registration of deleted clients'
        },
        {
            name: 'PKCE Token Exchange Tests',
            runner: runPKCETokenExchangeTests,
            description: 'Tests PKCE token exchange for public clients'
        },
        {
            name: 'OAuth Flow Integration Tests',
            runner: runOAuthFlowTests,
            description: 'End-to-end OAuth flow integration tests'
        }
    ];
    
    const results = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    
    for (const suite of testSuites) {
        console.log(`\\n📋 Running ${suite.name}:`);
        console.log(`   ${suite.description}`);
        console.log('   ' + '─'.repeat(50));
        
        try {
            const result = await suite.runner();
            results.push({
                name: suite.name,
                ...result
            });
            
            if (result.success) {
                totalPassed += result.testCount || 0;
                console.log(`   ✅ ${suite.name}: ${result.testCount || 0} tests passed`);
            } else {
                totalFailed += result.testCount || 1;
                console.log(`   ❌ ${suite.name}: Failed - ${result.error || 'Unknown error'}`);
            }
            
            if (result.message) {
                console.log(`   ℹ️  ${result.message}`);
            }
            
        } catch (error) {
            console.error(`   💥 ${suite.name}: Crashed - ${error.message}`);
            results.push({
                name: suite.name,
                success: false,
                error: error.message,
                testCount: 1
            });
            totalFailed += 1;
        }
    }
    
    // Print summary
    console.log('\\n' + '='.repeat(60));
    console.log('📊 OAUTH TEST SUITE SUMMARY');
    console.log('='.repeat(60));
    
    results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        const count = result.testCount || 0;
        const countText = count > 0 ? ` (${count} tests)` : '';
        console.log(`${status} ${result.name}${countText}`);
        
        if (!result.success && result.error) {
            console.log(`   Error: ${result.error}`);
        }
        if (result.message) {
            console.log(`   ${result.message}`);
        }
    });
    
    console.log('\\n' + '─'.repeat(60));
    console.log(`📈 TOTALS:`);
    console.log(`   ✅ Passed: ${totalPassed} tests`);
    console.log(`   ❌ Failed: ${totalFailed} tests`);
    
    if (totalSkipped > 0) {
        console.log(`   ⏭️  Skipped: ${totalSkipped} tests`);
    }
    
    const successRate = totalPassed + totalFailed > 0 
        ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100) 
        : 0;
    console.log(`   📊 Success Rate: ${successRate}%`);
    
    const overallSuccess = totalFailed === 0;
    console.log('\\n' + '='.repeat(60));
    
    if (overallSuccess) {
        console.log('🎉 ALL OAUTH TESTS PASSED!');
        console.log('\\nYour OAuth implementation is working correctly:');
        console.log('✅ Manual 401 responses trigger OAuth flow');
        console.log('✅ Public clients register without client_secret');
        console.log('✅ Deleted clients auto-register correctly');
        console.log('✅ PKCE token exchange works for public clients');
        console.log('✅ End-to-end OAuth flow is functional');
    } else {
        console.log('⚠️  SOME OAUTH TESTS FAILED');
        console.log('\\nPlease review the failed tests above and fix the issues.');
        console.log('This may indicate problems with your OAuth implementation.');
    }
    
    console.log('\\n' + '='.repeat(60));
    
    return {
        success: overallSuccess,
        totalTests: totalPassed + totalFailed,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        successRate: successRate,
        results: results
    };
}

/**
 * Run specific test suite by name
 */
async function runSpecificTestSuite(suiteName) {
    const suiteMap = {
        '401': runManual401Tests,
        'manual401': runManual401Tests,
        'registration': runPublicClientRegistrationTests,
        'public': runPublicClientRegistrationTests,
        'auto': runAutoRegistrationTests,
        'pkce': runPKCETokenExchangeTests,
        'token': runPKCETokenExchangeTests,
        'integration': runOAuthFlowTests,
        'flow': runOAuthFlowTests
    };
    
    const runner = suiteMap[suiteName.toLowerCase()];
    
    if (!runner) {
        console.error(`❌ Unknown test suite: ${suiteName}`);
        console.log('\\nAvailable test suites:');
        console.log('  • 401, manual401 - Manual 401 response tests');
        console.log('  • registration, public - Public client registration tests');
        console.log('  • auto - Auto-registration tests');
        console.log('  • pkce, token - PKCE token exchange tests');
        console.log('  • integration, flow - OAuth flow integration tests');
        return { success: false, error: 'Unknown test suite' };
    }
    
    console.log(`🚀 Running ${suiteName} test suite...\\n`);
    return await runner();
}

/**
 * Print usage information
 */
function printUsage() {
    console.log('OAuth Test Runner Usage:');
    console.log('');
    console.log('Run all tests:');
    console.log('  node oauth-test-runner.js');
    console.log('');
    console.log('Run specific test suite:');
    console.log('  node oauth-test-runner.js [suite-name]');
    console.log('');
    console.log('Available test suites:');
    console.log('  • 401          - Manual 401 response tests');
    console.log('  • registration - Public client registration tests');
    console.log('  • auto         - Auto-registration tests');
    console.log('  • pkce         - PKCE token exchange tests');
    console.log('  • integration  - OAuth flow integration tests');
    console.log('');
    console.log('Environment variables:');
    console.log('  • TEST_BASE_URL       - Base URL for OAuth server (default: http://localhost:8787)');
    console.log('  • TEST_OAUTH_TOKEN    - Valid OAuth token for authenticated tests');
    console.log('  • MCP_SERVER_URL      - MCP server URL for integration tests');
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }
    
    if (args.length === 0) {
        // Run all tests
        runAllOAuthTests().then(result => {
            process.exit(result.success ? 0 : 1);
        });
    } else {
        // Run specific test suite
        const suiteName = args[0];
        runSpecificTestSuite(suiteName).then(result => {
            process.exit(result.success ? 0 : 1);
        });
    }
}

export { runAllOAuthTests, runSpecificTestSuite };
export default runAllOAuthTests;