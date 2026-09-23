import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { debug } from './config';
import type { Env } from './types';
import {
  DEFAULT_OAUTH_CLIENT_ID,
  OAUTH_STATE_TTL_SECONDS,
  APPROVAL_COOKIE_MAX_AGE_SECONDS,
  safeKvGet,
  escapeHtml,
  generatePkcePair,
  REQUIRED_CODE_CHALLENGE_METHOD,
} from './shared';

interface OAuthEnv extends Env {
  OAUTH_PROVIDER: {
    parseAuthRequest(request: Request): Promise<any>;
    lookupClient(clientId: string): Promise<any>;
    completeAuthorization(options: any): Promise<{ redirectTo: string }>;
  };
}

const COOKIE_NAME = 'absmartly-oauth-approvals';
const PKCE_REQUIRED_MESSAGE = `PKCE with code_challenge_method=${REQUIRED_CODE_CHALLENGE_METHOD} is required`;
const CONSENT_COOKIE_NAME = 'absmartly-oauth-consent';
const CONSENT_KV_PREFIX = 'oauth:consent:';
const CONSENT_TTL_SECONDS = 10 * 60;

type ConsentTransaction = {
  authRequest: any;
  absmartlyEndpoint: string | null;
  browserBinding: string;
};

function hasRequiredPkce(codeChallenge: string | null | undefined, codeChallengeMethod: string | null | undefined): boolean {
  return !!codeChallenge && codeChallengeMethod === REQUIRED_CODE_CHALLENGE_METHOD;
}

export class ABsmartlyOAuthHandler extends Hono {
  private extractEndpointFromResource(resourceParam: string | null): string | null {
    if (!resourceParam) return null;
    try {
      const resourceUrl = new URL(resourceParam);
      return resourceUrl.searchParams.get('absmartly-endpoint');
    } catch {
      return null;
    }
  }

  private normalizeEndpoint(raw: string): string {
    let endpoint = raw.trim().replace(/\/+$/, '');
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = 'https://' + endpoint;
    }
    return endpoint;
  }

  constructor() {
    super();

    this.use('*', async (c, next) => {
      debug(`ABsmartlyOAuthHandler: ${c.req.method} ${c.req.url}`);
      await next();
    });

    this.get('/authorize', async (c) => {
      debug('ABsmartlyOAuthHandler: Hit /authorize endpoint');
      const env = c.env as OAuthEnv;
      const url = new URL(c.req.url);

      let authRequest;
      let clientInfo;
      try {
        authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
        clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
      } catch (e) {
        debug('Failed to parse authorization request:', e);
        return c.text('Invalid authorization request', 400);
      }
      if (!clientInfo) {
        return c.text('Client not found', 400);
      }
      // The provider only checks redirect_uri when one is supplied; an empty value
      // must not reach completeAuthorization, which redirects there unchecked.
      if (!authRequest.redirectUri || !clientInfo.redirectUris?.includes(authRequest.redirectUri)) {
        return c.text('Invalid redirect URI', 400);
      }
      if (!hasRequiredPkce(authRequest.codeChallenge, authRequest.codeChallengeMethod)) {
        return c.text(PKCE_REQUIRED_MESSAGE, 400);
      }

      let absmartlyEndpoint = this.extractEndpointFromResource(authRequest.resource) ||
                              url.searchParams.get('absmartly-endpoint') ||
                              c.req.header('x-absmartly-endpoint');

      if (!absmartlyEndpoint) {
        const stored = await safeKvGet(env.OAUTH_KV, `oauth_endpoint:client:${authRequest.clientId}`);
        if (stored) {
          debug('Retrieved endpoint from KV (per-client_id):', stored);
          absmartlyEndpoint = stored;
        }
      }

      if (absmartlyEndpoint) {
        debug('Resolved ABsmartly endpoint:', absmartlyEndpoint);
        const approvedClients = await this.getApprovedClients(c);
        if (approvedClients.includes(authRequest.clientId)) {
          debug('Client is pre-approved, redirecting to ABsmartly OAuth');
          return this.redirectToAbsmartlyOAuth(c, authRequest, absmartlyEndpoint);
        }
      }

      let transactionId;
      try {
        transactionId = await this.createConsentTransaction(c, authRequest, absmartlyEndpoint || null);
      } catch (e) {
        console.error('Failed to store consent transaction:', e);
        return c.text('Service temporarily unavailable, please try again', 503);
      }

      if (!absmartlyEndpoint) {
        return this.renderEndpointForm(c, transactionId);
      }
      return this.renderApprovalPage(c, clientInfo, authRequest, absmartlyEndpoint, transactionId);
    });

    this.post('/authorize', async (c) => {
      const env = c.env as OAuthEnv;
      let formData;
      try {
        formData = await c.req.formData();
      } catch (e) {
        debug('Failed to parse form data:', e);
        return c.text('Invalid form data', 400);
      }
      const action = formData.get('action');
      const transactionId = formData.get('transaction_id') as string || '';

      // Every authorization parameter comes from the transaction stored at GET /authorize,
      // never from the form, so a forged POST cannot pick its own client or redirect URI.
      const transaction = await this.loadConsentTransaction(c, transactionId);
      if (!transaction) {
        return c.text('Authorization request expired or invalid, please restart the connection from your MCP client', 400);
      }
      const { authRequest } = transaction;

      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
      if (!clientInfo || !clientInfo.redirectUris?.includes(authRequest.redirectUri)) {
        await this.deleteConsentTransaction(c, transactionId);
        return c.text('Invalid redirect URI', 400);
      }

      if (action === 'cancel') {
        await this.deleteConsentTransaction(c, transactionId);
        const denyUrl = new URL(authRequest.redirectUri);
        denyUrl.searchParams.set('error', 'access_denied');
        if (authRequest.state) {
          denyUrl.searchParams.set('state', authRequest.state);
        }
        return c.redirect(denyUrl.toString());
      }

      if (action === 'set_endpoint') {
        const absmartlyEndpoint = this.normalizeEndpoint(formData.get('absmartly_endpoint') as string || '');
        if (!absmartlyEndpoint) {
          return c.text('ABsmartly endpoint is required', 400);
        }
        transaction.absmartlyEndpoint = absmartlyEndpoint;
        try {
          await this.saveConsentTransaction(c, transactionId, transaction);
        } catch (e) {
          console.error('Failed to update consent transaction:', e);
          return c.text('Service temporarily unavailable, please try again', 503);
        }
        return this.renderApprovalPage(c, clientInfo, authRequest, absmartlyEndpoint, transactionId);
      }

      if (action !== 'approve') {
        return c.text('Invalid action', 400);
      }

      const absmartlyEndpoint = transaction.absmartlyEndpoint;
      if (!absmartlyEndpoint) {
        return c.text('ABsmartly endpoint is required', 400);
      }
      await this.deleteConsentTransaction(c, transactionId);

      if (env.OAUTH_KV) {
        try {
          await env.OAUTH_KV.put(
            `oauth_endpoint:client:${authRequest.clientId}`,
            absmartlyEndpoint,
            { expirationTtl: OAUTH_STATE_TTL_SECONDS }
          );
        } catch (e) {
          console.error('Failed to store OAuth endpoint:', e);
          return c.text('Service temporarily unavailable, please try again', 503);
        }
      }

      await this.addApprovedClient(c, authRequest.clientId);
      return this.redirectToAbsmartlyOAuth(c, authRequest, absmartlyEndpoint);
    });

    this.get('/oauth/callback', async (c) => {
      const env = c.env as OAuthEnv;
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

      try {
        await env.OAUTH_KV.delete(`oauth:state:${state}`);
      } catch (e) {
        console.warn('Failed to delete OAuth state token (non-critical):', e);
      }

      let oauthReqInfo;
      try {
        oauthReqInfo = JSON.parse(storedState);
      } catch (e) {
        debug('Failed to parse stored state:', e);
        return c.text('Invalid state data', 400);
      }

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
          }
        });
      } catch (e) {
        debug('Failed to complete authorization:', e);
        return c.text('Authorization failed', 500);
      }

      return c.redirect(result.redirectTo);
    });
  }

  private async redirectToAbsmartlyOAuth(c: any, authRequest: any, absmartlyEndpoint: string) {
    const url = new URL(c.req.url);
    const env = c.env as OAuthEnv;

    debug(`ABsmartly endpoint for OAuth redirect: ${absmartlyEndpoint}`);

    const cleanEndpoint = absmartlyEndpoint.replace(/\/+$/, '');
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const stateToken = crypto.randomUUID();
    const stateData = {
      authRequest,
      absmartlyEndpoint: cleanEndpoint,
      codeVerifier,
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

    return c.redirect(absmartlyOAuthUrl.toString());
  }

  private getScopeDescription(scope: string): string {
    const descriptions: Record<string, string> = {
      'mcp:access': 'Access ABsmartly via the MCP server (read and modify experiments)',
      'user:info': 'Read your basic ABsmartly profile (name and email)'
    };
    return descriptions[scope] || scope;
  }

  private async getApprovedClients(c: any): Promise<string[]> {
    const cookie = getCookie(c, COOKIE_NAME);
    if (!cookie) return [];

    try {
      const decoded = JSON.parse(atob(cookie));
      return decoded.clients || [];
    } catch (e) {
      console.warn('Failed to parse approval cookie:', e);
      return [];
    }
  }

  private async addApprovedClient(c: any, clientId: string) {
    const approvedClients = await this.getApprovedClients(c);
    if (!approvedClients.includes(clientId)) {
      approvedClients.push(clientId);
    }

    const cookie = btoa(JSON.stringify({ clients: approvedClients }));

    setCookie(c, COOKIE_NAME, cookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: APPROVAL_COOKIE_MAX_AGE_SECONDS
    });
  }

  private async createConsentTransaction(c: any, authRequest: any, absmartlyEndpoint: string | null): Promise<string> {
    const transactionId = crypto.randomUUID();
    const browserBinding = crypto.randomUUID();
    await this.saveConsentTransaction(c, transactionId, { authRequest, absmartlyEndpoint, browserBinding });
    setCookie(c, CONSENT_COOKIE_NAME, browserBinding, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/authorize',
      maxAge: CONSENT_TTL_SECONDS
    });
    return transactionId;
  }

  private async saveConsentTransaction(c: any, transactionId: string, transaction: ConsentTransaction): Promise<void> {
    const env = c.env as OAuthEnv;
    await env.OAUTH_KV.put(
      `${CONSENT_KV_PREFIX}${transactionId}`,
      JSON.stringify(transaction),
      { expirationTtl: CONSENT_TTL_SECONDS }
    );
  }

  private async loadConsentTransaction(c: any, transactionId: string): Promise<ConsentTransaction | null> {
    if (!transactionId) return null;
    const env = c.env as OAuthEnv;
    const raw = await safeKvGet(env.OAUTH_KV, `${CONSENT_KV_PREFIX}${transactionId}`);
    if (!raw) return null;

    let transaction: ConsentTransaction;
    try {
      transaction = JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to parse consent transaction:', e);
      return null;
    }

    // The transaction must be completed by the same browser that received the consent page.
    const browserBinding = getCookie(c, CONSENT_COOKIE_NAME);
    if (!browserBinding || browserBinding !== transaction.browserBinding) {
      debug('Consent transaction browser binding mismatch');
      return null;
    }
    return transaction;
  }

  private async deleteConsentTransaction(c: any, transactionId: string): Promise<void> {
    const env = c.env as OAuthEnv;
    try {
      await env.OAUTH_KV.delete(`${CONSENT_KV_PREFIX}${transactionId}`);
    } catch (e) {
      console.warn('Failed to delete consent transaction (non-critical):', e);
    }
    deleteCookie(c, CONSENT_COOKIE_NAME, { path: '/authorize', secure: true });
  }

  private describeRedirectTarget(redirectUri: string): string {
    try {
      return new URL(redirectUri).host || redirectUri;
    } catch {
      return redirectUri;
    }
  }

  private renderEndpointForm(c: any, transactionId: string) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABsmartly MCP - Connect</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 8px; font-size: 24px; color: #1a1a1a; }
    p { color: #666; margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #333; font-size: 14px; }
    input[type="url"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; box-sizing: border-box; }
    input[type="url"]:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    button { width: 100%; padding: 12px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 16px; }
    button:hover { background: #4338ca; }
    .hint { font-size: 12px; color: #999; margin-top: 6px; }
    .error { color: #dc2626; font-size: 13px; margin-top: 6px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to ABsmartly</h1>
    <p>Enter your ABsmartly instance URL to continue the authorization flow.</p>
    <form method="POST" action="/authorize" id="endpoint-form">
      <input type="hidden" name="action" value="set_endpoint">
      <input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}">
      <label for="absmartly_endpoint">ABsmartly URL</label>
      <input type="url" id="absmartly_endpoint" name="absmartly_endpoint" placeholder="https://your-instance.absmartly.com" required>
      <div class="hint">Example: https://your-company.absmartly.com</div>
      <button type="submit">Continue</button>
    </form>
  </div>
  <script>
    var inp = document.getElementById('absmartly_endpoint');
    inp.addEventListener('input', function() {
      var v = this.value.trim();
      if (v && !v.startsWith('http://') && !v.startsWith('https://') && !v.startsWith('h')) {
        this.value = 'https://' + v;
      }
    });
    document.getElementById('endpoint-form').addEventListener('submit', function() {
      var v = inp.value.trim().replace(/\\/+$/, '');
      if (v && !v.startsWith('http://') && !v.startsWith('https://')) {
        v = 'https://' + v;
      }
      inp.value = v;
    });
  </script>
</body>
</html>`;
    return c.html(html);
  }

  private renderApprovalPage(c: any, clientInfo: any, authRequest: any, absmartlyEndpoint: string, transactionId: string) {
    const scopes = authRequest.scope || [];
    const redirectTarget = this.describeRedirectTarget(authRequest.redirectUri);
    const scopeListHtml = scopes.map((s: string) => `<li>${escapeHtml(this.getScopeDescription(s))}</li>`).join('');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABsmartly MCP - Authorize</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 8px; font-size: 24px; color: #1a1a1a; }
    p { color: #666; margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
    .client-name { font-weight: 600; color: #1a1a1a; }
    ul { padding-left: 20px; margin: 0 0 24px; }
    li { color: #444; margin-bottom: 8px; font-size: 14px; }
    .actions { display: flex; gap: 12px; }
    button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
    .approve { background: #4f46e5; color: white; }
    .approve:hover { background: #4338ca; }
    .cancel { background: #f3f4f6; color: #374151; }
    .cancel:hover { background: #e5e7eb; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; color: #78350f; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Access</h1>
    <p><span class="client-name">${escapeHtml(clientInfo.clientName || authRequest.clientId)}</span> is requesting access to your ABsmartly account.</p>
    <p class="warning">After you approve, access to your account at <strong>${escapeHtml(absmartlyEndpoint)}</strong> will be sent to <strong>${escapeHtml(redirectTarget)}</strong>. Only continue if you started this connection yourself and you trust that site.</p>
    <p>This application will be able to:</p>
    <ul>${scopeListHtml}</ul>
    <div class="actions">
      <form method="POST" action="/authorize" style="flex:1;display:flex;">
        <input type="hidden" name="action" value="cancel">
        <input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}">
        <button type="submit" class="cancel" style="width:100%;">Deny</button>
      </form>
      <form method="POST" action="/authorize" style="flex:1;display:flex;">
        <input type="hidden" name="action" value="approve">
        <input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}">
        <button type="submit" class="approve" style="width:100%;">Approve</button>
      </form>
    </div>
  </div>
</body>
</html>`;
    return c.html(html);
  }

}