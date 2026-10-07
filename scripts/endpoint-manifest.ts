// Builds endpoint-manifest.json: every ABsmartly backend endpoint (HTTP method
// + path template) each MCP tool, and each execute_command command, can call.
//
// Derived, not hand-maintained. The generator reads the installed
// @absmartly/cli build:
//   1. Each APIClient method's `this.request(METHOD, path)` calls, following
//      `this.otherMethod(` calls inside the class.
//   2. Each catalog command's core function, following the imports of the
//      core module to its helpers, and collecting every `.apiMethod(` call.
// It also reads this repo's own source for the entity-context calls in
// src/server-context.ts and the template-preview calls in src/tools.ts.
//
// The static walk may over-approximate (it counts calls on every branch). That
// is correct for a contract test, which must fail when any reachable endpoint
// is missing from the backend. tests/unit/endpoint-manifest.test.ts runs every
// command against a recording client to prove the walk does not miss calls.
//
// Usage: npx tsx scripts/endpoint-manifest.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getGroupSummary } from "../src/cli-catalog.js";
import type { Endpoint, EndpointHttpMethod as HttpMethod, EndpointManifest } from "../src/endpoint-manifest.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = join(ROOT, "endpoint-manifest.json");

// @absmartly/cli does not export ./package.json; resolve its api-client entry
// (<pkg>/dist/api-client/index.js) and walk up to the package root.
const require = createRequire(import.meta.url);
const CLI_DIST = resolve(dirname(require.resolve("@absmartly/cli/api-client")), "..");
const CLI_PACKAGE_JSON = join(CLI_DIST, "..", "package.json");
const API_CLIENT_FILE = join(CLI_DIST, "api-client", "api-client.js");

const V1_PREFIX = "/v1";
const ROOT_URL_PLACEHOLDER = "${rootUrl}";

// ─── APIClient methods → endpoints ──────────────────────────────────────────

interface ApiMethodInfo {
  endpoints: Endpoint[];
  calls: string[];
  dynamic: boolean;
}

function templateToPath(literal: string): string {
  let raw = literal.slice(1, -1);
  let prefix = V1_PREFIX;
  if (raw.startsWith(ROOT_URL_PLACEHOLDER)) {
    raw = raw.slice(ROOT_URL_PLACEHOLDER.length);
    prefix = "";
  }
  raw = raw.split("?")[0];
  // ${expr} → {name}, using the expression's last identifier as the name.
  const path = raw.replace(/\$\{([^}]*)\}/g, (_m, expr: string) => {
    const ids = expr.match(/[A-Za-z_]\w*/g) ?? ["param"];
    return `{${ids[ids.length - 1]}}`;
  });
  return `${prefix}${path}`;
}

function parseApiClient(): Map<string, ApiMethodInfo> {
  const source = readFileSync(API_CLIENT_FILE, "utf-8");
  const classStart = source.indexOf("export class APIClient");
  const classEnd = source.indexOf("\n}\n", classStart);
  const classBody = source.slice(classStart, classEnd);
  const methods = new Map<string, ApiMethodInfo>();
  const headers = [...classBody.matchAll(/^ {4}(?:async )?(\w+)\(/gm)];
  headers.forEach((match, i) => {
    const name = match[1];
    if (name === "constructor" || name === "request") return;
    const body = classBody.slice(match.index!, headers[i + 1]?.index ?? classBody.length);
    const info: ApiMethodInfo = { endpoints: [], calls: [], dynamic: false };
    for (const call of body.matchAll(/this\.request\(\s*([^,]+),\s*(`[^`]*`|'[^']*')?/g)) {
      const method = call[1].trim().replace(/^'|'$/g, "");
      if (!call[2] || !/^(GET|POST|PUT|DELETE)$/.test(method)) {
        info.dynamic = true;
        continue;
      }
      info.endpoints.push({ method: method as HttpMethod, path: templateToPath(call[2]) });
    }
    for (const call of body.matchAll(/this\.(\w+)\(/g)) {
      if (call[1] !== "request" && !call[1].startsWith("validate") && call[1] !== name) info.calls.push(call[1]);
    }
    methods.set(name, info);
  });
  return methods;
}

function resolveApiMethod(methods: Map<string, ApiMethodInfo>, name: string, seen = new Set<string>()): { endpoints: Endpoint[]; dynamic: boolean } {
  const info = methods.get(name);
  if (!info || seen.has(name)) return { endpoints: [], dynamic: false };
  seen.add(name);
  const endpoints = [...info.endpoints];
  let dynamic = info.dynamic;
  for (const callee of info.calls) {
    if (!methods.has(callee)) continue;
    const nested = resolveApiMethod(methods, callee, seen);
    endpoints.push(...nested.endpoints);
    dynamic ||= nested.dynamic;
  }
  return { endpoints, dynamic };
}

// ─── Module graph: core function → APIClient methods ────────────────────────

interface ModuleInfo {
  functions: Map<string, string>;
  imports: Map<string, { file: string; name: string }>;
  reexports: Map<string, { file: string; name: string }>;
}

const moduleCache = new Map<string, ModuleInfo>();

function parseModule(file: string): ModuleInfo {
  const cached = moduleCache.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf-8");
  const info: ModuleInfo = { functions: new Map(), imports: new Map(), reexports: new Map() };
  moduleCache.set(file, info);

  const bindingList = (list: string, from: string, target: Map<string, { file: string; name: string }>) => {
    for (const part of list.split(",")) {
      const [imported, local] = part.trim().split(/\s+as\s+/);
      if (imported) target.set((local ?? imported).trim(), { file: resolve(dirname(file), from), name: imported.trim() });
    }
  };
  for (const m of source.matchAll(/^import \{([^}]*)\} from '(\.[^']+)'/gm)) bindingList(m[1], m[2], info.imports);
  for (const m of source.matchAll(/^export \{([^}]*)\} from '(\.[^']+)'/gm)) bindingList(m[1], m[2], info.reexports);

  const decls = [...source.matchAll(/^(?:export )?(?:async )?function\*? (\w+)\(|^(?:export )?const (\w+) = (?:async )?(?:\([^)]*\)|\w+) =>/gm)];
  const topLevel = [...source.matchAll(/^\S/gm)].map(m => m.index!);
  for (const decl of decls) {
    const start = decl.index!;
    const end = topLevel.find(i => i > start && !/^[)}\]]/.test(source.slice(i, i + 1))) ?? source.length;
    info.functions.set(decl[1] ?? decl[2], source.slice(start, end));
  }
  return info;
}

function resolveExport(file: string, name: string, seen = new Set<string>()): { file: string; body: string } | undefined {
  const key = `${file}#${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const mod = parseModule(file);
  const body = mod.functions.get(name);
  if (body) return { file, body };
  const target = mod.reexports.get(name) ?? mod.imports.get(name);
  return target ? resolveExport(target.file, target.name, seen) : undefined;
}

function collectApiMethods(file: string, body: string, apiMethodNames: Set<string>, seen: Set<string>, out: Set<string>): void {
  for (const m of body.matchAll(/\.(\w+)\(/g)) {
    if (apiMethodNames.has(m[1])) out.add(m[1]);
  }
  const mod = parseModule(file);
  for (const m of body.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b/g)) {
    const id = m[1];
    const local = mod.functions.has(id) ? { file, name: id } : mod.imports.get(id);
    if (!local) continue;
    const key = `${local.file}#${local.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const target = resolveExport(local.file, local.name);
    if (target) collectApiMethods(target.file, target.body, apiMethodNames, seen, out);
  }
}

// Mirrors the CORE_MODULES map in src/cli-catalog.ts (group → @absmartly/cli/core/<dir>).
function coreModuleFile(group: string): string {
  const catalog = readFileSync(join(ROOT, "src", "cli-catalog.ts"), "utf-8");
  const alias = catalog.match(new RegExp(`^\\s+${group}: (\\w+) as unknown`, "m"))?.[1];
  const dir = alias && catalog.match(new RegExp(`import \\* as ${alias} from "@absmartly/cli/core/([\\w-]+)"`))?.[1];
  if (!dir) throw new Error(`Cannot find the @absmartly/cli core module for catalog group "${group}"`);
  return join(CLI_DIST, "core", dir, "index.js");
}

function apiMethodsCalledIn(sourceFile: string, pattern: RegExp, apiMethodNames: Set<string>): string[] {
  const source = readFileSync(sourceFile, "utf-8");
  const section = source.match(pattern)?.[0];
  if (!section) throw new Error(`Section ${pattern} not found in ${sourceFile}`);
  return [...section.matchAll(/apiClient\.(\w+)\(/g)].map(m => m[1]).filter(n => apiMethodNames.has(n));
}

// ─── Manifest ───────────────────────────────────────────────────────────────

function sortEndpoints(endpoints: Endpoint[]): Endpoint[] {
  const unique = new Map(endpoints.map(e => [`${e.method} ${e.path}`, e]));
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function buildEndpointManifest(): EndpointManifest {
  const apiMethods = parseApiClient();
  const apiMethodNames = new Set(apiMethods.keys());
  const dynamicApiMethods = new Set<string>();
  const endpointsFor = (names: Iterable<string>): Endpoint[] => {
    const all: Endpoint[] = [];
    for (const name of names) {
      const resolved = resolveApiMethod(apiMethods, name);
      if (resolved.dynamic) dynamicApiMethods.add(name);
      all.push(...resolved.endpoints);
    }
    return sortEndpoints(all);
  };

  const commands: EndpointManifest["commands"] = {};
  for (const { group, commands: names } of getGroupSummary()) {
    const moduleFile = coreModuleFile(group);
    for (const command of names) {
      const target = resolveExport(moduleFile, command);
      if (!target) throw new Error(`Core function ${group}.${command} not found in ${moduleFile}`);
      const called = new Set<string>();
      collectApiMethods(target.file, target.body, apiMethodNames, new Set(), called);
      const sorted = [...called].sort();
      commands[`${group}.${command}`] = { apiMethods: sorted, endpoints: endpointsFor(sorted) };
    }
  }

  // Entity lists behind get_auth_status, the createExperiment docs and the
  // absmartly://entities/* resources (src/server-context.ts buildServerContext).
  const entityMethods = apiMethodsCalledIn(join(ROOT, "src", "server-context.ts"), /export async function buildServerContext[\s\S]*?\n}\n/, apiMethodNames);
  const entityEndpoints = endpointsFor(entityMethods);

  // createExperimentFromTemplate's preview calls @absmartly/cli's
  // buildPayloadFromTemplate directly (src/tools.ts), not the core function.
  const previewTarget = resolveExport(join(CLI_DIST, "api-client", "index.js"), "buildPayloadFromTemplate");
  if (!previewTarget) throw new Error("buildPayloadFromTemplate not found in @absmartly/cli/api-client");
  const previewMethods = new Set<string>();
  collectApiMethods(previewTarget.file, previewTarget.body, apiMethodNames, new Set(), previewMethods);

  const commandEndpoints = Object.values(commands).flatMap(c => c.endpoints);
  const tools: EndpointManifest["tools"] = {
    get_auth_status: { endpoints: entityEndpoints },
    discover_commands: { endpoints: [] },
    get_command_docs: { endpoints: entityEndpoints },
    execute_command: { endpoints: sortEndpoints([...commandEndpoints, ...entityEndpoints, ...endpointsFor(previewMethods)]) },
  };

  const resources: EndpointManifest["resources"] = {};
  const registerServer = readFileSync(join(ROOT, "src", "register-server.ts"), "utf-8");
  for (const m of registerServer.matchAll(/uri: "(absmartly:\/\/entities\/[\w-]+)"/g)) {
    resources[m[1]] = { endpoints: entityEndpoints };
  }

  const cliVersion = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf-8")).version as string;
  return {
    manifestVersion: 1,
    generatedFrom: { "@absmartly/cli": cliVersion },
    endpoints: sortEndpoints([...Object.values(tools), ...Object.values(resources)].flatMap(t => t.endpoints)),
    tools,
    resources,
    commands,
    dynamicApiMethods: [...dynamicApiMethods].sort(),
  };
}

export function serializeManifest(manifest: EndpointManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = serializeManifest(buildEndpointManifest());
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(MANIFEST_PATH, "utf-8"); } catch { /* missing counts as stale */ }
    if (current !== next) {
      console.error("endpoint-manifest.json is stale; run `npm run manifest` and commit the result.");
      process.exit(1);
    }
    console.log("endpoint-manifest.json is current.");
  } else {
    writeFileSync(MANIFEST_PATH, next);
    console.log(`Wrote ${MANIFEST_PATH}`);
  }
}
