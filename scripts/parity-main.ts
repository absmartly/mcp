// Runs 2.0-style executeCommand calls through the 2.0.1 release's cli-catalog
// and this branch's, over a recording HttpClient, and compares the requests,
// the error (present or not, and its class) and the resolved value. A call may
// differ only if it is in EXPECTED_DIFFERENCES, with the reason and the exact
// outcome this branch must produce.
// The baseline is pinned to the 2.0.1 commit, not origin/main: once this
// branch merges, main is this branch and every difference would read as stale.
// Usage: npx tsx scripts/parity-main.ts [git-ref]  (default: the 2.0.1 commit)
//        npx tsx scripts/parity-main.ts --print-baseline  (prints the default ref)
// CI-only gate (.github/workflows/ci.yml); not part of npm test, which must
// run without the baseline commit fetched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APIClient } from "@absmartly/cli/api-client";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "@absmartly/cli/api-client";
import { executeCommand as executeBranch } from "../src/cli-catalog.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 2.0.1 (#64, squash-merged as f8331b6; published to npm as 2.0.1).
export const PARITY_BASELINE = "f8331b6d6dff803a8bdbafd6e943d125d6a09605";
const ARGS = process.argv.slice(2);
const REF = ARGS.find((a) => !a.startsWith("--")) ?? PARITY_BASELINE;

type Call = { group: string; command: string; params: Record<string, unknown> };

const callKey = (c: Call) => `${c.group}.${c.command} ${JSON.stringify(c.params)}`;

type Recorded = { method: string; url: string; params?: unknown; data?: unknown };
/** What a call produced: the requests it sent, its error class if it threw, and its resolved value. */
type Outcome = { requests: Recorded[]; errorClass?: string; result?: unknown };

/**
 * Intentional differences from 2.0.1 for direct executeCommand callers: the
 * reason, and the exact outcome this branch must produce (every request, the
 * error class, the resolved value), so a regression that differs in any way
 * still fails. Keep in step with CHANGELOG.md ("Behaviour changes for direct
 * executeCommand callers"). `npm run parity:main -- --print` prints the
 * branch outcomes in this shape.
 */
export const EXPECTED_DIFFERENCES: Record<string, { reason: string; branch: Outcome; resultIncludes?: string[] }> = {
  "goals.getGoal {\"goalId\":\"1/../users\"}": {
    reason: "ID safety: a path ID must be a positive integer",
    branch: {"requests": [], "errorClass": "IdParamError"},
  },
  "platformconfig.getPlatformConfig {\"id\":null}": {
    reason: "2.0.1 errored too; the message now names the invalid config",
    branch: {"requests": [], "errorClass": "Error"},
  },
  "experiments.startExperiment {\"experimentId\":null}": {
    reason: "ID safety: null would become /experiments/null",
    branch: {"requests": [], "errorClass": "IdParamError"},
  },
  "platformconfig.updatePlatformConfig {\"id\":3,\"value\":5}": {
    reason: "2.0.1 errored too (configKey missing); same failure, clearer message",
    branch: {"requests": [], "errorClass": "Error"},
  },
  "goals.updateGoal {\"data\":{\"id\":\"abc\",\"description\":\"x\"}}": {
    reason: "ID safety: an ID nested in data is checked at the path",
    branch: {"requests": [], "errorClass": "PathIdError"},
  },
  "experiments.startExperiment {}": {
    reason: "ID safety: 2.0.1 sent GET /experiments/undefined",
    branch: {"requests": [], "errorClass": "PathIdError"},
  },
  "experiments.revokeExperimentAccessUser {\"experimentId\":5,\"userId\":3,\"role\":\"Editor\"}": {
    reason: "2.0.1 sent DELETE .../3/undefined (core ignored role); role is now resolved by name (the recorder has no \"Editor\" role, so: not found)",
    branch: {"requests": [{"method": "GET", "url": "/asset_roles", "params": {"items": "100", "page": "1"}}], "errorClass": "Error"},
  },
  "experiments.listCustomFields {}": {
    reason: "Default type \"test\" (2.0.1 filtered on undefined and always returned none)",
    branch: {"requests": [{"method": "GET", "url": "/experiment_custom_section_fields", "params": {"items": "100", "page": "1"}}], "result": {"data": [], "rows": [], "pagination": {"page": 1, "items": 100, "hasMore": false}}},
  },
  "experiments.generateTemplate {}": {
    reason: "Default name \"My Experiment\" (2.0.1 generated a template from name undefined, so \"my_experiment\")",
    // The template embeds today's date and the local timezone: pin the
    // requests, and check the result for the stable default name.
    branch: {"requests": [{"method": "GET", "url": "/applications", "params": {}}, {"method": "GET", "url": "/unit_types", "params": {}}, {"method": "GET", "url": "/metrics", "params": {}}]},
    resultIncludes: ["name: My Experiment", "display_name: My Experiment"],
  },
  "goals.getGoal {\"goalId\":5,\"id\":6}": {
    reason: "A declared alias that disagrees with its documented param is an error (2.0.1 silently used id)",
    branch: {"requests": [], "errorClass": "IdParamError"},
  },
  "goals.grantGoalAccessUser {\"goalId\":5,\"userId\":3,\"roleId\":7,\"role\":\"x\"}": {
    reason: "roleId and role disagree: an error (2.0.1 ignored role and used roleId)",
    branch: {"requests": [], "errorClass": "IdParamError"},
  },
  "experiments.grantExperimentAccessUser {\"experimentId\":5,\"userId\":3,\"roleId\":\"Editor\"}": {
    reason: "roleId is an asset role ID; a name belongs in role (2.0.1 sent asset_role_id \"Editor\")",
    branch: {"requests": [], "errorClass": "IdParamError"},
  },
  "datasources.testDatasource {}": {
    reason: "Nothing to test: needs datasourceId or config (2.0.1 posted an empty body)",
    branch: {"requests": [], "errorClass": "Error"},
  },
  "datasources.validateDatasourceQuery {\"datasourceId\":2}": {
    reason: "With datasourceId, query is required (2.0.1 posted no query, and no datasource)",
    branch: {"requests": [], "errorClass": "Error"},
  },
  "datasources.introspectDatasource {\"datasourceId\":2}": {
    reason: "datasourceId is sent as datasource_id (2.0.1 ignored it and posted an empty body)",
    branch: {"requests": [{"method": "POST", "url": "/datasources/introspect", "data": {"datasource_id": 2}}], "result": {"data": {}}},
  },
  "storageconfigs.testStorageConfig {\"configId\":3}": {
    reason: "configId tests the saved config (2.0.1 ignored it and posted an empty body)",
    branch: {"requests": [{"method": "GET", "url": "/storage_configs/3"}, {"method": "POST", "url": "/storage_configs/test", "data": {"storage_config_id": 3}}], "result": {"data": {"success": true}}},
  },
  "teams.addTeamMembers {\"teamId\":1,\"userIds\":[\"2\"]}": {
    reason: "ID values are normalised to integers in bodies too (user_ids [2], was [\"2\"])",
    branch: {"requests": [{"method": "PUT", "url": "/teams/1/members/add", "data": {"user_ids": [2]}}], "result": {"data": {"teamId": 1, "addedUsers": 1}}},
  },
  "experiments.createAnnotation {\"experimentId\":\"5\",\"data\":{\"type\":\"x\"}}": {
    reason: "ID values are normalised to integers in bodies too (experiment_id 5, was \"5\")",
    branch: {"requests": [{"method": "POST", "url": "/experiment_annotations", "data": {"type": "x", "experiment_id": 5}}], "result": {"data": [{"id": 1, "name": "entity"}]}},
  },
};
// Every 2.0 call shape raised in review rounds 9-11, plus catalog-shaped ones.
export const PARITY_CALLS: Call[] = [
  { group: "experiments", command: "searchExperiments", params: { query: "checkout" } },
  { group: "experiments", command: "createExperimentNote", params: { experimentId: 1, note: "hi" } },
  { group: "favorites", command: "addFavorite", params: { type: "experiment", id: 5 } },
  { group: "goals", command: "updateGoal", params: { id: 5, description: "n" } },
  { group: "teams", command: "editTeamMemberRoles", params: { id: 1, userIds: [2], roleIds: [3] } },
  { group: "users", command: "deleteUserApiKey", params: { userRef: "5", keyId: 2 } },
  { group: "goals", command: "grantGoalAccessUser", params: { id: 5, userId: 3, roleId: 7 } },
  { group: "users", command: "createUser", params: { email: "a@b.c", name: "Ada Lovelace" } },
  { group: "users", command: "updateUser", params: { id: 5, name: "Ada Lovelace" } },
  { group: "experiments", command: "updateAnnotation", params: { annotationId: 3, type: "x" } },
  { group: "datasources", command: "testDatasource", params: { config: { type: "clickhouse", properties: { host: "h" } } } },
  { group: "datasources", command: "introspectDatasource", params: { config: { datasource_id: 2 } } },
  { group: "datasources", command: "validateDatasourceQuery", params: { config: { type: "clickhouse", properties: {}, query: "select 1" } } },
  { group: "storageconfigs", command: "testStorageConfig", params: { config: { type: "S3", properties: {} } } },
  { group: "platformconfig", command: "updatePlatformConfig", params: { id: 3, value: 5 } },
  { group: "platformconfig", command: "updatePlatformConfig", params: { configKey: 3, data: { value: 5 } } },
  { group: "metrics", command: "updateMetric", params: { metricId: 5, description: "x" } },
  { group: "metrics", command: "addMetricReviewComment", params: { metricId: 5, message: "m" } },
  { group: "experiments", command: "cloneExperiment", params: { experimentId: 5, name: "copy" } },
  { group: "experiments", command: "createAnnotation", params: { experimentId: 5, Data: { text: "x" } } },
  { group: "experiments", command: "updateExperiment", params: { experimentId: 5, changes: { name: "n" }, screenshotId: ["0:12"] } },
  { group: "experiments", command: "startExperiment", params: { experimentId: 5 } },
  { group: "goals", command: "getGoal", params: { goalId: 7 } },
  { group: "experiments", command: "bulkStop", params: { ids: [1, 2], reason: "testing" } },
  // Round 12 additions.
  { group: "datasources", command: "testDatasource", params: { datasourceId: 2, config: { datasource_id: 2 } } },
  { group: "datasources", command: "validateDatasourceQuery", params: { datasourceId: 2, query: "select 1", config: { type: "clickhouse", properties: {}, query: "select 1" } } },
  { group: "storageconfigs", command: "testStorageConfig", params: { configId: 3, config: { type: "S3", properties: { bucket: "b" } } } },
  { group: "goals", command: "grantGoalAccessUser", params: { goalId: 5, userId: 3 } },
  { group: "experiments", command: "revokeExperimentAccessUser", params: { experimentId: 5, userId: 3, role: "Editor" } },
  { group: "teams", command: "addTeamMembers", params: { teamId: 1, userIds: [], roleIds: [2] } },
  { group: "customsections", command: "reorderCustomSections", params: { ids: [] } },
  { group: "experiments", command: "bulkStart", params: { ids: [] } },
  { group: "events", command: "listEvents", params: { params: { from: 1 }, from: 2 } },
  { group: "events", command: "listEvents", params: { validExposures: null, from: 1 } },
  { group: "experiments", command: "listCustomFields", params: {} },
  { group: "experiments", command: "generateTemplate", params: {} },
  { group: "experiments", command: "createExperimentNote", params: { experimentId: 5, note: "x", userId: "ada@x.com" } },
  // Expected differences (see EXPECTED_DIFFERENCES).
  { group: "goals", command: "getGoal", params: { goalId: "1/../users" } },
  { group: "platformconfig", command: "getPlatformConfig", params: { id: null } },
  { group: "experiments", command: "startExperiment", params: { experimentId: null } },
  { group: "goals", command: "updateGoal", params: { data: { id: "abc", description: "x" } } },
  { group: "experiments", command: "startExperiment", params: {} },
  // Round 13 additions.
  { group: "goals", command: "getGoal", params: { goalId: 5, id: 6 } },
  { group: "goals", command: "grantGoalAccessUser", params: { goalId: 5, userId: 3, roleId: 7, role: "x" } },
  { group: "experiments", command: "grantExperimentAccessUser", params: { experimentId: 5, userId: 3, roleId: "Editor" } },
  { group: "datasources", command: "testDatasource", params: {} },
  { group: "datasources", command: "validateDatasourceQuery", params: { datasourceId: 2 } },
  { group: "datasources", command: "introspectDatasource", params: { datasourceId: 2 } },
  { group: "storageconfigs", command: "testStorageConfig", params: { configId: 3 } },
  { group: "teams", command: "addTeamMembers", params: { teamId: 1, userIds: ["2"] } },
  { group: "experiments", command: "createAnnotation", params: { experimentId: "5", data: { type: "x" } } },
];

const EXPERIMENT = {
  id: 5, name: "src", type: "test", state: "running", percentages: "50/50",
  variants: [{ variant: 0, name: "a", config: "{}" }, { variant: 1, name: "b", config: "{}" }],
};

function permissive(config: HttpRequestConfig): unknown {
  if (config.method === "GET" && /^\/experiments\/\d+$/.test(config.url)) return { experiment: EXPERIMENT };
  if (config.url.startsWith("/configs/")) return { config: { id: 3, name: "x", value: 1 } };
  const record = () => Object.assign([{ id: 1, name: "entity" }], { id: 1, name: "entity" });
  return new Proxy({}, { get: (_t, k) => (k === "then" || typeof k !== "string" ? undefined : k === "ok" ? true : record()) });
}

class Recorder implements HttpClient {
  requests: Recorded[] = [];
  getBaseUrl() { return "https://api.test/v1"; }
  async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    this.requests.push({ method: config.method, url: config.url, params: config.params, data: config.data });
    return { status: 200, data: permissive(config) as T, headers: {} };
  }
}

function stable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
}

async function run(execute: typeof executeBranch, call: Call): Promise<Outcome> {
  const http = new Recorder();
  let errorClass: string | undefined;
  let result: unknown;
  try {
    result = stable(await execute(new APIClient(http) as any, call.group, call.command, structuredClone(call.params)));
  } catch (e: any) {
    errorClass = e?.name ?? "Error";
  }
  return stable({ requests: http.requests, errorClass, result }) as Outcome;
}

const canonical = (o: Outcome) => JSON.stringify({ requests: o.requests, errorClass: o.errorClass, result: o.result ?? null });
function matchesExpectation(actual: Outcome, expected: { branch: Outcome; resultIncludes?: string[] }): boolean {
  if (!expected.resultIncludes) return canonical(actual) === canonical(expected.branch);
  const text = JSON.stringify(actual.result ?? null);
  return canonical({ ...actual, result: null }) === canonical({ ...expected.branch, result: null })
    && expected.resultIncludes.every((part) => text.includes(JSON.stringify(part).slice(1, -1)));
}

/** Thrown when the comparison ref is not in the repository (e.g. not fetched). */
export class RefUnavailableError extends Error {}

export async function compareWithRef(ref = REF) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: ROOT, stdio: "ignore" });
  } catch (e: any) {
    // Only git's own "no such commit" (a non-zero exit) means the ref is
    // missing; git not found (ENOENT), a signal or any other failure is fatal.
    if (typeof e?.status === "number" && e.status !== 0) {
      throw new RefUnavailableError(`git ref ${ref} is not available; fetch it (git fetch origin ${ref})`);
    }
    throw e;
  }
  // The whole src/ tree at the ref, so its cli-catalog.ts imports its own
  // siblings, whatever they are. It sits under ROOT so node_modules resolves.
  const dir = mkdtempSync(join(ROOT, ".parity-"));
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", ref, "src"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    const file = join(dir, "src", "cli-catalog.ts");
    const main = await import(file);
    const results: Array<{ call: Call; same: boolean; ok: boolean; expected?: string; main: unknown; branch: unknown }> = [];
    for (const call of PARITY_CALLS) {
      const [m, b] = [await run(main.executeCommand, call), await run(executeBranch, call)];
      const same = JSON.stringify(m) === JSON.stringify(b);
      const expectation = EXPECTED_DIFFERENCES[callKey(call)];
      // An expected difference must still differ, and the branch must produce
      // the stated outcome; anything else must be the same.
      const ok = expectation ? !same && matchesExpectation(b, expectation) : same;
      results.push({ call, same, ok, expected: expectation?.reason, main: m, branch: b });
    }
    return results;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // CI fetches exactly this ref (its checkout is shallow), so the SHA lives here only.
  if (ARGS.includes("--print-baseline")) {
    console.log(PARITY_BASELINE);
    process.exit(0);
  }
  const results = await compareWithRef();
  if (ARGS.includes("--print")) {
    for (const r of results.filter((x) => x.expected)) console.log(`${JSON.stringify(callKey(r.call))}: ${JSON.stringify(r.branch)},`);
    process.exit(0);
  }
  let bad = 0;
  for (const r of results) {
    const ok = r.ok;
    const tag = r.same ? (r.expected ? "STALE" : "same") : r.expected ? (r.ok ? "EXPECTED" : "WRONG") : "DIFFERENT";
    if (!ok) bad++;
    console.log(`${tag.padEnd(10)} ${callKey(r.call)}${r.expected ? `  (${r.expected})` : ""}`);
    if (!ok) console.log(`  main:   ${JSON.stringify(r.main)}\n  branch: ${JSON.stringify(r.branch)}`);
  }
  console.log(`\n${results.length} calls, ${bad} unexpected differences`);
  process.exit(bad === 0 ? 0 : 1);
}
