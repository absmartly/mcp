import type { ApiClientLike } from "./api-client-like.js";

// Path arguments that are not entity IDs (uploadFile's `usage` is a word).
const NON_ID_PATH_ARGS: Record<string, readonly number[]> = { uploadFile: [0] };
const DIGITS = /^[0-9]+$/;
// Characters that let a string argument change a request path, refused for
// methods whose path arguments cannot be derived.
const PATH_CHARS = /[/\\.%?#]/;

/** Thrown when a value that would become an ID path segment is not a positive integer. */
export class PathIdError extends Error {
  constructor(readonly method: string, readonly argIndex: number, readonly value: unknown) {
    super(`Invalid ID ${JSON.stringify(value)} for ${method}: a path ID must be a positive integer.`);
    this.name = "PathIdError";
  }
}

/** True for a positive integer, or a string of digits that is one (" 05 " excluded). */
export function isPositiveIntegerId(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && DIGITS.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

const REQUEST_CALL = /this\.request\(\s*[^,]+,\s*([^,)]+)/g;
const TEMPLATE_PATH = /^`([^`]*)`$/;
const INTERPOLATION = /\$\{([^}]*)\}/g;
const BARE_NAME = /^[\w$]+$/;
const ROOT_URL_NAME = "rootUrl";

/** A method's path arguments, or "unknown" when its source cannot be read with certainty. */
export type PathArgs = number[] | "unknown";

/**
 * Reads, from a method's own source (Function.prototype.toString), which of
 * its parameters its request paths interpolate. Anything it cannot read with
 * certainty (a non-template path, an interpolated expression that is not a
 * bare parameter name, a path built from a parameter via a helper) is
 * "unknown", and the guard then fails closed for that method. Derived from
 * the APIClient actually installed, so it holds for any @absmartly/cli in the
 * peer range, not just the one this package was built against.
 */
export function derivePathArgs(method: Function): PathArgs {
  const source = method.toString();
  const header = source.match(/^(?:async\s+)?[\w$]*\s*\(([^)]*)\)/);
  if (!header) return "unknown";
  const params = header[1].split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean);
  if (params.some((p) => !BARE_NAME.test(p))) return "unknown";
  const used = new Set<number>();
  for (const call of source.matchAll(REQUEST_CALL)) {
    const template = call[1].trim().match(TEMPLATE_PATH);
    if (!template) {
      if (/^'[^']*'$/.test(call[1].trim())) continue; // a fixed path
      return "unknown";
    }
    for (const expr of template[1].matchAll(INTERPOLATION)) {
      const name = expr[1].trim();
      if (name === ROOT_URL_NAME) continue;
      if (!BARE_NAME.test(name)) return "unknown";
      const index = params.indexOf(name);
      if (index < 0) return "unknown"; // a local derived from the arguments
      used.add(index);
    }
  }
  return [...used].sort((a, b) => a - b);
}

const pathArgsCache = new WeakMap<Function, PathArgs>();
function pathArgsFor(name: string, method: Function): PathArgs {
  let args = pathArgsCache.get(method);
  if (!args) {
    const derived = derivePathArgs(method);
    const skip = new Set(NON_ID_PATH_ARGS[name] ?? []);
    args = derived === "unknown" ? derived : derived.filter((i) => !skip.has(i));
    pathArgsCache.set(method, args);
  }
  return args;
}

/**
 * Wraps an APIClient so that every argument one of its methods interpolates
 * into a request path is
 * checked to be a positive integer before the method runs. This is the
 * boundary every catalog route reaches, after adapters, runners and core
 * functions have shaped their params, so an ID that arrives by any route
 * (top level, inside `data`, a core-name key) is covered.
 *
 * Path arguments are derived from each method's source at runtime
 * (derivePathArgs). For a method whose source cannot be read with certainty
 * it fails closed: every string argument must be free of path characters.
 * Methods run with the proxy as `this`, so an APIClient method calling another
 * (updateExperiment -> getExperiment) is guarded too.
 */
export function withPathIdGuard<T extends ApiClientLike>(client: T): T {
  const wrapped = new Map<string, Function>();
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      const cached = wrapped.get(prop);
      if (cached) return cached;
      const indexes = pathArgsFor(prop, value);
      const guarded = function (this: unknown, ...args: unknown[]) {
        if (indexes !== "unknown") {
          for (const index of indexes) {
            if (!isPositiveIntegerId(args[index])) throw new PathIdError(prop, index, args[index]);
          }
        } else {
          args.forEach((arg, index) => {
            if (typeof arg === "string" && PATH_CHARS.test(arg)) throw new PathIdError(prop, index, arg);
          });
        }
        // `receiver` (the proxy) as `this`, so a method calling another
        // APIClient method on `this` goes through the guard too.
        return value.apply(receiver, args);
      };
      wrapped.set(prop, guarded);
      return guarded;
    },
  });
}
