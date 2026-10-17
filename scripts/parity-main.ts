// Runs 2.0-style executeCommand calls through origin/main's cli-catalog and
// this branch's, over a recording HttpClient, and compares the requests, the
// error (present or not, and its class) and the resolved value. A call may
// differ only if it is in EXPECTED_DIFFERENCES, with the reason.
// Usage: npx tsx scripts/parity-main.ts [git-ref]  (default origin/main)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APIClient } from "@absmartly/cli/api-client";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "@absmartly/cli/api-client";
import { executeCommand as executeBranch } from "../src/cli-catalog.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.argv[2] ?? "origin/main";

type Call = { group: string; command: string; params: Record<string, unknown> };

const callKey = (c: Call) => `${c.group}.${c.command} ${JSON.stringify(c.params)}`;

/**
 * Intentional differences from 2.0.1 for direct executeCommand callers, each
 * with its reason. Keep in step with CHANGELOG.md ("Behaviour changes for
 * direct executeCommand callers").
 */
type Outcome = { errorClass?: string; requests?: number };

/**
 * Intentional differences from 2.0.1 for direct executeCommand callers: the
 * reason, and the outcome this branch must produce (its error class, and how
 * many requests it sends), so a regression that differs in another way still
 * fails. Keep in step with CHANGELOG.md ("Behaviour changes for direct
 * executeCommand callers").
 */
export const EXPECTED_DIFFERENCES: Record<string, { reason: string; branch: Outcome }> = {
  'goals.getGoal {"goalId":"1/../users"}': { reason: "ID safety: a path ID must be a positive integer", branch: { errorClass: "IdParamError", requests: 0 } },
  'platformconfig.getPlatformConfig {"id":null}': { reason: "2.0.1 errored too; the message now names the invalid config", branch: { errorClass: "Error", requests: 0 } },
  'experiments.startExperiment {"experimentId":null}': { reason: "ID safety: null would become /experiments/null", branch: { errorClass: "IdParamError", requests: 0 } },
  'platformconfig.updatePlatformConfig {"id":3,"value":5}': { reason: "2.0.1 errored too (configKey missing); same failure, clearer message", branch: { errorClass: "Error", requests: 0 } },
  'goals.updateGoal {"data":{"id":"abc","description":"x"}}': { reason: "ID safety: an ID nested in data is checked at the path", branch: { errorClass: "PathIdError", requests: 0 } },
  'experiments.startExperiment {}': { reason: "ID safety: 2.0.1 sent GET /experiments/undefined", branch: { errorClass: "PathIdError", requests: 0 } },
  'experiments.revokeExperimentAccessUser {"experimentId":5,"userId":3,"role":"Editor"}': { reason: "2.0.1 sent DELETE .../3/undefined (core ignored role); role is now resolved by name (the recorder has no \"Editor\" role, so: not found)", branch: { errorClass: "Error", requests: 1 } },
  'experiments.listCustomFields {}': { reason: "Default type \"test\" (2.0.1 filtered on undefined and always returned none)", branch: { requests: 1 } },
  'experiments.generateTemplate {}': { reason: "Default name \"My Experiment\" (2.0.1 generated a template from name undefined, so \"my_experiment\")", branch: { requests: 3 } },
  'goals.getGoal {"goalId":5,"id":6}': { reason: "A declared alias that disagrees with its documented param is an error (2.0.1 silently used id)", branch: { errorClass: "IdParamError", requests: 0 } },
  'goals.grantGoalAccessUser {"goalId":5,"userId":3,"roleId":7,"role":"x"}': { reason: "roleId and role disagree: an error (2.0.1 ignored role and used roleId)", branch: { errorClass: "IdParamError", requests: 0 } },
  'experiments.grantExperimentAccessUser {"experimentId":5,"userId":3,"roleId":"Editor"}': { reason: "roleId is an asset role ID; a name belongs in role (2.0.1 sent asset_role_id \"Editor\")", branch: { errorClass: "IdParamError", requests: 0 } },
  'datasources.testDatasource {}': { reason: "Nothing to test: needs datasourceId or config (2.0.1 posted an empty body)", branch: { errorClass: "Error", requests: 0 } },
  'datasources.validateDatasourceQuery {"datasourceId":2}': { reason: "With datasourceId, query is required (2.0.1 posted no query, and no datasource)", branch: { errorClass: "Error", requests: 0 } },
  'datasources.introspectDatasource {"datasourceId":2}': { reason: "datasourceId is sent as datasource_id (2.0.1 ignored it and posted an empty body)", branch: { requests: 1 } },
  'storageconfigs.testStorageConfig {"configId":3}': { reason: "configId tests the saved config (2.0.1 ignored it and posted an empty body)", branch: { requests: 2 } },
  'teams.addTeamMembers {"teamId":1,"userIds":["2"]}': { reason: "ID values are normalised to integers in bodies too (user_ids [2], was [\"2\"])", branch: { requests: 1 } },
  'experiments.createAnnotation {"experimentId":"5","data":{"type":"x"}}': { reason: "ID values are normalised to integers in bodies too (experiment_id 5, was \"5\")", branch: { requests: 1 } },
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
  requests: unknown[] = [];
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

async function run(execute: typeof executeBranch, call: Call) {
  const http = new Recorder();
  let errorClass: string | undefined;
  let result: unknown;
  try {
    result = stable(await execute(new APIClient(http) as any, call.group, call.command, structuredClone(call.params)));
  } catch (e: any) {
    errorClass = e?.name ?? "Error";
  }
  return { requests: http.requests, errorClass, result };
}

/** Thrown when the comparison ref is not available (e.g. a shallow checkout). */
export class RefUnavailableError extends Error {}

export async function compareWithRef(ref = REF) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: ROOT, stdio: "ignore" });
  } catch {
    throw new RefUnavailableError(`git ref ${ref} is not available`);
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
      const ok = expectation
        ? !same
          && b.errorClass === expectation.branch.errorClass
          && (expectation.branch.requests === undefined || b.requests.length === expectation.branch.requests)
        : same;
      results.push({ call, same, ok, expected: expectation?.reason, main: m, branch: b });
    }
    return results;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await compareWithRef();
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
