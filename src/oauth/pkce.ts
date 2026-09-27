import { REQUIRED_CODE_CHALLENGE_METHOD } from "./constants.js";
import { base64UrlEncode, sha256Base64Url, timingSafeEqualStrings } from "./crypto.js";

const PKCE_VERIFIER_BYTES = 32;
// RFC 7636 §4.1: 43-128 characters from the unreserved set.
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export async function generatePkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(PKCE_VERIFIER_BYTES)));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

export function hasRequiredPkce(codeChallenge: string | null | undefined, codeChallengeMethod: string | null | undefined): boolean {
  return !!codeChallenge && codeChallengeMethod === REQUIRED_CODE_CHALLENGE_METHOD;
}

export async function verifyPkceS256(codeVerifier: string | null | undefined, codeChallenge: string): Promise<boolean> {
  if (!codeVerifier || !PKCE_VERIFIER_PATTERN.test(codeVerifier)) return false;
  return timingSafeEqualStrings(await sha256Base64Url(codeVerifier), codeChallenge);
}
