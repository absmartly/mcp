import {
  ALLOWED_REDIRECT_CUSTOM_SCHEMES,
  ALLOWED_REDIRECT_HTTPS_CALLBACK_PATTERNS,
  ALLOWED_REDIRECT_HTTPS_CALLBACKS,
  ALLOWED_REDIRECT_LOOPBACK_HOSTS,
  SHARED_CALLBACK_HOST_PATTERNS,
  SHARED_CALLBACK_HOSTS,
} from "./constants.js";

const HTTPS_PROTOCOL = "https:";
const HTTP_PROTOCOL = "http:";
const PREFIX_ENTRY_SUFFIX = "/";

// Accepts the hosted callbacks in ALLOWED_REDIRECT_HTTPS_CALLBACKS (or matching
// ALLOWED_REDIRECT_HTTPS_CALLBACK_PATTERNS), http only on loopback (any port, RFC 8252),
// and native app schemes. Rejects fragments and embedded credentials.
export function isAllowedRedirectUri(redirectUri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  if (parsed.hash || parsed.username || parsed.password) return false;
  if (parsed.protocol === HTTPS_PROTOCOL) {
    const callback = `${parsed.origin}${parsed.pathname}`;
    return ALLOWED_REDIRECT_HTTPS_CALLBACKS.some((allowed) =>
      allowed.endsWith(PREFIX_ENTRY_SUFFIX)
        ? callback.startsWith(allowed) && callback.length > allowed.length
        : callback === allowed
    ) || ALLOWED_REDIRECT_HTTPS_CALLBACK_PATTERNS.some((pattern) => pattern.test(callback));
  }
  if (parsed.protocol === HTTP_PROTOCOL) return ALLOWED_REDIRECT_LOOPBACK_HOSTS.includes(parsed.hostname);
  return ALLOWED_REDIRECT_CUSTOM_SCHEMES.includes(parsed.protocol);
}

export function isLoopbackRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    return parsed.protocol === HTTP_PROTOCOL && ALLOWED_REDIRECT_LOOPBACK_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// An allowed https callback on a multi-tenant agent platform (see SHARED_CALLBACK_HOSTS).
export function isSharedCallbackRedirectUri(redirectUri: string): boolean {
  if (!isAllowedRedirectUri(redirectUri)) return false;
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== HTTPS_PROTOCOL) return false;
  return SHARED_CALLBACK_HOSTS.includes(parsed.hostname) ||
    SHARED_CALLBACK_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
}

// RFC 8252 §7.3: a loopback redirect matches a registered loopback URI regardless of
// port. Everything else must match exactly.
export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  if (!isLoopbackRedirectUri(requested) || !isLoopbackRedirectUri(registered)) return false;
  const a = new URL(requested);
  const b = new URL(registered);
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

export function isRegisteredRedirectUri(requested: string, registered: readonly string[] | undefined): boolean {
  return !!registered?.some((uri) => redirectUriMatches(requested, uri));
}

export function describeRedirectTarget(redirectUri: string): string {
  try {
    return new URL(redirectUri).host || redirectUri;
  } catch {
    return redirectUri;
  }
}
