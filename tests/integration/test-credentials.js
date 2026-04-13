/**
 * Shared credential resolver for integration tests.
 *
 * Resolution order:
 *   1. `--profile <name>` CLI argument -> reads from ~/.config/absmartly/
 *      via the @absmartly/cli config and keyring modules (explicit profile always wins)
 *   2. Environment variables (ABSMARTLY_API_KEY, ABSMARTLY_API_ENDPOINT)
 *      which includes anything loaded via dotenv from .env.local
 *
 * Returns { apiKey, endpoint } or null (caller should skip the test).
 */

import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
// These modules are not exported via package.json "exports", so we import by
// relative path. This is intentional — the CLI's own config/keyring logic
// handles credentials.json, OS keychain, and profile resolution.
import { getProfile } from '../../node_modules/@absmartly/cli/dist/lib/config/config.js';
import { getAPIKey } from '../../node_modules/@absmartly/cli/dist/lib/config/keyring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

/**
 * Load .env files from the project root.
 * Priority (highest first): .env.{NODE_ENV}.local, .env.local, .env
 */
function loadEnvFiles() {
  const candidates = [];
  if (process.env.NODE_ENV) {
    candidates.push(join(PROJECT_ROOT, `.env.${process.env.NODE_ENV}.local`));
  }
  candidates.push(join(PROJECT_ROOT, '.env.local'));
  candidates.push(join(PROJECT_ROOT, '.env'));

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path, override: false });
    }
  }
}

/**
 * Resolve credentials from the ABsmartly CLI config for a given profile.
 * Uses the CLI's own config and keyring modules to handle both
 * credentials.json and OS keychain lookups.
 */
async function resolveFromCliConfig(profileName) {
  try {
    const profile = getProfile(profileName);
    const endpoint = profile?.api?.endpoint;
    if (!endpoint) return null;

    const apiKey = await getAPIKey(profileName);
    if (!apiKey) return null;

    return { apiKey, endpoint };
  } catch {
    return null;
  }
}

/**
 * Resolve credentials for integration tests.
 *
 * @returns {Promise<{ apiKey: string, endpoint: string } | null>}
 *   null means credentials were not found -- the calling test should skip.
 */
export async function resolveTestCredentials() {
  // --profile takes precedence when explicitly specified
  const profileIdx = process.argv.indexOf('--profile');
  if (profileIdx !== -1) {
    const profileName = process.argv[profileIdx + 1];
    if (profileName && !profileName.startsWith('-')) {
      const creds = await resolveFromCliConfig(profileName);
      if (creds) return creds;
    }
  }

  // Fall back to env vars (includes .env.local via dotenv)
  loadEnvFiles();

  const envKey = process.env.ABSMARTLY_API_KEY;
  const envEndpoint = process.env.ABSMARTLY_API_ENDPOINT;
  if (envKey && envEndpoint) {
    return { apiKey: envKey, endpoint: envEndpoint };
  }

  return null;
}

export const SKIP_MESSAGE = 'Skipped: no credentials found (set ABSMARTLY_API_KEY/ABSMARTLY_API_ENDPOINT or use --profile <name>)';
