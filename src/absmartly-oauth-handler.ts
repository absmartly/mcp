import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { debug } from './config';
import type { Env } from './types';
import {
  DEFAULT_OAUTH_CLIENT_ID,
  OAUTH_STATE_TTL_SECONDS,
  safeKvGet,
} from './shared';
import {
  beginAuthorization,
  generatePkcePair,
  submitConsent,
  toFetchResponse,
  type ConsentOptions,
  type ConsentOutcome,
  type OAuthStateStore,
} from './oauth/index.js';

type OAuthBindings = Env & { OAUTH_PROVIDER: OAuthHelpers };
type OAuthContext = Context<{ Bindings: OAuthBindings }>;
type AbsmartlyAuthRequest = AuthRequest;

const AUTHORIZE_PATH = '/authorize';
const HOST_COOKIE_PREFIX = 'host';
// One cookie per upstream login, named after its state token, so parallel logins in the
// same browser don't overwrite each other's binding.
const CALLBACK_COOKIE_NAME_PREFIX = 'absmartly-oauth-cb-';
const HTTP_STATUS_BAD_REQUEST = 400;
const ENDPOINT_QUERY_PARAM = 'absmartly-endpoint';
const ENDPOINT_HEADER = 'x-absmartly-endpoint';
// 0.10.x defaults completeAuthorization to revoking every other grant for the same
// user+client. A user can hold concurrent grants for the same client against different
// ABsmartly endpoints (#42 keys approvals per endpoint) or on a second device with a
// fixed-redirect-URI CIMD client; keep 0.0.5's behaviour of leaving those grants alone.
const REVOKE_EXISTING_GRANTS_ON_NEW_LOGIN = false;

function kvStateStore(kv: KVNamespace): OAuthStateStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds }),
    delete: (key) => kv.delete(key),
  };
}

export class ABsmartlyOAuthHandler extends Hono<{ Bindings: OAuthBindings }> {
  // The resource parameter may repeat (RFC 8707); use the first that names an endpoint.
  private extractEndpointFromResource(resourceParam: string | string[] | null | undefined): string | null {
    const resources = Array.isArray(resourceParam) ? resourceParam : resourceParam ? [resourceParam] : [];
    for (const resource of resources) {
      try {
        const endpoint = new URL(resource).searchParams.get(ENDPOINT_QUERY_PARAM);
        if (endpoint) return endpoint;
      } catch {
        continue;
      }
    }
    return null;
  }

  private consentOptions(c: OAuthContext): ConsentOptions<AbsmartlyAuthRequest> {
    return {
      store: kvStateStore(c.env.OAUTH_KV),
      formAction: AUTHORIZE_PATH,
      lookupClient: (clientId) => c.env.OAUTH_PROVIDER.lookupClient(clientId),
      requireEndpoint: true,
      rememberApprovals: true,
      // Runs before the transaction is discarded, so a failed write leaves the
      // transaction (and its binding cookie) in place for the client to retry.
      onApprove: async (authRequest, endpoint) => {
        await c.env.OAUTH_KV.put(
          `oauth_endpoint:client:${authRequest.clientId}`,
          endpoint as string,
          { expirationTtl: OAUTH_STATE_TTL_SECONDS }
        );
      },
    };
  }

  private async finishConsent(c: OAuthContext, outcome: ConsentOutcome<AbsmartlyAuthRequest>): Promise<Response> {
    if (outcome.type === 'respond') return toFetchResponse(outcome.response);
    const endpoint = outcome.endpoint as string;
    const response = await this.redirectToAbsmartlyOAuth(c, outcome.authRequest, endpoint);
    for (const cookie of outcome.setCookies) response.headers.append('Set-Cookie', cookie);
    return response;
  }

  constructor() {
    super();

    this.use('*', async (c, next) => {
      debug(`ABsmartlyOAuthHandler: ${c.req.method} ${c.req.url}`);
      await next();
    });

    this.get(AUTHORIZE_PATH, async (c) => {
      const url = new URL(c.req.url);
      let authRequest: AbsmartlyAuthRequest;
      try {
        authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
      } catch (e) {
        debug('Failed to parse authorization request:', e);
        return c.text('Invalid authorization request', HTTP_STATUS_BAD_REQUEST);
      }

      let absmartlyEndpoint = this.extractEndpointFromResource(authRequest.resource) ||
                              url.searchParams.get(ENDPOINT_QUERY_PARAM) ||
                              c.req.header(ENDPOINT_HEADER) || null;
      if (!absmartlyEndpoint) {
        absmartlyEndpoint = await safeKvGet(c.env.OAUTH_KV, `oauth_endpoint:client:${authRequest.clientId}`);
      }

      const outcome = await beginAuthorization(
        { authRequest, endpoint: absmartlyEndpoint, cookieHeader: c.req.header('Cookie') },
        this.consentOptions(c),
      );
      return this.finishConsent(c, outcome);
    });

    this.post(AUTHORIZE_PATH, async (c) => {
      let formData;
      try {
        formData = await c.req.formData();
      } catch (e) {
        debug('Failed to parse form data:', e);
        return c.text('Invalid form data', HTTP_STATUS_BAD_REQUEST);
      }
      const outcome = await submitConsent<AbsmartlyAuthRequest>(
        {
          form: {
            action: formData.get('action') as string | null,
            transactionId: formData.get('transaction_id') as string | null,
            endpoint: formData.get('absmartly_endpoint') as string | null,
          },
          cookieHeader: c.req.header('Cookie'),
        },
        this.consentOptions(c),
      );
      return this.finishConsent(c, outcome);
    });

    this.get('/oauth/callback', async (c) => {
      const env = c.env;
      const url = new URL(c.req.url);

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        debug('OAuth callback error:', error);
        return c.text(`OAuth error: ${error}`, 400);
      }

      if (!code || !state) {
        return c.text('Missing code or state parameter', 400);
      }

      let storedState: string | null;
      try {
        storedState = await env.OAUTH_KV.get(`oauth:state:${state}`);
      } catch (e) {
        console.error('Failed to read OAuth state from KV:', e);
        return c.text('Service temporarily unavailable, please try again', 503);
      }
      if (!storedState) {
        debug('Invalid or expired state token:', state);
        return c.text('Invalid or expired state', 400);
      }

      let oauthReqInfo;
      try {
        oauthReqInfo = JSON.parse(storedState);
      } catch (e) {
        debug('Failed to parse stored state:', e);
        return c.text('Invalid state data', 400);
      }

      const callbackCookieName = `${CALLBACK_COOKIE_NAME_PREFIX}${state}`;
      const browserBinding = getCookie(c, callbackCookieName, HOST_COOKIE_PREFIX);
      if (!oauthReqInfo.browserBinding || browserBinding !== oauthReqInfo.browserBinding) {
        debug('OAuth callback browser binding mismatch');
        return c.text('This login was started in a different browser, please restart the connection from your MCP client', 400);
      }

      try {
        await env.OAUTH_KV.delete(`oauth:state:${state}`);
      } catch (e) {
        console.warn('Failed to delete OAuth state token (non-critical):', e);
      }
      deleteCookie(c, callbackCookieName, { prefix: HOST_COOKIE_PREFIX, path: '/', secure: true });

      const absmartlyEndpoint = oauthReqInfo.absmartlyEndpoint;
      if (!absmartlyEndpoint) {
        debug('No absmartlyEndpoint in stored state');
        return c.text('Missing ABsmartly endpoint in OAuth state', 400);
      }
      const cleanEndpoint = absmartlyEndpoint.replace(/\/+$/, '');
      const tokenUrl = `${cleanEndpoint}/auth/oauth/token`;
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.ABSMARTLY_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID,
        code: code,
        redirect_uri: `${url.origin}/oauth/callback`,
      });

      if (oauthReqInfo.codeVerifier) {
        tokenBody.set('code_verifier', oauthReqInfo.codeVerifier);
      }

      if (env.ABSMARTLY_OAUTH_CLIENT_SECRET) {
        tokenBody.set('client_secret', env.ABSMARTLY_OAUTH_CLIENT_SECRET);
      }

      debug('Exchanging code with ABsmartly:', tokenUrl);

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenBody,
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        debug('Token exchange failed:', errorText);
        return c.text('Token exchange with ABsmartly failed', 500);
      }

      const tokenData = await tokenResponse.json() as { access_token: string; api_key?: string; absmartly_api_key?: string };
      debug('Token exchange successful');

      const userInfoUrl = `${cleanEndpoint}/auth/oauth/userinfo`;
      let userInfo: any;
      try {
        const userInfoResponse = await fetch(userInfoUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json',
          },
        });
        if (!userInfoResponse.ok) {
          const errorText = await userInfoResponse.text();
          debug('userinfo request failed:', userInfoResponse.status, errorText);
          return c.text('Failed to fetch user identity from ABsmartly', 500);
        }
        userInfo = await userInfoResponse.json();
        debug('userinfo response keys:', Object.keys(userInfo || {}));
      } catch (error) {
        debug('userinfo request error:', error);
        return c.text('Failed to fetch user identity from ABsmartly', 500);
      }

      const finalEmail: string = userInfo?.email || userInfo?.sub;
      const finalName: string = userInfo?.name ||
        [userInfo?.given_name, userInfo?.family_name].filter(Boolean).join(' ').trim() ||
        finalEmail;
      const finalUserId: string = userInfo?.sub ||
        (userInfo?.absmartly_user_id != null ? String(userInfo.absmartly_user_id) : '') ||
        finalEmail;

      if (!finalEmail) {
        debug('No email/sub in userinfo response:', userInfo);
        return c.text('Authentication failed: no user identity found', 400);
      }

      debug('Extracted user details:', { email: finalEmail, name: finalName, userId: finalUserId });

      const apiEndpoint = cleanEndpoint.endsWith('/v1') ? cleanEndpoint : `${cleanEndpoint}/v1`;

      let result;
      try {
        result = await env.OAUTH_PROVIDER.completeAuthorization({
          request: oauthReqInfo.authRequest,
          userId: finalUserId,
          metadata: {},
          scope: oauthReqInfo.authRequest.scope,
          props: {
            email: finalEmail,
            name: finalName,
            absmartly_endpoint: apiEndpoint,
            oauth_jwt: tokenData.access_token,
            user_id: finalUserId,
            absmartly_api_key: tokenData.api_key || tokenData.absmartly_api_key || undefined
          },
          revokeExistingGrants: REVOKE_EXISTING_GRANTS_ON_NEW_LOGIN
        });
      } catch (e) {
        debug('Failed to complete authorization:', e);
        return c.text('Authorization failed', 500);
      }

      return c.redirect(result.redirectTo);
    });
  }

  private async redirectToAbsmartlyOAuth(c: OAuthContext, authRequest: AbsmartlyAuthRequest, absmartlyEndpoint: string) {
    const url = new URL(c.req.url);
    const env = c.env;

    debug(`ABsmartly endpoint for OAuth redirect: ${absmartlyEndpoint}`);

    const cleanEndpoint = absmartlyEndpoint.replace(/\/+$/, '');
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const stateToken = crypto.randomUUID();
    const browserBinding = crypto.randomUUID();
    const stateData = {
      authRequest,
      absmartlyEndpoint: cleanEndpoint,
      codeVerifier,
      browserBinding,
    };

    try {
      await env.OAUTH_KV.put(
        `oauth:state:${stateToken}`,
        JSON.stringify(stateData),
        { expirationTtl: OAUTH_STATE_TTL_SECONDS }
      );
    } catch (error) {
      console.error('Failed to store OAuth state token:', error);
      return new Response('Service temporarily unavailable', { status: 503 });
    }

    const absmartlyOAuthUrl = new URL(`${cleanEndpoint}/auth/oauth/authorize`);
    absmartlyOAuthUrl.searchParams.set('client_id', env.ABSMARTLY_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID);
    absmartlyOAuthUrl.searchParams.set('redirect_uri', `${url.origin}/oauth/callback`);
    absmartlyOAuthUrl.searchParams.set('scope', 'mcp:access');
    absmartlyOAuthUrl.searchParams.set('response_type', 'code');
    absmartlyOAuthUrl.searchParams.set('state', stateToken);
    absmartlyOAuthUrl.searchParams.set('code_challenge', codeChallenge);
    absmartlyOAuthUrl.searchParams.set('code_challenge_method', 'S256');

    // Set only after consent was given, so /oauth/callback can require that the browser
    // finishing the login is the one that approved it (MCP security best practices).
    setCookie(c, `${CALLBACK_COOKIE_NAME_PREFIX}${stateToken}`, browserBinding, {
      prefix: HOST_COOKIE_PREFIX,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: OAUTH_STATE_TTL_SECONDS
    });
    return c.redirect(absmartlyOAuthUrl.toString());
  }
}
