import {
  CIMD_CACHE_TTL_MS,
  CIMD_FETCH_TIMEOUT_MS,
  CIMD_MAX_DOCUMENT_BYTES,
  TOKEN_ENDPOINT_AUTH_NONE,
  TRUSTED_CIMD_CLIENT_IDS,
} from "./constants.js";
import { isAllowedRedirectUri } from "./redirect-policy.js";

const HTTPS_PROTOCOL = "https:";
const ROOT_PATH = "/";
const ACCEPT_JSON = "application/json";

export type CimdClient = {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: typeof TOKEN_ENDPOINT_AUTH_NONE;
};

export type CimdCache = {
  get(clientId: string): CimdClient | undefined;
  set(clientId: string, client: CimdClient): void;
};

export type ResolveCimdOptions = {
  fetch?: typeof fetch;
  cache?: CimdCache;
  trustedClientIds?: readonly string[];
  timeoutMs?: number;
};

export class CimdError extends Error {}

// Per the MCP spec, a CIMD client_id is an https URL with a non-root path.
export function isCimdClientId(clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  try {
    const url = new URL(clientId);
    return url.protocol === HTTPS_PROTOCOL && url.pathname !== ROOT_PATH && !url.hash;
  } catch {
    return false;
  }
}

export function isTrustedCimdClientId(clientId: string, trustedClientIds: readonly string[] = TRUSTED_CIMD_CLIENT_IDS): boolean {
  return trustedClientIds.includes(clientId);
}

export function createMemoryCimdCache(ttlMs: number = CIMD_CACHE_TTL_MS): CimdCache {
  const entries = new Map<string, { client: CimdClient; expiresAt: number }>();
  return {
    get(clientId) {
      const entry = entries.get(clientId);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(clientId);
        return undefined;
      }
      return entry.client;
    },
    set(clientId, client) {
      entries.set(clientId, { client, expiresAt: Date.now() + ttlMs });
    },
  };
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new CimdError("Client metadata document is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Not awaited: cancelling one branch of a cloned body only settles once the other
      // branch is cancelled too, so awaiting it would hang.
      reader.cancel().catch(() => {});
      throw new CimdError("Client metadata document is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function parseCimdDocument(clientId: string, document: unknown): CimdClient {
  const doc = (document && typeof document === "object" ? document : {}) as Record<string, unknown>;
  if (doc.client_id !== clientId) throw new CimdError("client_id in the metadata document does not match its URL");
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.some((uri) => typeof uri !== "string")) {
    throw new CimdError("Metadata document has no valid redirect_uris");
  }
  const redirectUris = (doc.redirect_uris as string[]).filter(isAllowedRedirectUri);
  if (redirectUris.length === 0) throw new CimdError("Metadata document has no allowed redirect_uris");
  // Only public CIMD clients are supported; private_key_jwt is not implemented.
  const authMethod = doc.token_endpoint_auth_method ?? TOKEN_ENDPOINT_AUTH_NONE;
  if (authMethod !== TOKEN_ENDPOINT_AUTH_NONE) throw new CimdError("Only public CIMD clients are supported");
  return {
    clientId,
    clientName: typeof doc.client_name === "string" ? doc.client_name : undefined,
    redirectUris,
    tokenEndpointAuthMethod: TOKEN_ENDPOINT_AUTH_NONE,
  };
}

// Fetches and validates a Client ID Metadata Document. Only client IDs on the trusted
// list are ever fetched; anything else fails without a network request.
export async function resolveCimdClient(clientId: string, options: ResolveCimdOptions = {}): Promise<CimdClient> {
  if (!isCimdClientId(clientId) || !isTrustedCimdClientId(clientId, options.trustedClientIds)) {
    throw new CimdError("Client ID metadata document is not trusted");
  }
  const cached = options.cache?.get(clientId);
  if (cached) return cached;

  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(clientId, {
      headers: { Accept: ACCEPT_JSON },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? CIMD_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new CimdError(`Failed to fetch client metadata document: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!response.ok) throw new CimdError(`Client metadata document returned HTTP ${response.status}`);

  let document: unknown;
  try {
    document = JSON.parse(await readLimitedText(response, CIMD_MAX_DOCUMENT_BYTES));
  } catch (e) {
    if (e instanceof CimdError) throw e;
    throw new CimdError("Client metadata document is not valid JSON");
  }
  const client = parseCimdDocument(clientId, document);
  options.cache?.set(clientId, client);
  return client;
}
