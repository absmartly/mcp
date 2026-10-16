// Audits every execute_command catalog command against the @absmartly/cli core
// function it dispatches to. For each command it builds sample params from the
// catalog's documented shape, runs them through normalizeCommandParams (the
// translation layer executeCommand uses), and compares the result with the
// params type the core function declares in its .d.ts.
//
// A command is reported when, after translation:
//   - a documented param reaches the core under a name the core never reads
//     (it would be silently dropped), or
//   - a param the core requires is missing and cannot come from a flattened
//     `data`/`params` object.
// Commands dispatched by a dedicated runner (positional core signatures) are
// covered by the runner's own tests instead.
//
// tests/unit/cli-catalog-core-params.test.ts fails on any finding not listed in
// KNOWN_CATALOG_GAPS. Usage: npx tsx scripts/audit-catalog-params.ts [--json]
import ts from "typescript";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_GROUPS, getGroupCommands, normalizeCommandParams, hasCommandRunner } from "../src/cli-catalog.js";

const require = createRequire(import.meta.url);

// Probe placed inside object-typed params, to see where their contents land.
const PROBE_KEY = "__auditProbe";
const SAMPLE_BASE = 9000;
// Injected by the execute_command handler (src/tools.ts), not by the caller.
const LIST_INJECTED_PARAMS = ["items", "page"];
const ALWAYS_INJECTED_PARAMS = ["apiEndpoint"];

export interface CatalogParamFinding {
  command: string;
  /** Catalog params whose value reaches the core under a name it does not read. */
  dropped: string[];
  /** Params the core requires that the translated params do not supply. */
  missingRequired: string[];
}

interface CoreProp {
  optional: boolean;
}

function coreDtsPath(group: string): string {
  return require.resolve(`@absmartly/cli/core/${group}`).replace(/\.js$/, ".d.ts");
}

function loadCoreShapes(): Map<string, Map<string, CoreProp> | null> {
  const program = ts.createProgram(CLI_GROUPS.map(coreDtsPath), { skipLibCheck: true, strict: true });
  const checker = program.getTypeChecker();
  const shapes = new Map<string, Map<string, CoreProp> | null>();
  for (const group of CLI_GROUPS) {
    const sf = program.getSourceFile(coreDtsPath(group));
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    for (const entry of getGroupCommands(group)) {
      const exp = exports.find((s) => s.name === entry.command);
      if (!exp) throw new Error(`Core function ${group}.${entry.command} not found`);
      const resolved = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      const [signature] = checker.getTypeOfSymbol(resolved).getCallSignatures();
      const params = signature?.getParameters() ?? [];
      if (params.length < 2) {
        shapes.set(`${group}.${entry.command}`, new Map());
        continue;
      }
      const paramType = checker.getTypeOfSymbol(params[1]);
      if (checker.isArrayType(paramType)) {
        shapes.set(`${group}.${entry.command}`, null); // positional, not an object of params
        continue;
      }
      const props = new Map<string, CoreProp>();
      for (const prop of checker.getPropertiesOfType(paramType)) {
        props.set(prop.name, { optional: (prop.flags & ts.SymbolFlags.Optional) !== 0 });
      }
      shapes.set(`${group}.${entry.command}`, props);
    }
  }
  return shapes;
}

// Each documented param gets a distinct sample value, so the audit can trace
// where it lands after translation.
function sampleValue(type: string, index: number): unknown {
  const n = SAMPLE_BASE + index;
  switch (type) {
    case "number": return n;
    case "boolean": return true;
    case "array": return [n];
    case "object": return { [PROBE_KEY]: n };
    default: return `s${n}`;
  }
}

function sampleToken(type: string, index: number): string {
  const n = SAMPLE_BASE + index;
  if (type === "boolean") return "true";
  return type === "string" ? `s${n}` : String(n);
}

/** True when `token` occurs anywhere inside `value` (after a number/string coercion). */
function reaches(value: unknown, token: string): boolean {
  if (Array.isArray(value)) return value.some((v) => reaches(v, token));
  if (value && typeof value === "object") return Object.values(value).some((v) => reaches(v, token));
  return String(value) === token;
}

export function auditCatalogParams(): CatalogParamFinding[] {
  const shapes = loadCoreShapes();
  const findings: CatalogParamFinding[] = [];
  for (const group of CLI_GROUPS) {
    for (const entry of getGroupCommands(group)) {
      if (hasCommandRunner(group, entry.command)) continue;
      const key = `${group}.${entry.command}`;
      const core = shapes.get(key);
      if (core === null || core === undefined) {
        findings.push({ command: key, dropped: ["<positional core signature without a runner>"], missingRequired: [] });
        continue;
      }

      const sample: Record<string, unknown> = {};
      entry.params.forEach((p, i) => { sample[p.name] = sampleValue(p.type, i); });
      const translated = normalizeCommandParams(group, entry.command, sample);

      const injected = new Set(ALWAYS_INJECTED_PARAMS);
      if (/^(list|search)/.test(entry.command)) LIST_INJECTED_PARAMS.forEach((p) => injected.add(p));

      // What the core actually reads: its declared props, plus every top-level
      // key when an object param was flattened (its fields are caller-chosen).
      const flattened = PROBE_KEY in translated;
      const read = Object.fromEntries(
        Object.entries(translated).filter(([name]) => core.has(name) || name === PROBE_KEY),
      );
      const dropped = entry.params
        .filter((p, i) => !injected.has(p.name) && !reaches(read, sampleToken(p.type, i)))
        .map((p) => p.name);
      const missingRequired = [...core.entries()]
        .filter(([name, prop]) => !prop.optional && translated[name] === undefined && !injected.has(name) && !flattened)
        .map(([name]) => name);

      if (dropped.length > 0 || missingRequired.length > 0) {
        findings.push({ command: key, dropped, missingRequired });
      }
    }
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = auditCatalogParams();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    for (const f of findings) {
      console.log(`${f.command}\n  dropped: ${f.dropped.join(", ") || "-"}\n  missing required: ${f.missingRequired.join(", ") || "-"}`);
    }
    console.log(`\n${findings.length} commands with catalog/core param mismatches`);
  }
}
