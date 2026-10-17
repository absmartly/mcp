// Audits every execute_command catalog command against the @absmartly/cli core
// function it dispatches to. For each command it builds sample params from the
// catalog's documented shape, runs them through normalizeCommandParams (the
// translation layer executeCommand uses), and compares the result with the
// params type the core function declares in its .d.ts.
//
// Each documented param is checked on its own by ablation: translate the full
// sample, translate it again with that one param changed, and compare what the
// core reads. If nothing it reads changes, the param is dropped. This covers
// booleans and nested objects alike, whatever the sample values are.
//
// Object params get two extra checks:
//   - `data`: every field the core reads is placed inside `data` under its API
//     (snake_case) name; it must reach the core under the name the core reads.
//   - `params`: an opaque filter bag. If the core reads named fields from it,
//     the catalog must document them, so the bag is reported as undocumented.
//
// A command is also reported when a param the core requires is missing.
// Commands dispatched by a runner (src/cli-catalog.ts COMMAND_RUNNERS) are
// covered by the runner integration tests instead.
//
// tests/unit/cli-catalog-core-params.test.ts fails on any finding not listed in
// KNOWN_CATALOG_GAPS. Usage: npx tsx scripts/audit-catalog-params.ts [--json]
import ts from "typescript";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_GROUPS, getGroupCommands, normalizeCommandParams, normalizeIdParams, hasCommandRunner } from "../src/cli-catalog.js";

const require = createRequire(import.meta.url);

const DATA_PARAM = "data";
const FILTER_BAG_PARAM = "params";
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

function sampleValue(type: string, seed: number): unknown {
  switch (type) {
    case "number": return seed;
    case "boolean": return seed % 2 === 0;
    case "array": return [seed];
    case "object": return { [`field${seed}`]: seed };
    default: return `s${seed}`;
  }
}

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The slice of translated params the core reads, as a comparable string. */
function readView(translated: Record<string, unknown>, core: Map<string, CoreProp>): string {
  return JSON.stringify([...core.keys()].sort().map((name) => [name, translated[name]]));
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

      const injected = new Set(ALWAYS_INJECTED_PARAMS);
      if (/^(list|search)/.test(entry.command)) LIST_INJECTED_PARAMS.forEach((p) => injected.add(p));
      // The same pipeline executeCommand runs: IDs first, then the adapter.
      // Deprecated params are left out of the sample: they are aliases or
      // ignored, and an alias would otherwise compete with its canonical param.
      const translate = (params: Record<string, unknown>) =>
        normalizeCommandParams(group, entry.command, normalizeIdParams(group, entry.command, structuredClone(params)));

      const sample: Record<string, unknown> = {};
      entry.params.forEach((p, i) => { if (!p.deprecated) sample[p.name] = sampleValue(p.type, SAMPLE_BASE + 2 * i); });
      const baseline = readView(translate(sample), core);

      const dropped: string[] = [];
      const dataParam = entry.params.find((p) => p.name === DATA_PARAM);
      entry.params.forEach((p, i) => {
        // Deprecated params are accepted for backward compatibility and are not
        // documented, so they may be ignored or superseded by documented ones.
        if (injected.has(p.name) || p === dataParam || p.deprecated) return;
        const changed = { ...sample, [p.name]: sampleValue(p.type, SAMPLE_BASE + 2 * i + 1) };
        if (readView(translate(changed), core) !== baseline) return;
        dropped.push(p.name === FILTER_BAG_PARAM
          ? `${FILTER_BAG_PARAM} (core reads undocumented fields: ${[...core.keys()].join(", ")})`
          : p.name);
      });

      // `data`: forwarded whole (the core reads it as one field), or flattened,
      // in which case each core field sent under its API name must arrive.
      if (dataParam) {
        const changed = { ...sample, [DATA_PARAM]: sampleValue("object", SAMPLE_BASE - 1) };
        const forwardedWhole = readView(translate(changed), core) !== baseline;
        const { [DATA_PARAM]: _data, ...withoutData } = sample;
        const fromOtherParams = translate(withoutData);
        for (const field of forwardedWhole ? [] : core.keys()) {
          if (fromOtherParams[field] !== undefined) continue;
          const apiName = snakeCase(field);
          const probe = { ...sample, [DATA_PARAM]: { [apiName]: `v_${field}` } };
          if (translate(probe)[field] !== `v_${field}`) dropped.push(`${DATA_PARAM}.${apiName}`);
        }
      }

      const full = translate(sample);
      const flattenedData = dataParam !== undefined && !(DATA_PARAM in full);
      const missingRequired = [...core.entries()]
        .filter(([name, prop]) => !prop.optional && full[name] === undefined && !injected.has(name) && !flattenedData)
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
