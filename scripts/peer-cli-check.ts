// Checks that every @absmartly/cli core function and APIClient method the
// execute_command catalog dispatches to exists in another CLI install, such
// as the minimum version of the peer range (package.json peerDependencies).
// The pinned devDependency is covered by the unit tests; this covers the
// rest of the range a host may install.
//
// Usage: npx tsx scripts/peer-cli-check.ts <path to an @absmartly/cli package>
// CI installs the peer minimum into a scratch directory and runs this on it.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  getGroupSummary,
  RUNNER_API_METHODS,
  RUNNER_EXTRA_CORE_FUNCTIONS,
  RUNNERS_WITHOUT_NAMED_CORE_FUNCTION,
} from "../src/cli-catalog.js";

// Catalog groups whose core module is a sub-path of another group's directory.
const CORE_DIRS: Record<string, string> = { analyze: "experiments/analyze" };

/** Every core function (as "dir.fn") and APIClient method the catalog can call. */
export function requiredCliSurface(): { coreFunctions: string[]; apiMethods: string[] } {
  const core = new Set<string>();
  const api = new Set<string>();
  for (const { group, commands } of getGroupSummary()) {
    for (const command of commands) {
      const key = `${group}.${command}`;
      const named = RUNNERS_WITHOUT_NAMED_CORE_FUNCTION.has(key) ? [] : [command];
      for (const ref of [...named, ...(RUNNER_EXTRA_CORE_FUNCTIONS[key] ?? [])]) {
        const [g, fn] = ref.includes(".") ? ref.split(".") : [group, ref];
        core.add(`${CORE_DIRS[g] ?? g}.${fn}`);
      }
      for (const method of RUNNER_API_METHODS[key] ?? []) api.add(method);
    }
  }
  return { coreFunctions: [...core].sort(), apiMethods: [...api].sort() };
}

export async function missingFrom(cliPackageDir: string): Promise<string[]> {
  const dist = join(cliPackageDir, "dist");
  const { coreFunctions, apiMethods } = requiredCliSurface();
  const missing: string[] = [];
  const modules = new Map<string, Record<string, unknown> | null>();
  for (const ref of coreFunctions) {
    const dot = ref.lastIndexOf(".");
    const [dir, fn] = [ref.slice(0, dot), ref.slice(dot + 1)];
    if (!modules.has(dir)) {
      try {
        modules.set(dir, await import(pathToFileURL(join(dist, "core", dir, "index.js")).href));
      } catch {
        modules.set(dir, null);
      }
    }
    const mod = modules.get(dir);
    if (!mod) missing.push(`core/${dir} (module)`);
    else if (typeof mod[fn] !== "function") missing.push(`core/${dir}.${fn}`);
  }
  const { APIClient } = await import(pathToFileURL(join(dist, "api-client", "index.js")).href) as { APIClient: { prototype: Record<string, unknown> } };
  for (const method of apiMethods) {
    if (typeof APIClient.prototype[method] !== "function") missing.push(`APIClient.${method}`);
  }
  return [...new Set(missing)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: npx tsx scripts/peer-cli-check.ts <path to an @absmartly/cli package>");
  const dir = resolve(target);
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).version;
  const missing = await missingFrom(dir);
  if (missing.length > 0) {
    console.error(`@absmartly/cli ${version} lacks what the catalog calls:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`@absmartly/cli ${version} has every core function and APIClient method the catalog calls`);
}
