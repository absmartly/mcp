import { HOST_COOKIE_PREFIX } from "./constants.js";

const CONTENT_TYPE_HTML = "text/html; charset=UTF-8";
const CONTENT_TYPE_TEXT = "text/plain; charset=UTF-8";
const HTTP_STATUS_FOUND = 302;
const COOKIE_PATH = "/";
const COOKIE_SAME_SITE = "Lax";

export const FRAME_PROTECTION_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

// Platform-neutral HTTP response. Hosts turn it into a Fetch Response (worker) or an
// Express response (backend).
export type OAuthHttpResult = {
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body?: string;
};

export type CookieOptions = {
  // __Host- cookies require HTTPS. Set to false only for local http development, which
  // drops the prefix and the Secure attribute.
  secure?: boolean;
};

export function hostCookieName(name: string, options: CookieOptions = {}): string {
  return options.secure === false ? name : `${HOST_COOKIE_PREFIX}${name}`;
}

// Always Path=/ and no Domain, as the __Host- prefix requires.
export function serializeHostCookie(name: string, value: string, maxAgeSeconds: number, options: CookieOptions = {}): string {
  const parts = [
    `${hostCookieName(name, options)}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
  ];
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${COOKIE_SAME_SITE}`);
  return parts.join("; ");
}

export function clearHostCookie(name: string, options: CookieOptions = {}): string {
  return serializeHostCookie(name, "", 0, options);
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

export function readHostCookie(cookieHeader: string | null | undefined, name: string, options: CookieOptions = {}): string | undefined {
  return parseCookies(cookieHeader)[hostCookieName(name, options)];
}

export function htmlResult(body: string, setCookies: string[] = []): OAuthHttpResult {
  return { status: 200, headers: { "Content-Type": CONTENT_TYPE_HTML, ...FRAME_PROTECTION_HEADERS }, setCookies, body };
}

export function textResult(status: number, body: string, setCookies: string[] = []): OAuthHttpResult {
  return { status, headers: { "Content-Type": CONTENT_TYPE_TEXT }, setCookies, body };
}

export function redirectResult(location: string, setCookies: string[] = []): OAuthHttpResult {
  return { status: HTTP_STATUS_FOUND, headers: { Location: location }, setCookies };
}

export function toFetchResponse(result: OAuthHttpResult): Response {
  const headers = new Headers(result.headers);
  for (const cookie of result.setCookies) headers.append("Set-Cookie", cookie);
  return new Response(result.body ?? null, { status: result.status, headers });
}
