// Runs 2.0-style executeCommand calls through origin/main's cli-catalog and
// this branch's, over a recording HttpClient, and compares the requests. Only
// ID rejections (this branch refusing a call main sent) may differ.
// Usage: npx tsx scripts/parity-main.ts [git-ref]  (default origin/main)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APIClient } from "@absmartly/cli/api-client";
import type { HttpClient, HttpRequestConfig, HttpResponse } from "@absmartly/cli/api-client";
import { executeCommand as executeBranch } from "../src/cli-catalog.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.argv[2] ?? "origin/main";

type Call = { group: string; command: string; params: Record<string, unknown> };

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
  // ID rejections this branch adds (main sends these).
  { group: "goals", command: "getGoal", params: { goalId: "1/../users" } },
  { group: "platformconfig", command: "getPlatformConfig", params: { id: null } },
  { group: "experiments", command: "startExperiment", params: { experimentId: null } },
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

async function run(execute: typeof executeBranch, call: Call) {
  const http = new Recorder();
  let error: string | undefined;
  try {
    await execute(new APIClient(http) as any, call.group, call.command, structuredClone(call.params));
  } catch (e: any) {
    error = e?.message ?? String(e);
  }
  return { requests: http.requests, error };
}

export async function compareWithRef(ref = REF) {
  const dir = mkdtempSync(join(ROOT, ".parity-"));
  try {
    const source = execFileSync("git", ["show", `${ref}:src/cli-catalog.ts`], { cwd: ROOT, encoding: "utf-8" })
      .replace(/from "\.\/api-client-like\.js"/, `from "${join(ROOT, "src", "api-client-like.js")}"`);
    const file = join(dir, "cli-catalog.ts");
    writeFileSync(file, source);
    const main = await import(file);
    const results: Array<{ call: Call; same: boolean; idRejection: boolean; main: unknown; branch: unknown }> = [];
    for (const call of PARITY_CALLS) {
      const [m, b] = [await run(main.executeCommand, call), await run(executeBranch, call)];
      const same = JSON.stringify(m.requests) === JSON.stringify(b.requests);
      const idRejection = !same && b.requests.length === 0 && /must be a positive integer ID/.test(b.error ?? "");
      results.push({ call, same, idRejection, main: m, branch: b });
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
    const tag = r.same ? "same" : r.idRejection ? "ID-REJECTED" : "DIFFERENT";
    if (!r.same && !r.idRejection) bad++;
    console.log(`${tag.padEnd(12)} ${r.call.group}.${r.call.command} ${JSON.stringify(r.call.params)}`);
    if (!r.same && !r.idRejection) console.log(`  main:   ${JSON.stringify(r.main)}\n  branch: ${JSON.stringify(r.branch)}`);
  }
  console.log(`\n${results.length} calls, ${bad} unexpected differences`);
  process.exit(bad === 0 ? 0 : 1);
}
