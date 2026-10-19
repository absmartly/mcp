import type { ApiClientLike } from "./api-client-like.js";
import { API_PATH_METHODS, PATH_TABLE_CLI_VERSION } from "./api-path-args.js";
import { decodeOrNull, DOT_SEGMENT } from "./oauth/endpoint.js";
import { CLI_CORE_VERSION } from "./version.js";

const DIGITS = /^[0-9]+$/;
// Characters that let a string argument change a request path. Refused in
// every argument of an unknown method, and in a mapped non-ID path argument.
const PATH_CHARS = /[/\\.%?#]/;
// Path arguments in the table that are words, not entity IDs.
const NON_ID_PATH_PARAMS: Record<string, readonly string[]> = { uploadFile: ["usage"] };
// The APIClient methods whose path is itself an argument (by position).
const RAW_PATH_ARG: Record<string, number> = { request: 1, rawRequest: 0 };
// In a raw path: backslash, fragment, controls/space, and encoded
// dot, slash, backslash or percent (which could decode into one later).
const RAW_PATH_FORBIDDEN = /[\\#\x00-\x20\x7f]|%(?:2e|2f|5c|25)/i;
const ROOT_AUTH_PATH = "/auth/current-user";

/** Thrown when an argument that would become part of a request path is unsafe. */
export class PathIdError extends Error {
  constructor(readonly method: string, readonly argIndex: number, readonly value: unknown, rule = "a path ID must be a positive integer") {
    super(`Invalid ${rule.startsWith("a path ID") ? "ID" : "path argument"} ${JSON.stringify(value)} for ${method}: ${rule}.`);
    this.name = "PathIdError";
  }
}

const RULE_FAIL_CLOSED = "an argument of a method with no known path mapping must be a string without / \\ . % ? #, a positive integer, a boolean or undefined";
const RULE_WORD = "a path word must not contain / \\ . % ? #";
const RULE_RAW = "a request path must start with \"/\" and hold no dot segment (plain or encoded), backslash, fragment or encoded separator";

/** True for a positive integer, or a string of digits that is one (" 05 " excluded). */
export function isPositiveIntegerId(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && DIGITS.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

/**
 * The @absmartly/cli version actually installed, read at load time.
 *   - Where the package cannot be resolved on disk (a Worker or other bundle),
 *     the CLI was bundled at build time, so the version synced into
 *     version.ts then is the one running.
 *   - Where it resolves but its package.json cannot be read or has no
 *     version, the running version is unknown: "" (a mismatch, so the guard
 *     fails closed).
 */
export function detectCliVersion(
  resolveEntry: () => string,
  readPackageJson: (entry: string) => string,
  bundledVersion: string = CLI_CORE_VERSION,
): string {
  let entry: string;
  try {
    entry = resolveEntry();
  } catch {
    return bundledVersion;
  }
  try {
    const version = JSON.parse(readPackageJson(entry)).version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

function installedCliVersion(): string {
  const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => any } }).process?.getBuiltinModule;
  const moduleApi = getBuiltin?.("node:module");
  const fs = getBuiltin?.("node:fs");
  const path = getBuiltin?.("node:path");
  return detectCliVersion(
    () => moduleApi.createRequire(import.meta.url).resolve("@absmartly/cli/api-client"),
    // The package does not export ./package.json: walk up from its api-client entry.
    (entry) => fs.readFileSync(path.join(path.dirname(entry), "..", "..", "package.json"), "utf-8"),
  );
}

export type PathTable = Readonly<Record<string, { params: readonly string[]; path: readonly string[] }>>;

/**
 * The table used when the loaded @absmartly/cli is not the build the table was
 * generated from: no mapping is trusted, so every method is unknown. Unknown
 * methods then refuse unsafe strings and numbers but let plain objects and
 * arrays through (they are bodies and options), so a host on another 1.x keeps
 * working. Leftover risk: a newer CLI method that builds a path from a field
 * of an object argument (e.g. `/x/${opts.id}`) is not checked on such an
 * install. request/rawRequest are always checked.
 */
export const MISMATCHED_PATH_TABLE: PathTable = Object.freeze({});

/** The path table for a loaded @absmartly/cli version: the generated one only for the build it describes. */
export function pathTableFor(cliVersion: string): PathTable {
  return cliVersion === PATH_TABLE_CLI_VERSION ? API_PATH_METHODS : MISMATCHED_PATH_TABLE;
}

const mismatchWarned = { done: false };

/** Warns, once per process (or per `state`), that the loaded CLI is not the one the table describes. */
export function warnCliVersionMismatch(
  installed: string,
  warn: (message: string) => void = console.warn,
  state: { done: boolean } = mismatchWarned,
): boolean {
  if (installed === PATH_TABLE_CLI_VERSION || state.done) return false;
  state.done = true;
  warn(`@absmartly/mcp: @absmartly/cli ${installed || "(unknown version)"} is loaded, but the path guard table was generated from ${PATH_TABLE_CLI_VERSION}. `
    + "Path arguments are checked by type only (unsafe strings and numbers are refused); install @absmartly/cli "
    + `${PATH_TABLE_CLI_VERSION} for exact checks.`);
  return true;
}

const INSTALLED_CLI_VERSION = installedCliVersion();
warnCliVersionMismatch(INSTALLED_CLI_VERSION);

/** The table the guard uses: the generated one if the installed CLI matches it, else none. */
export const ACTIVE_PATH_TABLE = pathTableFor(INSTALLED_CLI_VERSION);

/** Unknown method, or a mapped non-ID path argument: refuse anything that could carry a path. */
function checkFailClosed(method: string, index: number, arg: unknown, rule: string, allowObjects = false): void {
  if (arg === undefined || typeof arg === "boolean") return;
  if (allowObjects && arg !== null && typeof arg === "object") return;
  if (typeof arg === "string" && !PATH_CHARS.test(arg)) return;
  if (typeof arg === "number" && isPositiveIntegerId(arg)) return;
  throw new PathIdError(method, index, arg, rule);
}

/**
 * request/rawRequest: the path must start with "/" and hold no dot segment,
 * encoded dot/slash/backslash/percent, backslash or fragment. request may
 * also take an absolute URL, but only the CLI's own root auth API
 * (`${getRootUrl()}/auth/current-user...`) on the configured origin.
 */
function checkRawPath(client: ApiClientLike, method: string, index: number, value: unknown): void {
  if (typeof value !== "string") throw new PathIdError(method, index, value, RULE_RAW);
  let path = value;
  if (!path.startsWith("/")) {
    const root = method === "request" ? (client as { getRootUrl?: () => string }).getRootUrl?.() : undefined;
    if (!root || !path.startsWith(`${root}${ROOT_AUTH_PATH}`)) throw new PathIdError(method, index, value, RULE_RAW);
    path = path.slice(root.length);
    if (path !== ROOT_AUTH_PATH && !/^\/auth\/current-user[/?]/.test(path)) throw new PathIdError(method, index, value, RULE_RAW);
  }
  const pathname = path.split("?")[0];
  if (pathname.startsWith("//") || RAW_PATH_FORBIDDEN.test(pathname)
    || pathname.split("/").some((s) => DOT_SEGMENT.test(decodeOrNull(s) ?? s))) {
    throw new PathIdError(method, index, value, RULE_RAW);
  }
}

const guardedClients = new WeakMap<object, object>();

/**
 * Wraps an APIClient so that every argument one of its methods puts into a
 * request path is checked before the method runs. Path arguments come from
 * src/api-path-args.ts, generated from the pinned @absmartly/cli build, and
 * are looked up by parameter name:
 *   - a mapped ID argument must be a positive integer;
 *   - a mapped non-ID path argument (uploadFile's `usage`) must be free of
 *     path characters;
 *   - request/rawRequest always validate their path argument;
 *   - any other method fails closed: strings with path characters and
 *     numbers that are not positive integers are refused, and so are
 *     non-primitive arguments, except when another CLI version is loaded
 *     (MISMATCHED_PATH_TABLE: every method is unknown, and plain objects and
 *     arrays pass so that bodies and options keep working).
 * Methods run with the proxy as `this`, so an APIClient method calling another
 * one (or request) is guarded too. Wrapping is idempotent: a client (or its
 * proxy) maps to one proxy, whose wrapped methods are cached until reassigned. `table` is for
 * tests; a non-default table is never cached.
 */
export function withPathIdGuard<T extends ApiClientLike>(client: T, table: PathTable = ACTIVE_PATH_TABLE): T {
  const cacheable = table === ACTIVE_PATH_TABLE;
  const mismatched = table === MISMATCHED_PATH_TABLE;
  const existing = cacheable ? guardedClients.get(client) : undefined;
  if (existing) return existing as T;
  // prop -> the method it wrapped and its guarded form. Keyed on the method
  // too, so a method reassigned after first access (a mock) is rewrapped.
  const wrapped = new Map<string, { method: Function; guarded: Function }>();
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      const cached = wrapped.get(prop);
      if (cached?.method === value) return cached.guarded;
      const rawIndex = Object.hasOwn(RAW_PATH_ARG, prop) ? RAW_PATH_ARG[prop] : undefined;
      const info = Object.hasOwn(table, prop) ? table[prop] : undefined;
      const words = Object.hasOwn(NON_ID_PATH_PARAMS, prop) ? NON_ID_PATH_PARAMS[prop] : [];
      const guarded = function (...args: unknown[]) {
        if (rawIndex !== undefined) {
          checkRawPath(target, prop, rawIndex, args[rawIndex]);
        } else if (info) {
          for (const name of info.path) {
            const index = info.params.indexOf(name);
            if (words.includes(name)) checkFailClosed(prop, index, args[index], RULE_WORD);
            else if (!isPositiveIntegerId(args[index])) throw new PathIdError(prop, index, args[index]);
          }
        } else {
          args.forEach((arg, index) => checkFailClosed(prop, index, arg, RULE_FAIL_CLOSED, mismatched));
        }
        return value.apply(receiver, args);
      };
      wrapped.set(prop, { method: value, guarded });
      return guarded;
    },
  });
  if (cacheable) {
    guardedClients.set(client, proxy);
    guardedClients.set(proxy, proxy);
  }
  return proxy;
}
