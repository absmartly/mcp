import type { ApiClientLike } from "./api-client-like.js";
import { API_PATH_ARGS } from "./api-path-args.js";

// Path arguments that are not entity IDs (uploadFile's `usage` is a word).
const NON_ID_PATH_ARGS: Record<string, readonly number[]> = { uploadFile: [0] };
const DIGITS = /^[0-9]+$/;

/** Thrown when a value that would become an ID path segment is not a positive integer. */
export class PathIdError extends Error {
  constructor(readonly method: string, readonly argIndex: number, readonly value: unknown) {
    super(`Invalid ID ${JSON.stringify(value)} for ${method}: a path ID must be a positive integer.`);
    this.name = "PathIdError";
  }
}

function isPositiveIntegerId(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && DIGITS.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

/**
 * Wraps an APIClient so that every argument one of its methods interpolates
 * into a request path (src/api-path-args.ts, generated from the CLI build) is
 * checked to be a positive integer before the method runs. This is the
 * boundary every catalog route reaches, after adapters, runners and core
 * functions have shaped their params, so an ID that arrives by any route
 * (top level, inside `data`, a core-name key) is covered.
 */
export function withPathIdGuard<T extends ApiClientLike>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      const indexes = API_PATH_ARGS[prop];
      if (!indexes) return value.bind(target);
      const skip = new Set(NON_ID_PATH_ARGS[prop] ?? []);
      return (...args: unknown[]) => {
        for (const index of indexes) {
          if (!skip.has(index) && !isPositiveIntegerId(args[index])) throw new PathIdError(prop, index, args[index]);
        }
        return value.apply(target, args);
      };
    },
  });
}
