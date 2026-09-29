import {
  CLIENT_ID_LENGTH,
  CLIENT_SECRET_LENGTH,
  MAX_LOGGED_REDIRECT_URI_LENGTH,
  MAX_REGISTRATION_BODY_BYTES,
  MESSAGE_REDIRECT_URI_NOT_ALLOWED,
  MESSAGE_REGISTRATION_TOO_LARGE,
  OAUTH_ERROR_INVALID_CLIENT_METADATA,
  OAUTH_ERROR_INVALID_REDIRECT_URI,
  OAUTH_ERROR_INVALID_REQUEST,
  SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
  TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_BASIC,
  TOKEN_ENDPOINT_AUTH_NONE,
} from "./constants.js";
import { isAllowedRedirectUri } from "./redirect-policy.js";
import { randomString, sha256Hex } from "./crypto.js";

const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;
const MESSAGE_REDIRECT_URIS_REQUIRED = "At least one redirect URI is required";
const MESSAGE_INVALID_JSON = "Invalid JSON payload";
const MESSAGE_UNSUPPORTED_AUTH_METHOD = "Unsupported token_endpoint_auth_method";

export type RegistrationError = {
  status: number;
  error: string;
  description: string;
};

export type ValidatedRegistration = {
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod: string;
};

export type RegistrationResult =
  | { ok: true; registration: ValidatedRegistration }
  | { ok: false; error: RegistrationError };

export type ClientCredentials = {
  clientId: string;
  // Only confidential clients get a secret. Return it once to the client and store the hash.
  clientSecret?: string;
  clientSecretHash?: string;
};

function registrationError(status: number, error: string, description: string): RegistrationResult {
  return { ok: false, error: { status, error, description } };
}

// Reads a request body while counting UTF-8 bytes, so an oversized or chunked body is
// rejected before it is buffered in full or parsed.
export async function readRegistrationBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; error: RegistrationError }> {
  const tooLarge = { status: HTTP_STATUS_PAYLOAD_TOO_LARGE, error: OAUTH_ERROR_INVALID_REQUEST, description: MESSAGE_REGISTRATION_TOO_LARGE };
  if (Number(request.headers.get("Content-Length") || 0) > MAX_REGISTRATION_BODY_BYTES) return { ok: false, error: tooLarge };
  if (!request.body) return { ok: false, error: { status: HTTP_STATUS_BAD_REQUEST, error: OAUTH_ERROR_INVALID_REQUEST, description: MESSAGE_INVALID_JSON } };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REGISTRATION_BODY_BYTES) {
      // Not awaited: cancelling one branch of a cloned body only settles once the other
      // branch is cancelled too, so awaiting it would hang.
      reader.cancel().catch(() => {});
      return { ok: false, error: tooLarge };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, error: { status: HTTP_STATUS_BAD_REQUEST, error: OAUTH_ERROR_INVALID_REQUEST, description: MESSAGE_INVALID_JSON } };
  }
}

// Validates RFC 7591 client metadata against this server's policy. Every redirect URI
// must pass isAllowedRedirectUri, so a registration can never point codes at a site an
// attacker controls.
export function validateClientRegistration(metadata: unknown): RegistrationResult {
  const body = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return registrationError(HTTP_STATUS_BAD_REQUEST, OAUTH_ERROR_INVALID_REDIRECT_URI, MESSAGE_REDIRECT_URIS_REQUIRED);
  }
  const disallowed = redirectUris.find((uri) => typeof uri !== "string" || !isAllowedRedirectUri(uri));
  if (disallowed !== undefined) {
    console.warn("Rejected client registration redirect URI:", String(disallowed).slice(0, MAX_LOGGED_REDIRECT_URI_LENGTH));
    return registrationError(HTTP_STATUS_BAD_REQUEST, OAUTH_ERROR_INVALID_REDIRECT_URI, MESSAGE_REDIRECT_URI_NOT_ALLOWED);
  }

  const authMethod = body.token_endpoint_auth_method ?? TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_BASIC;
  if (typeof authMethod !== "string" || !SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.includes(authMethod)) {
    return registrationError(HTTP_STATUS_BAD_REQUEST, OAUTH_ERROR_INVALID_CLIENT_METADATA, MESSAGE_UNSUPPORTED_AUTH_METHOD);
  }
  const clientName = typeof body.client_name === "string" ? body.client_name : undefined;

  return {
    ok: true,
    registration: { redirectUris: redirectUris as string[], clientName, tokenEndpointAuthMethod: authMethod },
  };
}

export async function createClientCredentials(tokenEndpointAuthMethod: string): Promise<ClientCredentials> {
  const clientId = randomString(CLIENT_ID_LENGTH);
  if (tokenEndpointAuthMethod === TOKEN_ENDPOINT_AUTH_NONE) return { clientId };
  const clientSecret = randomString(CLIENT_SECRET_LENGTH);
  return { clientId, clientSecret, clientSecretHash: await sha256Hex(clientSecret) };
}
