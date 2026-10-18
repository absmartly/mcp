// API-key authentication on the MCP transports (/sse and /mcp). The Worker
// verifies the key against GET /auth/current-user before serving the request.
// Clients treat a 401 as "start OAuth again", so the Worker must answer 401
// only for an invalid key, and 403 (no OAuth challenge) for a valid key whose
// user lacks Self:Get / User:Get.
import assert from 'node:assert';
import { handleApiKeyTransportRequest } from '../../src/api-key-auth';
import { MCP_PATH, SSE_PATH } from '../../src/shared';

const ORIGIN = 'https://mcp.absmartly.com';
const BACKEND = 'https://demo.absmartly.com';
const API_KEY = 'test-api-key-fixture';
const FORBIDDEN_MESSAGE = 'User does not have the required access.';
const TRANSPORTS = [SSE_PATH, MCP_PATH];

type BackendReply = { status: number; body: unknown } | 'network-error';

async function withBackend(reply: BackendReply, fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = (async () => {
    if (reply === 'network-error') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  console.error = () => {};
  try { await fn(); } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

function transportRoute(pathPrefix: string) {
  const served: Array<{ props: any }> = [];
  return {
    served,
    route: {
      pathPrefix,
      handler: {
        fetch: async (_request: Request, _env: any, ctx: any) => {
          served.push({ props: ctx.props });
          return new Response('served', { status: 200 });
        },
      },
    },
  };
}

async function callTransport(pathPrefix: string) {
  const { route, served } = transportRoute(pathPrefix);
  const request = new Request(`${ORIGIN}${pathPrefix}`, { headers: { Authorization: API_KEY } });
  const response = await handleApiKeyTransportRequest(request, {}, {}, route, API_KEY, BACKEND);
  return { response, served };
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  for (const transport of TRANSPORTS) {
    await asyncTest(`${transport}: backend 401 returns 401 with the OAuth challenge`, async () => {
      await withBackend({ status: 401, body: { ok: false, errors: ['Invalid API key'] } }, async () => {
        const { response, served } = await callTransport(transport);
        assert.strictEqual(response.status, 401);
        const challenge = response.headers.get('WWW-Authenticate');
        assert.ok(challenge, 'WWW-Authenticate header is present');
        assert.ok(challenge!.startsWith('Bearer '), `Bearer challenge, got ${challenge}`);
        assert.ok(
          challenge!.includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource${transport}"`),
          `challenge points at this transport's resource metadata, got ${challenge}`,
        );
        assert.strictEqual(served.length, 0, 'the MCP handler is not reached');
      });
    });

    await asyncTest(`${transport}: backend 403 returns 403 with the backend message and no challenge`, async () => {
      await withBackend({ status: 403, body: { ok: false, errors: [FORBIDDEN_MESSAGE] } }, async () => {
        const { response, served } = await callTransport(transport);
        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.headers.get('WWW-Authenticate'), null);
        const body = await response.text();
        assert.ok(body.includes(FORBIDDEN_MESSAGE), `body carries the backend message, got ${JSON.stringify(body)}`);
        assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*', 'CORS headers kept');
        assert.strictEqual(served.length, 0, 'the MCP handler is not reached');
      });
    });

    await asyncTest(`${transport}: backend 403 with a non-JSON body still returns 403`, async () => {
      const originalFetch = globalThis.fetch;
      const originalError = console.error;
      globalThis.fetch = (async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
      console.error = () => {};
      try {
        const { response } = await callTransport(transport);
        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.headers.get('WWW-Authenticate'), null);
        assert.ok((await response.text()).includes('Forbidden'));
      } finally {
        globalThis.fetch = originalFetch;
        console.error = originalError;
      }
    });

    await asyncTest(`${transport}: backend 5xx still returns 503 without a challenge`, async () => {
      await withBackend({ status: 502, body: { ok: false } }, async () => {
        const { response, served } = await callTransport(transport);
        assert.strictEqual(response.status, 503);
        assert.strictEqual(await response.text(), 'ABsmartly service temporarily unavailable');
        assert.strictEqual(response.headers.get('WWW-Authenticate'), null);
        assert.strictEqual(served.length, 0);
      });
    });

    await asyncTest(`${transport}: network failure still returns 503 without a challenge`, async () => {
      await withBackend('network-error', async () => {
        const { response } = await callTransport(transport);
        assert.strictEqual(response.status, 503);
        assert.strictEqual(response.headers.get('WWW-Authenticate'), null);
      });
    });

    await asyncTest(`${transport}: valid key with Self:Get is served with the user's props`, async () => {
      await withBackend({ status: 200, body: { user: { id: 7, email: 'a@b.c', first_name: 'A', last_name: 'B' } } }, async () => {
        const { response, served } = await callTransport(transport);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(served.length, 1);
        assert.strictEqual(served[0].props.user_id, '7');
        assert.strictEqual(served[0].props.absmartly_api_key, API_KEY);
      });
    });
  }

  return {
    success: failed === 0,
    message: `${passed}/${passed + failed} tests passed`,
    testCount: passed + failed,
    details,
  };
}
