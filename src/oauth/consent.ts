import {
  APPROVAL_MAX_AGE_SECONDS,
  APPROVALS_COOKIE_NAME,
  CONSENT_COOKIE_NAME,
  CONSENT_STATE_KEY_PREFIX,
  CONSENT_TTL_SECONDS,
  MESSAGE_CLIENT_NOT_FOUND,
  MESSAGE_ENDPOINT_REQUIRED,
  MESSAGE_INVALID_ACTION,
  MESSAGE_INVALID_REDIRECT_URI,
  MESSAGE_PKCE_REQUIRED,
  MESSAGE_SERVICE_UNAVAILABLE,
  MESSAGE_TRANSACTION_INVALID,
  OAUTH_ERROR_ACCESS_DENIED,
} from "./constants.js";
import {
  clearHostCookie,
  htmlResult,
  readHostCookie,
  redirectResult,
  serializeHostCookie,
  textResult,
  type CookieOptions,
  type OAuthHttpResult,
} from "./http.js";
import { renderConsentPage, renderEndpointForm } from "./pages.js";
import { hasRequiredPkce } from "./pkce.js";
import { describeRedirectTarget, isAllowedRedirectUri, isLoopbackRedirectUri, isRegisteredRedirectUri } from "./redirect-policy.js";

const APPROVALS_STATE_KEY_PREFIX = "oauth:approvals:";
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const ACTION_APPROVE = "approve";
const ACTION_CANCEL = "cancel";
const ACTION_SET_ENDPOINT = "set_endpoint";
const HTTP_SCHEME = "http://";
const HTTPS_SCHEME = "https://";

export type AuthorizationRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string;
};

export type OAuthClientInfo = {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
};

// Short-lived key/value storage for consent transactions and remembered approvals.
// The worker backs it with KV; the backend with its database.
export interface OAuthStateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ConsentOptions = CookieOptions & {
  store: OAuthStateStore;
  // Path the consent and endpoint forms post to.
  formAction: string;
  lookupClient: (clientId: string) => Promise<OAuthClientInfo | null>;
  // The worker serves many ABsmartly instances and must know which one before consent.
  requireEndpoint?: boolean;
  // Remember approvals per browser so a returning client skips the consent page.
  rememberApprovals?: boolean;
};

export type ConsentOutcome<Req extends AuthorizationRequest = AuthorizationRequest> =
  | { type: "respond"; response: OAuthHttpResult }
  | { type: "approved"; authRequest: Req; client: OAuthClientInfo; endpoint: string | null; setCookies: string[] };

type ConsentTransaction<Req> = {
  authRequest: Req;
  absmartlyEndpoint: string | null;
  browserBinding: string;
};

export type ConsentForm = {
  action?: string | null;
  transactionId?: string | null;
  endpoint?: string | null;
};

// One cookie per transaction, so several consent pages open in the same browser don't
// overwrite each other's binding.
function consentCookieName(transactionId: string): string {
  return `${CONSENT_COOKIE_NAME}-${transactionId}`;
}

function respond<Req extends AuthorizationRequest>(response: OAuthHttpResult): ConsentOutcome<Req> {
  return { type: "respond", response };
}

export function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim().replace(/\/+$/, "");
  if (endpoint && !endpoint.startsWith(HTTP_SCHEME) && !endpoint.startsWith(HTTPS_SCHEME)) {
    endpoint = HTTPS_SCHEME + endpoint;
  }
  return endpoint;
}

// Checks an authorization request against its client. The provider libraries only check
// redirect_uri when one is supplied, and codes must never reach a redirect outside the
// allowlist, even for clients registered before the allowlist existed.
export function validateAuthorizationRequest(authRequest: AuthorizationRequest, client: OAuthClientInfo | null): OAuthHttpResult | null {
  if (!client) return textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_CLIENT_NOT_FOUND);
  if (!authRequest.redirectUri || !isRegisteredRedirectUri(authRequest.redirectUri, client.redirectUris) ||
      !isAllowedRedirectUri(authRequest.redirectUri)) {
    return textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_INVALID_REDIRECT_URI);
  }
  if (!hasRequiredPkce(authRequest.codeChallenge, authRequest.codeChallengeMethod)) {
    return textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_PKCE_REQUIRED);
  }
  return null;
}

// Remembered approvals are keyed by client_id AND ABsmartly endpoint, so approving a
// client for one ABsmartly instance does not skip consent for another.
function approvalKey(clientId: string, endpoint: string): string {
  return JSON.stringify([clientId, endpoint.replace(/\/+$/, "")]);
}

async function getApprovals(cookieHeader: string | null | undefined, options: ConsentOptions): Promise<string[]> {
  const sessionId = readHostCookie(cookieHeader, APPROVALS_COOKIE_NAME, options);
  if (!sessionId) return [];
  try {
    const raw = await options.store.get(`${APPROVALS_STATE_KEY_PREFIX}${sessionId}`);
    const approvals = raw ? JSON.parse(raw) : [];
    return Array.isArray(approvals) ? approvals : [];
  } catch (e) {
    console.warn("Failed to read stored approvals:", e);
    return [];
  }
}

// Approvals live server-side; the cookie only carries a random session id, so a client
// cannot forge an approval to skip the consent page.
async function rememberApproval(cookieHeader: string | null | undefined, approval: string, options: ConsentOptions): Promise<string[]> {
  const sessionId = readHostCookie(cookieHeader, APPROVALS_COOKIE_NAME, options) || crypto.randomUUID();
  const approved = await getApprovals(cookieHeader, options);
  if (!approved.includes(approval)) approved.push(approval);
  try {
    await options.store.put(`${APPROVALS_STATE_KEY_PREFIX}${sessionId}`, JSON.stringify(approved), APPROVAL_MAX_AGE_SECONDS);
  } catch (e) {
    // Not remembering the approval only means the user sees the consent page again.
    console.warn("Failed to store client approval:", e);
    return [];
  }
  return [serializeHostCookie(APPROVALS_COOKIE_NAME, sessionId, APPROVAL_MAX_AGE_SECONDS, options)];
}

async function loadTransaction<Req>(transactionId: string, cookieHeader: string | null | undefined, options: ConsentOptions): Promise<ConsentTransaction<Req> | null> {
  if (!transactionId) return null;
  let raw: string | null;
  try {
    raw = await options.store.get(`${CONSENT_STATE_KEY_PREFIX}${transactionId}`);
  } catch (e) {
    console.warn("Failed to read consent transaction:", e);
    return null;
  }
  if (!raw) return null;
  let transaction: ConsentTransaction<Req>;
  try {
    transaction = JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to parse consent transaction:", e);
    return null;
  }
  // The transaction must be completed by the same browser that received the consent page.
  const browserBinding = readHostCookie(cookieHeader, consentCookieName(transactionId), options);
  if (!browserBinding || browserBinding !== transaction.browserBinding) return null;
  return transaction;
}

async function discardTransaction(transactionId: string, options: ConsentOptions): Promise<string[]> {
  try {
    await options.store.delete(`${CONSENT_STATE_KEY_PREFIX}${transactionId}`);
  } catch (e) {
    console.warn("Failed to delete consent transaction (non-critical):", e);
  }
  return [clearHostCookie(consentCookieName(transactionId), options)];
}

function consentPage<Req extends AuthorizationRequest>(client: OAuthClientInfo, authRequest: Req, endpoint: string | null, transactionId: string, options: ConsentOptions, setCookies: string[] = []): OAuthHttpResult {
  return htmlResult(renderConsentPage({
    formAction: options.formAction,
    transactionId,
    clientName: client.clientName || authRequest.clientId,
    scopes: authRequest.scope || [],
    redirectTarget: describeRedirectTarget(authRequest.redirectUri),
    accountLabel: endpoint || undefined,
    loopbackRedirect: isLoopbackRedirectUri(authRequest.redirectUri),
  }), setCookies);
}

// GET /authorize: validates the request, then either reports a remembered approval or
// starts a consent transaction bound to this browser and returns the page to show.
export async function beginAuthorization<Req extends AuthorizationRequest>(
  params: { authRequest: Req; endpoint: string | null; cookieHeader: string | null | undefined },
  options: ConsentOptions,
): Promise<ConsentOutcome<Req>> {
  const { authRequest, endpoint, cookieHeader } = params;
  const client = await options.lookupClient(authRequest.clientId);
  const invalid = validateAuthorizationRequest(authRequest, client);
  if (invalid || !client) return respond(invalid ?? textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_CLIENT_NOT_FOUND));

  const endpointReady = !options.requireEndpoint || !!endpoint;
  // Only check approvals when an endpoint is present: an approval is keyed by endpoint,
  // so without one there is nothing meaningful to match against.
  if (endpointReady && options.rememberApprovals && endpoint) {
    const approvals = await getApprovals(cookieHeader, options);
    if (approvals.includes(approvalKey(authRequest.clientId, endpoint))) {
      return { type: "approved", authRequest, client, endpoint, setCookies: [] };
    }
  }

  const transactionId = crypto.randomUUID();
  const browserBinding = crypto.randomUUID();
  const transaction: ConsentTransaction<Req> = { authRequest, absmartlyEndpoint: endpoint, browserBinding };
  try {
    await options.store.put(`${CONSENT_STATE_KEY_PREFIX}${transactionId}`, JSON.stringify(transaction), CONSENT_TTL_SECONDS);
  } catch (e) {
    console.error("Failed to store consent transaction:", e);
    return respond(textResult(HTTP_STATUS_SERVICE_UNAVAILABLE, MESSAGE_SERVICE_UNAVAILABLE));
  }
  const bindingCookie = serializeHostCookie(consentCookieName(transactionId), browserBinding, CONSENT_TTL_SECONDS, options);

  if (!endpointReady) {
    return respond(htmlResult(renderEndpointForm(options.formAction, transactionId), [bindingCookie]));
  }
  return respond(consentPage(client, authRequest, endpoint, transactionId, options, [bindingCookie]));
}

// POST /authorize: every authorization parameter comes from the stored transaction,
// never from the form, so a forged POST cannot choose its own client or redirect URI.
export async function submitConsent<Req extends AuthorizationRequest>(
  params: { form: ConsentForm; cookieHeader: string | null | undefined },
  options: ConsentOptions,
): Promise<ConsentOutcome<Req>> {
  const { form, cookieHeader } = params;
  const transactionId = form.transactionId || "";
  const transaction = await loadTransaction<Req>(transactionId, cookieHeader, options);
  if (!transaction) return respond(textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_TRANSACTION_INVALID));
  const { authRequest } = transaction;

  const client = await options.lookupClient(authRequest.clientId);
  if (!client || !isRegisteredRedirectUri(authRequest.redirectUri, client.redirectUris) ||
      !isAllowedRedirectUri(authRequest.redirectUri)) {
    const cleared = await discardTransaction(transactionId, options);
    return respond(textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_INVALID_REDIRECT_URI, cleared));
  }

  if (form.action === ACTION_CANCEL) {
    const cleared = await discardTransaction(transactionId, options);
    const denyUrl = new URL(authRequest.redirectUri);
    denyUrl.searchParams.set("error", OAUTH_ERROR_ACCESS_DENIED);
    if (authRequest.state) denyUrl.searchParams.set("state", authRequest.state);
    return respond(redirectResult(denyUrl.toString(), cleared));
  }

  if (form.action === ACTION_SET_ENDPOINT) {
    const endpoint = normalizeEndpoint(form.endpoint || "");
    if (!endpoint) return respond(textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_ENDPOINT_REQUIRED));
    transaction.absmartlyEndpoint = endpoint;
    try {
      await options.store.put(`${CONSENT_STATE_KEY_PREFIX}${transactionId}`, JSON.stringify(transaction), CONSENT_TTL_SECONDS);
    } catch (e) {
      console.error("Failed to update consent transaction:", e);
      return respond(textResult(HTTP_STATUS_SERVICE_UNAVAILABLE, MESSAGE_SERVICE_UNAVAILABLE));
    }
    return respond(consentPage(client, authRequest, endpoint, transactionId, options));
  }

  if (form.action !== ACTION_APPROVE) return respond(textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_INVALID_ACTION));

  const endpoint = transaction.absmartlyEndpoint;
  if (options.requireEndpoint && !endpoint) return respond(textResult(HTTP_STATUS_BAD_REQUEST, MESSAGE_ENDPOINT_REQUIRED));

  const setCookies = await discardTransaction(transactionId, options);
  if (options.rememberApprovals && endpoint) setCookies.push(...await rememberApproval(cookieHeader, approvalKey(authRequest.clientId, endpoint), options));
  return { type: "approved", authRequest, client, endpoint, setCookies };
}
