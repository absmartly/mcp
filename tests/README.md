# ABsmartly MCP Test Suite

Comprehensive test suite for the ABsmartly Model Context Protocol (MCP) server. This test suite ensures all functionality works correctly before deployment.

## Quick Start

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Deploy (automatically runs tests first)
npm run deploy

# Force deploy without tests (not recommended)
npm run deploy:force
```

## Test Structure

```
tests/
├── test-runner.js           # Main test runner
├── unit/                    # Unit tests (isolated functionality)
│   ├── auth-parser.test.js  # Authentication header parsing
│   ├── url-generator.test.js # URL generation logic
│   └── legacy-features.test.js # Migrated legacy tests
├── integration/             # Integration tests (live endpoints)
│   ├── health-check.test.js # Health endpoint functionality
│   └── authentication.test.js # Authentication flow testing
└── fixtures/                # Test data and fixtures
```

## Release gate

`npm publish` can't go ahead unless the e2e suite has actually run and passed.
2.0.0 and 2.0.1 reached npm with a Worker that crashed at module load
(Cloudflare error 10021). Every Worker-backed suite reported "skipped", and
the run stayed green.

- `npm run test:e2e` runs the integration suites in **gated mode** (`--gated`;
  `REQUIRE_E2E=1` or `CI=true` also turn it on). It starts a fresh
  `wrangler dev` from this checkout on a free port and never reuses a server
  that's already running. The run fails when:
  - the Worker doesn't become healthy (wrangler's output is printed);
  - any suite or scenario would skip (no credentials, server unreachable,
    backend error);
  - fewer than `GATED_MIN_INTEGRATION_TESTS` (in `tests/test-runner.js`)
    integration tests ran.
- `npm run verify:release` runs typecheck, unit tests, build, the Worker
  startup smoke test (`scripts/worker-smoke.sh`) and `test:e2e`.
  `prepublishOnly` runs it, so a local `npm publish` is gated too.
- `.github/workflows/npm-publish.yml` has `version-check` → `e2e` → `publish`.
  `publish` needs `e2e`, and `npm publish` there runs `prepublishOnly` again.
  The release-triggered `publish.yml` also needs a gated e2e job.
- Every pull request runs the same gated job (check name `e2e / e2e` in
  `ci.yml`). All three callers use the reusable `.github/workflows/e2e.yml`,
  so the merge gate and the release gate can't drift. Concurrency is per
  workflow and ref: a new push to a PR cancels that PR's older run, and
  publish runs are never cancelled.
  Pull requests from forks get no secrets, so the job fails for them with an
  explicit message; push the branch to `absmartly/mcp` instead.

Required repo secrets (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `ABSMARTLY_API_KEY` | API key for the test-1 instance |
| `ABSMARTLY_API_ENDPOINT` | `https://test-1.absmartly.com/v1` |

Without them the `e2e` job fails, so nothing merges (once it's a required check) and nothing is published.

Outside gated mode (`npm run test:integration`), the suites still skip when
credentials or the Worker are missing, so you can run them locally. Each skip
is logged as `SKIPPED (local run only; a gated run fails here)`. Credentials
come from `ABSMARTLY_API_KEY`/`ABSMARTLY_API_ENDPOINT` (or `.env.local`), or
from `--profile <name>`.

The `claude-*.test.js` suites drive a real model through `claude -p`. They're
opt-in (`npm run test:claude`) and aren't part of the gate.

## Test Categories

### Unit Tests
Test isolated functionality without external dependencies:

- **Authentication Parser**: Tests all four authentication header formats
- **URL Generator**: Tests experiment URL generation from API endpoints
- **Legacy Features**: Migrated tests from individual scripts ensuring backwards compatibility

### Integration Tests
Test the local Worker (a fresh `wrangler dev`) and the test-1 API:

- **Health Check**: Validates deployed health endpoint
- **Authentication**: Tests authentication flow and endpoint accessibility

## Test Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests (unit + integration) |
| `npm run test:unit` | Run only unit tests |
| `npm run test:integration` | Run only integration tests |
| `npm run test:legacy` | Run old individual test scripts |
| `npm run precommit` | Run tests before commit |

## Continuous Integration

The test suite is integrated into the deployment process:

- **`npm run deploy`** automatically runs tests before deploying
- **`npm run deploy:force`** skips tests (use only in emergencies)
- Tests must pass for deployment to proceed

## Authentication Format Tests

The test suite validates all four supported authentication formats:

1. **Subdomain Format**: `Authorization: demo-1 BxYKd1U2DlzOLJ74`
2. **Api-Key Format**: `Authorization: Api-Key BxYKd1U2DlzOLJ74`
3. **Bearer Token**: `Authorization: Bearer oauth_token_here`
4. **Simple API Key**: `Authorization: BxYKd1U2DlzOLJ74`

## URL Generation Tests

Validates experiment URL generation from API endpoints:

- Sandbox: `https://sandbox.absmartly.com/v1` → `https://sandbox.absmartly.com/experiments/123`
- Customer: `https://demo-1.absmartly.com/v1` → `https://demo-1.absmartly.com/experiments/123`
- Local: `http://localhost:8000/v1` → `http://localhost:8000/experiments/123`

## Writing New Tests

### Unit Test Template

```javascript
export default function runMyTests() {
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

  // Your tests here
  test('My test case', () => {
    // Test logic
    return true; // or false
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}
```

### Integration Test Template

```javascript
export default async function runMyIntegrationTests() {
  let passed = 0;
  let failed = 0;
  const results = [];

  async function test(name, testFn) {
    try {
      const result = await testFn();
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

  // Your async tests here
  await test('My async test', async () => {
    const response = await fetch('https://example.com');
    return response.ok;
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}
```

## Migrated Legacy Tests

The following individual test scripts have been migrated into the unified test suite:

- `test-auth-formats.js` → `unit/auth-parser.test.js`
- `test-url-generation.js` → `unit/url-generator.test.js`
- `test-dynamic-fields-complete.js` → `unit/legacy-features.test.js`
- `test-type-based-naming.js` → `unit/legacy-features.test.js`

Legacy scripts are still available via `npm run test:legacy` for backwards compatibility.

## Test Configuration

### Environment Variables

Tests can be configured via environment variables:

```bash
# Test against different endpoints
TEST_BASE_URL=https://staging.mcp.absmartly.com npm test

# Skip integration tests
SKIP_INTEGRATION=true npm test

# Verbose output
VERBOSE=true npm test
```

### Timeout Configuration

Integration tests use a 10-second timeout by default. Adjust in individual test files:

```javascript
const response = await fetchWithTimeout(url, options, 15000); // 15 second timeout
```

## Troubleshooting

### Common Issues

1. **Integration tests failing**: Check if `mcp.absmartly.com` is accessible
2. **Authentication tests failing**: Verify endpoints are responding correctly
3. **Timeout errors**: Increase timeout values for slow networks

### Debug Mode

Run tests with verbose output:

```bash
VERBOSE=true npm test
```

### Individual Test Execution

Run specific test files directly:

```bash
node tests/unit/auth-parser.test.js
node tests/integration/health-check.test.js
```

## Contributing

When adding new functionality:

1. Write unit tests for isolated logic
2. Write integration tests for API endpoints
3. Update this README if new test categories are added
4. Ensure all tests pass before committing

The test suite is designed to catch regressions and ensure reliable deployments. All new features should include corresponding tests.