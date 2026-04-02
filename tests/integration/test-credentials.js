/**
 * Shared credential resolver for integration tests.
 *
 * Resolution order:
 *   1. Environment variables (ABSMARTLY_API_KEY, ABSMARTLY_API_ENDPOINT)
 *      which includes anything already loaded via dotenv
 *   2. `--profile <name>` CLI argument → reads from ~/.config/absmartly/
 *
 * Returns { apiKey, endpoint } or null (caller should skip the test).
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const ABSMARTLY_CONFIG_DIR = join(homedir(), '.config', 'absmartly');
const CREDENTIALS_FILE = join(ABSMARTLY_CONFIG_DIR, 'credentials.json');
const CONFIG_YAML_FILE = join(ABSMARTLY_CONFIG_DIR, 'config.yaml');

/**
 * Load all .env.*.local files from the project root.
 * Priority (highest first): .env.local, .env.{NODE_ENV}.local, .env
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
 * Read the ABsmartly CLI credentials file.
 * Returns the parsed JSON or an empty object.
 */
function readCredentials() {
  if (!existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Minimal parser for the profile endpoint from config.yaml.
 * Handles the known two-space-indent structure:
 *
 *   profiles:
 *     <profileName>:
 *       api:
 *         endpoint: https://...
 */
function parseProfileEndpoint(yamlText, profileName) {
  const lines = yamlText.split('\n');
  let state = 'root';
  const PROFILES_RE = /^profiles:\s*$/;
  const PROFILE_RE = new RegExp(`^  ${escapeRegex(profileName)}:\\s*$`);
  const API_RE = /^    api:\s*$/;
  const ENDPOINT_RE = /^      endpoint:\s*(\S+)/;

  for (const line of lines) {
    switch (state) {
      case 'root':
        if (PROFILES_RE.test(line)) state = 'profiles';
        break;
      case 'profiles':
        if (PROFILE_RE.test(line)) { state = 'profile'; break; }
        // Reset if we exit profiles block (top-level key without leading spaces)
        if (/^\S/.test(line) && !PROFILES_RE.test(line)) state = 'root';
        break;
      case 'profile':
        if (API_RE.test(line)) { state = 'api'; break; }
        // Exit if we reach another profile (same indent level)
        if (/^  \S/.test(line)) state = 'profiles';
        break;
      case 'api': {
        const m = ENDPOINT_RE.exec(line);
        if (m) return m[1];
        // Exit if we reach another section (same or lower indent)
        if (/^    \S/.test(line)) state = 'profile';
        break;
      }
    }
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve credentials from the ABsmartly CLI config for a given profile.
 * Key name convention: "api-key" for default, "api-key-{profile}" for others.
 */
function resolveFromCliConfig(profileName) {
  if (!existsSync(CONFIG_YAML_FILE)) return null;

  const yaml = readFileSync(CONFIG_YAML_FILE, 'utf8');
  const endpoint = parseProfileEndpoint(yaml, profileName);
  if (!endpoint) return null;

  const creds = readCredentials();
  const keyName = profileName === 'default' ? 'api-key' : `api-key-${profileName}`;
  const apiKey = creds[keyName] ?? null;
  if (!apiKey) return null;

  return { apiKey, endpoint };
}

/**
 * Resolve credentials for integration tests.
 *
 * @returns {{ apiKey: string, endpoint: string } | null}
 *   null means credentials were not found — the calling test should skip.
 */
export function resolveTestCredentials() {
  loadEnvFiles();

  const envKey = process.env.ABSMARTLY_API_KEY;
  const envEndpoint = process.env.ABSMARTLY_API_ENDPOINT;
  if (envKey && envEndpoint) {
    return { apiKey: envKey, endpoint: envEndpoint };
  }

  // Try --profile <name> from process.argv
  const profileIdx = process.argv.indexOf('--profile');
  if (profileIdx !== -1) {
    const profileName = process.argv[profileIdx + 1];
    if (profileName && !profileName.startsWith('-')) {
      const creds = resolveFromCliConfig(profileName);
      if (creds) return creds;
    }
  }

  return null;
}

export const SKIP_MESSAGE = 'Skipped: no credentials found (set ABSMARTLY_API_KEY/ABSMARTLY_API_ENDPOINT or use --profile <name>)';
