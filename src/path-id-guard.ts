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
 * The @absmartly/cli version actually installed, read at load time where it
 * can be resolved on disk (Node). Where it cannot (a Worker or other bundle),
 * the CLI was bundled at build time, so the version synced into version.ts
 * then is the one running.
 */
function installedCliVersion(): string {
  try {
    const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => any } }).process?.getBuiltinModule;
    const moduleApi = getBuiltin?.("node:module");
    const fs = getBuiltin?.("node:fs");
    const path = getBuiltin?.("node:path");
    if (!moduleApi?.createRequire || !fs || !path) return CLI_CORE_VERSION;
    const require = moduleApi.createRequire(import.meta.url);
    // The package does not export ./package.json: walk up from its api-client entry.
    const entry: string = require.resolve("@absmartly/cli/api-client");
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), "..", "..", "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return CLI_CORE_VERSION;
  }
}

export type PathTable = Readonly<Record<string, { params: readonly string[]; path: readonly string[] }>>;

/**
 * The path table for a loaded @absmartly/cli version. The generated table
 * describes exactly one build (the version the package pins); for any other
 * version no mapping is trusted, so the table is empty and every method is
 * treated as unknown.
 */
export function pathTableFor(cliVersion: string): PathTable {
  return cliVersion === PATH_TABLE_CLI_VERSION ? API_PATH_METHODS : {};
}

/** The table the guard uses: the generated one if the installed CLI matches it, else none. */
export const ACTIVE_PATH_TABLE = pathTableFor(installedCliVersion());

/** Unknown method, or a mapped non-ID path argument: refuse anything that could carry a path. */
function checkFailClosed(method: string, index: number, arg: unknown, rule: string): void {
  if (arg === undefined || typeof arg === "boolean") return;
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
 *   - any other method (unmapped, or every method when another CLI version is
 *     loaded) fails closed: non-primitive arguments, strings with path
 *     characters and numbers that are not positive integers are refused.
 * Methods run with the proxy as `this`, so an APIClient method calling another
 * one (or request) is guarded too. Wrapping is idempotent: a client (or its
 * proxy) maps to one proxy, whose wrapped methods are cached. `table` is for
 * tests; a non-default table is never cached.
 */
export function withPathIdGuard<T extends ApiClientLike>(client: T, table: PathTable = ACTIVE_PATH_TABLE): T {
  const cacheable = table === ACTIVE_PATH_TABLE;
  const existing = cacheable ? guardedClients.get(client) : undefined;
  if (existing) return existing as T;
  const wrapped = new Map<string, Function>();
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      const cached = wrapped.get(prop);
      if (cached) return cached;
      const rawIndex = RAW_PATH_ARG[prop];
      const info = Object.hasOwn(table, prop) ? table[prop] : undefined;
      const words = NON_ID_PATH_PARAMS[prop] ?? [];
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
          args.forEach((arg, index) => checkFailClosed(prop, index, arg, RULE_FAIL_CLOSED));
        }
        return value.apply(receiver, args);
      };
      wrapped.set(prop, guarded);
      return guarded;
    },
  });
  if (cacheable) {
    guardedClients.set(client, proxy);
    guardedClients.set(proxy, proxy);
  }
  return proxy;
}
