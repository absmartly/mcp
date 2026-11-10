// CLI option parity: every option a CLI command passes on is reachable
// through execute_command. Each case runs executeCommand through the real
// @absmartly/cli core over a recording HttpClient and pins the requests,
// as the CLI command with the same options would send them.
import { readFileSync } from 'node:fs';
import { APIClient } from '@absmartly/cli/api-client';
import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { CLI_GROUPS, checkScreenshotSources, executeCommand, getCommandEntry, getGroupCommands, isDangerousCall } from '../../src/cli-catalog';
import { setupTools, type ToolContext } from '../../src/tools';
import { buildFixture, serializeFixture, FIXTURE_PATH } from '../../scripts/cli-option-parity';
import { FetchHttpClient } from '../../src/fetch-adapter';
import { missingFrom } from '../../scripts/peer-cli-check';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
import { withPathIdGuard } from '../../src/path-id-guard';

interface Recorded { method: string; url: string; params?: unknown; data?: unknown; headers?: unknown }

class Recorder implements HttpClient {
  requests: Recorded[] = [];
  constructor(private respond: (config: HttpRequestConfig) => unknown) {}
  getBaseUrl(): string { return 'https://api.test/v1'; }
  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const r: Recorded = { method: config.method, url: config.url };
    if (config.params !== undefined) r.params = config.params;
    if (config.data !== undefined) r.data = config.data;
    if (config.headers !== undefined) r.headers = config.headers;
    this.requests.push(r);
    return { status: 200, data: this.respond(config) as T, headers: {} };
  }
}

const EXPERIMENT = { id: 5, name: 'e', type: 'test', variants: [{ variant: 0, name: 'a', config: '{}' }, { variant: 1, name: 'b', config: '{}' }] };

/** A body every APIClient validator accepts: `key` is the list/entity, `ok` is true. */
function body(extra: Record<string, unknown> = {}): unknown {
  return new Proxy(extra, {
    get: (t, k) => (k in t ? t[k as string] : k === 'then' || typeof k !== 'string' ? undefined : k === 'ok' ? true : Object.assign([], { id: 1, name: 'x' })),
  });
}

interface Case {
  name: string;
  group: string;
  command: string;
  params: Record<string, unknown>;
  expected?: Recorded[];
  respond?: (config: HttpRequestConfig) => unknown;
  select?: (requests: Recorded[]) => Recorded[];
  expectedError?: string;
  result?: (value: any) => unknown;
  expectedResult?: unknown;
}

const SCREENSHOT_RULE = 'the source must be a data: URI (data:image/png;base64,...); the MCP server does not read file paths or fetch URLs. Reference an existing upload by its ID instead (screenshotId / screenshot_id)';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';
const TEMPLATE_WITH_SCREENSHOT = (source: string) =>
  `---\nname: e\ntype: test\n---\n\n## Variants\n\n### variant_0\n\nname: control\nconfig: {}\n![shot](${source})\n`;

const onlyMethod = (method: string) => (rs: Recorded[]) => rs.filter((r) => r.method === method);
const onlyUrl = (url: string) => (rs: Recorded[]) => rs.filter((r) => r.url === url);

const CASES: Case[] = [
  // ── generic list options (createListCommand) ───────────────────────────────
  { name: 'listGoals sends search/sort/asc/archived/ids like the CLI', group: 'goals', command: 'listGoals',
    params: { items: 10, page: 2, search: 'pay', sort: 'name', asc: true, archived: true, ids: '1,2' },
    respond: () => ({ goals: [{ id: 1, name: 'g' }] }),
    expected: [{ method: 'GET', url: '/goals', params: { items: '10', page: '2', search: 'pay', sort: 'name', sort_asc: 'true', archived: 'true', ids: '1,2' } }],
    result: (r) => r.rows?.length, expectedResult: 1 },
  { name: 'listGoals without list filters calls the core as before', group: 'goals', command: 'listGoals', params: { items: 10, page: 1 },
    respond: () => ({ goals: [] }),
    expected: [{ method: 'GET', url: '/goals', params: { items: '10', page: '1' } }] },
  { name: 'listApps desc maps to sort_asc false', group: 'apps', command: 'listApps', params: { items: 5, page: 1, sort: 'name', desc: true },
    respond: () => ({ applications: [] }),
    expected: [{ method: 'GET', url: '/applications', params: { items: '5', page: '1', sort: 'name', sort_asc: 'false' } }] },
  { name: 'listTeams includeArchived and search', group: 'teams', command: 'listTeams', params: { items: 5, page: 1, includeArchived: true, search: 'x' },
    respond: () => ({ teams: [] }),
    expected: [{ method: 'GET', url: '/teams', params: { include_archived: '1', items: '5', page: '1', search: 'x' } }] },
  { name: 'customfields.listCustomFields search', group: 'customfields', command: 'listCustomFields', params: { items: 5, page: 1, search: 'owner' },
    respond: () => ({ experiment_custom_section_fields: [] }),
    expected: [{ method: 'GET', url: '/experiment_custom_section_fields', params: { items: '5', page: '1', search: 'owner' } }] },

  // ── experiments list filters ──────────────────────────────────────────────
  { name: 'listExperiments sends the CLI filters, dates parsed, alerts as 0/1', group: 'experiments', command: 'listExperiments',
    params: { items: 20, page: 1, ids: '1,2', significance: 'positive', iterations: 2, analysisType: 'group_sequential', createdAfter: '1700000000000', alertSrm: true, alertCleanupNeeded: false, asc: true, sort: 'name' },
    respond: () => ({ experiments: [] }),
    select: onlyUrl('/experiments'),
    expected: [{ method: 'GET', url: '/experiments', params: {
      page: '1', items: '20', sort: 'name', sort_asc: 'true', previews: '1', ids: '1,2', iterations: '2', created_at: '1700000000000,',
      analysis_type: 'group_sequential', sample_ratio_mismatch: '1', cleanup_needed: '0', significance: 'positive',
    } }] },

  // ── get projection ────────────────────────────────────────────────────────
  { name: 'getGoal showOnly projects the summary', group: 'goals', command: 'getGoal', params: { goalId: 3, showOnly: ['id', 'name'] },
    respond: () => ({ goal: { id: 3, name: 'g', description: 'd' } }),
    result: (r) => r.data, expectedResult: { id: 3, name: 'g' } },
  { name: 'getGoal raw returns the API entity', group: 'goals', command: 'getGoal', params: { goalId: 3, raw: true },
    respond: () => ({ goal: { id: 3, name: 'g', description: 'd', extra: 1 } }),
    result: (r) => r.data.extra, expectedResult: 1 },

  // ── unarchive ─────────────────────────────────────────────────────────────
  { name: 'archiveApp unarchive', group: 'apps', command: 'archiveApp', params: { appId: 4, unarchive: true },
    expected: [{ method: 'PUT', url: '/applications/4/archive', data: { archive: false } }] },
  { name: 'archiveMetric unarchive', group: 'metrics', command: 'archiveMetric', params: { metricId: 4, unarchive: true },
    expected: [{ method: 'PUT', url: '/metrics/4/archive', data: { archive: false } }] },

  // ── experiments update/create/restart CLI fields ──────────────────────────
  { name: 'updateExperiment builds changes from CLI fields, with a note', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, displayName: 'New', percentages: '40,60', primaryMetric: 9, note: 'why' },
    respond: () => body({ experiment: EXPERIMENT }),
    // The APIClient merges the changes into the fetched experiment; pin the changed fields and the note.
    select: (rs) => onlyMethod('PUT')(rs).map(({ method, url, data }: any) => ({ method, url, data: { display_name: data.data.display_name, percentages: data.data.percentages, primary_metric: data.data.primary_metric, note: data.note } })),
    expected: [{ method: 'PUT', url: '/experiments/5', data: { display_name: 'New', percentages: '40/60', primary_metric: { metric_id: 9 }, note: 'why' } }] },
  { name: 'updateExperiment explicit changes win over CLI fields', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, displayName: 'Field', changes: { display_name: 'Explicit' } },
    respond: () => body({ experiment: EXPERIMENT }),
    select: (rs) => onlyMethod('PUT')(rs).map(({ method, url, data }: any) => ({ method, url, display_name: data.data.display_name })),
    expected: [{ method: 'PUT', url: '/experiments/5', display_name: 'Explicit' } as any] },
  { name: 'updateExperiment dryRun sends nothing', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, name: 'n', dryRun: true },
    respond: () => body({ experiment: EXPERIMENT }),
    select: onlyMethod('PUT'), expected: [],
    result: (r) => r.data, expectedResult: { dryRun: true, experimentId: 5, changes: { name: 'n' } } },
  { name: 'updateExperiment with nothing to change is an error, not an empty PUT', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, note: 'n' },
    expectedError: 'experiments.updateExperiment needs "changes" or at least one field to update (e.g. name, state, percentages)', expected: [] },
  { name: 'updateExperiment refuses a local screenshot path', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, screenshot: ['0:/etc/passwd'], dryRun: true },
    expectedError: `Screenshot "0:/etc/passwd": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'updateExperiment refuses an upper-case DATA: source (the resolver would read it as a file)', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, screenshot: ['0:DATA:probe'], dryRun: true },
    expectedError: `Screenshot "0:DATA:probe": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'createExperimentFromTemplate refuses an upper-case DATA: template screenshot', group: 'experiments', command: 'createExperimentFromTemplate',
    params: { templateContent: TEMPLATE_WITH_SCREENSHOT('DATA:image/png;base64,AAAA') },
    expectedError: `Screenshot for variant "control": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'updateExperiment refuses a screenshot URL (no server-side fetch)', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, screenshot: ['0:http://127.0.0.1:9/private'], dryRun: true },
    expectedError: `Screenshot "0:http://127.0.0.1:9/private": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'updateExperiment refuses a file screenshot inside templateContent', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, templateContent: TEMPLATE_WITH_SCREENSHOT('package.json'), dryRun: true },
    expectedError: `Screenshot for variant "control": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'restartExperiment refuses a URL screenshot inside templateContent', group: 'experiments', command: 'restartExperiment',
    params: { experimentId: 5, reason: 'testing', templateContent: TEMPLATE_WITH_SCREENSHOT('https://example.test/a.png'), dryRun: true },
    expectedError: `Screenshot for variant "control": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'cloneExperiment refuses a file screenshot in its template overrides', group: 'experiments', command: 'cloneExperiment',
    params: { experimentId: 5, name: 'c', templateContent: TEMPLATE_WITH_SCREENSHOT('/etc/hosts'), dryRun: true },
    expectedError: `Screenshot for variant "control": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'createExperimentFromTemplate refuses a file screenshot', group: 'experiments', command: 'createExperimentFromTemplate',
    params: { templateContent: TEMPLATE_WITH_SCREENSHOT('package.json') },
    expectedError: `Screenshot for variant "control": ${SCREENSHOT_RULE}`, expected: [] },
  { name: 'updateExperiment accepts a data: URI screenshot', group: 'experiments', command: 'updateExperiment',
    params: { experimentId: 5, screenshot: [`0:${PIXEL}`], dryRun: true },
    respond: () => body({ experiment: EXPERIMENT }),
    result: (r) => r.data.changes.variant_screenshots[0].file_upload.content_type, expectedResult: 'image/png' },
  { name: 'createExperimentFromOptions dryRun returns the built payload', group: 'experiments', command: 'createExperimentFromOptions',
    params: { name: 'exp', variants: 'control,treatment', percentages: '50,50', unitType: 1, applicationId: 2, dryRun: true },
    respond: () => body(),
    select: onlyMethod('POST'), expected: [],
    result: (r) => ({ name: r.data.payload.name, percentages: r.data.payload.percentages, unit: r.data.payload.unit_type, variants: r.data.payload.variants.length }),
    expectedResult: { name: 'exp', percentages: '50/50', unit: { unit_type_id: 1 }, variants: 2 } },
  { name: 'createExperimentFromOptions posts the payload', group: 'experiments', command: 'createExperimentFromOptions',
    params: { name: 'exp', unitType: 1, applicationId: 2 },
    respond: () => body({ experiment: { id: 77, name: 'exp', type: 'test' } }),
    select: (rs) => onlyMethod('POST')(rs).map(({ method, url }) => ({ method, url })),
    expected: [{ method: 'POST', url: '/experiments' }] },
  { name: 'restartExperiment dryRun validates and sends nothing', group: 'experiments', command: 'restartExperiment',
    params: { experimentId: 5, reason: 'testing', state: 'development', dryRun: true },
    respond: () => body({ experiment: EXPERIMENT }),
    select: onlyMethod('PUT'), expected: [] },
  { name: 'restartExperiment rejects an invalid reason (core validator)', group: 'experiments', command: 'restartExperiment',
    params: { experimentId: 5, reason: 'nope' },
    expectedError: 'Invalid reason: "nope"\nValid reasons: hypothesis_rejected, hypothesis_iteration, user_feedback, data_issue, implementation_issue, experiment_setup_issue, guardrail_metric_impact, secondary_metric_impact, operational_decision, performance_issue, testing, tracking_issue, code_cleaned_up, other',
    expected: [] },

  // ── scheduled actions, request update, diff ───────────────────────────────
  { name: 'createScheduledAction note and reason', group: 'experiments', command: 'createScheduledAction',
    params: { experimentId: 5, action: 'stop', scheduledAt: '2030-01-01T00:00:00.000Z', note: 'n', reason: 'testing' },
    expected: [{ method: 'POST', url: '/experiments/5/scheduled_action', data: { action: 'stop', scheduled_at: '2030-01-01T00:00:00.000Z', note: 'n', reason: 'testing' } }] },
  { name: 'requestUpdate replaceGsa', group: 'experiments', command: 'requestUpdate', params: { experimentId: 5, replaceGsa: true },
    expected: [{ method: 'POST', url: '/experiments/5/request_update', data: { params: { replaceGroupSequentialAnalysis: true } } }] },

  // ── bulk selection ────────────────────────────────────────────────────────
  { name: 'bulkStart selects by state and dryRun sends no starts', group: 'experiments', command: 'bulkStart',
    params: { state: 'ready', dryRun: true },
    respond: () => ({ experiments: [{ id: 11 }, { id: 12 }] }),
    expected: [{ method: 'GET', url: '/experiments', params: { state: 'ready' } }],
    result: (r) => r.data, expectedResult: { dryRun: true, action: 'bulkStart', ids: [11, 12] } },

  // ── metrics ───────────────────────────────────────────────────────────────
  { name: 'listMetrics client-side metricType filter scans and filters', group: 'metrics', command: 'listMetrics',
    params: { items: 10, page: 1, metricType: 'goal_ratio' },
    respond: () => ({ metrics: [{ id: 1, type: 'goal_ratio' }, { id: 2, type: 'goal_count' }] }),
    expected: [{ method: 'GET', url: '/metrics', params: { items: '200', page: '1' } }],
    result: (r) => r.data.map((m: any) => m.id), expectedResult: [1] },
  { name: 'listMetrics sort and ids reach the API', group: 'metrics', command: 'listMetrics',
    params: { items: 10, page: 1, sort: 'name', desc: true, ids: '3' },
    respond: () => ({ metrics: [] }),
    expected: [{ method: 'GET', url: '/metrics', params: { items: '10', page: '1', sort: 'name', sort_asc: 'false', ids: '3' } }] },
  { name: 'createMetric activate activates the new metric', group: 'metrics', command: 'createMetric',
    params: { data: { name: 'm', type: 'goal_count', description: 'd', goal_id: 3 }, activate: true },
    respond: () => ({ metric: { id: 40 } }),
    select: (rs) => rs.map(({ method, url }) => ({ method, url })),
    expected: [{ method: 'POST', url: '/metrics' }, { method: 'PUT', url: '/metrics/40/activate' }] },
  { name: 'listMetrics reports an incomplete scan at the page cap', group: 'metrics', command: 'listMetrics',
    params: { items: 20, page: 1, metricType: 'goal_ratio' },
    respond: () => ({ metrics: Array.from({ length: 200 }, (_, i) => ({ id: i, type: 'goal_count' })) }),
    result: (r) => ({ requests: undefined, pagination: r.pagination, warned: /were not filtered/.test(r.warnings?.[0] ?? '') }),
    expectedResult: { pagination: { page: 1, items: 20, hasMore: false, scanIncomplete: true, matchedInScan: 0 }, warned: true } },
  { name: 'createMetric keeps the created ID when activation fails', group: 'metrics', command: 'createMetric',
    params: { data: { name: 'm', type: 'goal_count', description: 'd', goal_id: 3 }, activate: true },
    respond: (c) => (c.method === 'POST' ? { metric: { id: 40 } } : { ok: false, errors: ['activation forbidden'] }),
    result: (r) => ({ id: r.data.id, activated: r.data.activated, warned: /created \(id 40\) but activation failed/.test(r.warnings[0]) }),
    expectedResult: { id: 40, activated: false, warned: true } },
  { name: 'createMetricVersion keeps the version ID when activation fails', group: 'metrics', command: 'createMetricVersion',
    params: { metricId: 8, reason: 'r', activate: true },
    respond: (c) => (c.method === 'POST' ? { metric: { id: 41 } } : { ok: false, errors: ['nope'] }),
    result: (r) => ({ id: r.data.id, activated: r.data.activated }), expectedResult: { id: 41, activated: false } },
  { name: 'createMetricVersion posts a version with a reason', group: 'metrics', command: 'createMetricVersion',
    params: { metricId: 8, reason: 'tweak', data: { format_str: '{}%' } },
    respond: () => ({ metric: { id: 41 } }),
    expected: [{ method: 'POST', url: '/metrics/8/version', data: { data: { format_str: '{}%' }, reason: 'tweak' } }] },
  { name: 'createMetric newVersion requires reason', group: 'metrics', command: 'createMetric',
    params: { data: { name: 'm' }, newVersion: 8 },
    expectedError: 'metrics.createMetric: "reason" is required with "newVersion"', expected: [] },

  // ── users ─────────────────────────────────────────────────────────────────
  { name: 'listUsers native search/sort/ids', group: 'users', command: 'listUsers', params: { items: 10, page: 1, search: 'ada', sort: 'email', asc: true, ids: '1' },
    respond: () => ({ users: [] }),
    expected: [{ method: 'GET', url: '/users', params: { items: '10', page: '1', search: 'ada', sort: 'email', sort_asc: 'true', ids: '1' } }] },
  { name: 'listUsers department filter scans all users and matches exactly', group: 'users', command: 'listUsers',
    params: { items: 10, page: 1, department: 'Eng' },
    respond: () => ({ users: [{ id: 1, department: 'Eng' }, { id: 2, department: 'Engineering' }] }),
    expected: [{ method: 'GET', url: '/users', params: { items: '200', page: '1' } }],
    result: (r) => r.data.map((u: any) => u.id), expectedResult: [1] },
  { name: 'listUsers contains matches substrings', group: 'users', command: 'listUsers',
    params: { department: 'eng', contains: true },
    respond: () => ({ users: [{ id: 1, department: 'Eng' }, { id: 2, department: 'Engineering' }, { id: 3, department: 'Sales' }] }),
    result: (r) => r.data.map((u: any) => u.id), expectedResult: [1, 2] },
  { name: 'createUser role resolves role names to the roles payload', group: 'users', command: 'createUser',
    params: { data: { email: 'a@b.c', first_name: 'A' }, role: 'Admin' },
    respond: (c) => (c.url === '/roles' ? { roles: [{ id: 3, name: 'Admin' }] } : { user: { id: 9 } }),
    select: onlyMethod('POST'),
    expected: [{ method: 'POST', url: '/users', data: { email: 'a@b.c', first_name: 'A', roles: [{ role_id: 3 }] } }] },
  { name: 'getUserApiKey maps userId', group: 'users', command: 'getUserApiKey', params: { userId: 7, keyId: 2 },
    respond: () => ({ user_api_key: { id: 2 } }),
    expected: [{ method: 'GET', url: '/users/7/api_keys/2' }] },
  { name: 'updateUserApiKey flattens data', group: 'users', command: 'updateUserApiKey', params: { userId: 7, keyId: 2, data: { name: 'n' } },
    expected: [{ method: 'PUT', url: '/users/7/api_keys/2', data: { data: { name: 'n' } } }] },

  // ── teams, notifications, auth, export configs ────────────────────────────
  { name: 'addTeamMembers roleIds', group: 'teams', command: 'addTeamMembers', params: { teamId: 1, userIds: [2], roleIds: ['3'] },
    expected: [{ method: 'PUT', url: '/teams/1/members/add', data: { user_ids: [2], role_ids: [3] } }] },
  { name: 'listNotifications cursor and limit', group: 'notifications', command: 'listNotifications', params: { cursor: 5, limit: 3 },
    respond: () => ({ notifications: [] }),
    select: (rs) => rs.map(({ method, url, params }) => ({ method, url, params })),
    expected: [{ method: 'GET', url: '/notifications/summary', params: { cursor: 5 } }] },
  { name: 'listNotifications applies limit to the returned notifications', group: 'notifications', command: 'listNotifications', params: { limit: 2 },
    respond: () => ({ notifications: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    result: (r) => r.data.map((n: any) => n.id), expectedResult: [1, 2] },
  { name: 'markNotificationsRead ids', group: 'notifications', command: 'markNotificationsRead', params: { ids: [4, 5] },
    expected: [{ method: 'PUT', url: '/notifications/read', data: { ids: [4, 5] } }] },
  { name: 'editProfile', group: 'auth', command: 'editProfile', params: { firstName: 'A', jobTitle: 'J' },
    respond: () => ({ user: { id: 1 } }),
    expected: [{ method: 'PUT', url: 'https://api.test/auth/current-user', data: { data: { first_name: 'A', job_title: 'J' } } }] },
  { name: 'cancelExportHistory', group: 'exportconfigs', command: 'cancelExportHistory', params: { configId: 3, historyId: 4, reason: 'r' },
    expected: [{ method: 'PUT', url: '/export_configs/3/export_histories/4/cancel', data: { reason: 'r' } }] },
  { name: 'listExportConfigs statuses', group: 'exportconfigs', command: 'listExportConfigs', params: { statuses: 'COMPLETED', items: 5, page: 1 },
    respond: () => ({ export_configs: [] }),
    expected: [{ method: 'GET', url: '/export_configs', params: { statuses: 'COMPLETED', items: '5', page: '1' } }] },

  // ── datasources ───────────────────────────────────────────────────────────
  { name: 'previewDatasourceQuery builds the body from id, query and limit', group: 'datasources', command: 'previewDatasourceQuery',
    params: { datasourceId: 2, query: 'select 1', limit: 10 },
    respond: () => ({ columnNames: ['a'], rows: [[1]] }),
    expected: [{ method: 'POST', url: '/datasources/preview_query', data: { datasource_id: 2, query: 'select 1', limit: 10 } }],
    result: (r) => r.data, expectedResult: [{ a: 1 }] },
  { name: 'deleteDatasource', group: 'datasources', command: 'deleteDatasource', params: { datasourceId: 2 },
    expected: [{ method: 'DELETE', url: '/datasources/2' }] },
  { name: 'setDefaultDatasource', group: 'datasources', command: 'setDefaultDatasource', params: { datasourceId: 2 },
    expected: [{ method: 'PUT', url: '/datasources/2/set_default' }] },
  { name: 'archiveDatasource unarchive', group: 'datasources', command: 'archiveDatasource', params: { datasourceId: 2, unarchive: true },
    expected: [{ method: 'PUT', url: '/datasources/2/archive', data: { archive: false } }] },

  // ── statistics and events ─────────────────────────────────────────────────
  { name: 'getPowerMatrix builds the config from CLI flags', group: 'statistics', command: 'getPowerMatrix',
    params: { analysisType: 'fixed_horizon', metricMean: 0.1, alpha: 0.05, powers: [0.8], twoSided: true, participants: '100/day' },
    expected: [{ method: 'POST', url: '/statistics/power/plan/matrix', data: { analysis_type: 'fixed_horizon', metric_mean: 0.1, alpha: 0.05, powers: [0.8], two_sided: true, participants_per_week: 700 } }] },
  { name: 'getPowerMatrix params is still the whole config', group: 'statistics', command: 'getPowerMatrix', params: { params: { alpha: 0.1 } },
    expected: [{ method: 'POST', url: '/statistics/power/plan/matrix', data: { alpha: 0.1 } }] },
  { name: 'getEventJsonLayouts topLevel filters paths client-side', group: 'events', command: 'getEventJsonLayouts',
    params: { source: 'unit_attribute', phase: 'after_enrichment', topLevel: true },
    respond: () => ({ columnNames: ['key'], rows: [['a'], ['a/b']] }),
    result: (r) => r.data.rows, expectedResult: [['a']] },
  { name: 'getEventUnitData parses units', group: 'events', command: 'getEventUnitData', params: { units: ['1:abc'] },
    expected: [{ method: 'POST', url: '/events/unit_data', data: { units: [{ unit_type_id: 1, uid: 'abc' }] } }] },
  { name: 'getEventsSummary rolls up by period', group: 'events', command: 'getEventsSummary',
    params: { from: '1767225600000', to: '1767398400000', period: 'month' },
    // Midday UTC: the same calendar month in every time zone (bucketStart uses local time).
    respond: () => ({ teams: [{ id: 1, name: 'T' }], events: [{ date: 1767268800000, team_id: 1, count: 2, type: 'goal' }, { date: 1767355200000, team_id: 1, count: 3, type: 'exposure' }] }),
    expected: [{ method: 'GET', url: '/events/summary', params: { from: 1767225600000, to: 1767398400000 } }],
    result: (r) => r.data.rows.map((x: any) => x.total), expectedResult: [5] },
  { name: 'getEventsSummary refuses a range over 100 days', group: 'events', command: 'getEventsSummary',
    params: { from: '1', to: String(1 + 101 * 86_400_000) },
    expectedError: 'Date range too large - maximum is 100 days', expected: [] },

  // ── new experiment commands ───────────────────────────────────────────────
  { name: 'getMetricDeps', group: 'experiments', command: 'getMetricDeps', params: { metricId: 7 },
    respond: () => ({ metrics: [{ id: 7, usage: {} }] }),
    expected: [{ method: 'GET', url: '/metrics/usages' }] },
  { name: 'getExportStatus', group: 'experiments', command: 'getExportStatus', params: { exportConfigId: 3 },
    respond: (c) => (c.url.endsWith('/export_histories') ? { export_histories: [] } : { export_config: { id: 3 } }),
    select: (rs) => rs.map(({ method, url }) => ({ method, url })),
    expected: [{ method: 'GET', url: '/export_configs/3' }, { method: 'GET', url: '/export_configs/3/export_histories' }] },

  // ── api.rawRequest (abs api) ──────────────────────────────────────────────
  { name: 'rawRequest GET with a query in the path (the reported endpoint)', group: 'api', command: 'rawRequest',
    params: { path: '/experiments/99/metrics/main?use_cache=1' },
    respond: () => ({ columnNames: [], rows: [] }),
    expected: [{ method: 'GET', url: '/experiments/99/metrics/main?use_cache=1' }],
    result: (r) => r.data, expectedResult: { columnNames: [], rows: [] } },
  { name: 'rawRequest query object is appended, surviving rawRequest decoding', group: 'api', command: 'rawRequest',
    params: { path: '/experiments/99/metrics/main', query: { use_cache: 1, q: 'a&b' } },
    expected: [{ method: 'GET', url: '/experiments/99/metrics/main?use_cache=1&q=a%26b' }] },
  { name: 'rawRequest POST with body and headers', group: 'api', command: 'rawRequest',
    params: { path: '/goals', method: 'post', body: { name: 'g' }, headers: { 'X-Test': '1' } },
    expected: [{ method: 'POST', url: '/goals', data: { name: 'g' }, headers: { 'X-Test': '1' } }] },
  { name: 'rawRequest refuses path traversal', group: 'api', command: 'rawRequest', params: { path: '/experiments/../users' },
    expectedError: 'Invalid path argument "/experiments/../users" for rawRequest: a request path must start with "/" and hold no dot segment (plain or encoded), backslash, fragment or encoded separator.', expected: [] },
  { name: 'rawRequest refuses an absolute URL', group: 'api', command: 'rawRequest', params: { path: 'https://evil.test/x' },
    expectedError: 'Invalid path argument "https://evil.test/x" for rawRequest: a request path must start with "/" and hold no dot segment (plain or encoded), backslash, fragment or encoded separator.', expected: [] },
  { name: 'rawRequest refuses an unsupported method (CLI rule)', group: 'api', command: 'rawRequest', params: { path: '/goals', method: 'PATCH' },
    expectedError: 'Unsupported HTTP method: PATCH. Allowed: GET, POST, PUT, DELETE', expected: [] },
];

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function check(ok: boolean, name: string, error = 'Assertion failed') {
    if (ok) { passed++; details.push({ name, status: 'PASS' }); } else { failed++; details.push({ name, status: 'FAIL', error }); }
  }
  function eq(actual: unknown, expected: unknown, name: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    check(a === b, name, `Expected ${b}, got ${a}`);
  }

  for (const c of CASES) {
    const http = new Recorder(c.respond ?? (() => body()));
    let error: string | undefined;
    let value: unknown;
    try {
      value = await executeCommand(new APIClient(http) as any, c.group, c.command, structuredClone(c.params));
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    const label = `${c.group}.${c.command}: ${c.name}`;
    eq(error, c.expectedError, `${label} (error)`);
    if (c.expected) eq(c.select ? c.select(http.requests) : http.requests, c.expected, `${label} (requests)`);
    if (c.result && error === undefined) eq(c.result(value), c.expectedResult, `${label} (result)`);
  }

  // Every option of the CLI command a catalog command mirrors is documented
  // (tests/fixtures/cli-command-options.json is generated from the installed
  // CLI's commander tree; options that only affect terminal output or local
  // files are listed with the reason they do not apply).
  const committed = readFileSync(FIXTURE_PATH, 'utf-8');
  check(committed === serializeFixture(await buildFixture()), 'tests/fixtures/cli-command-options.json is current (maps every option of the installed CLI)',
    'stale: run npx tsx scripts/cli-option-parity.ts');
  const fixture = JSON.parse(committed) as {
    commands: Record<string, { mcp: string | null; options: Record<string, string | null> }>;
  };
  for (const [cli, spec] of Object.entries(fixture.commands)) {
    if (spec.mcp === null) continue;
    const [group, command] = spec.mcp.split('.');
    const entry = getCommandEntry(group, command);
    check(entry !== undefined, `CLI "${cli}" maps to an existing command (${spec.mcp})`);
    if (!entry) continue;
    const names = new Set(entry.params.map((p) => p.name));
    for (const [option, param] of Object.entries(spec.options)) {
      if (param === null) continue;
      check(names.has(param), `CLI "${cli} --${option}" is ${spec.mcp} param "${param}"`, `documented: ${[...names].join(', ')}`);
    }
  }

  const raw = getCommandEntry('api', 'rawRequest')!;
  eq([undefined, 'GET', 'get', 'POST', 'put', 'DELETE'].map((method) => isDangerousCall(raw, method === undefined ? {} : { method })),
    [false, false, false, true, true, true], 'api.rawRequest: only non-GET methods need confirmation');
  // Every source the guard accepts must be one the CLI resolver treats as a data URI, never as a path.
  for (const source of ['data:image/png;base64,AAAA', 'DATA:x', 'Data:x', ' data:x', '/etc/hosts', 'https://h/x', 'package.json']) {
    let accepted = true;
    try { checkScreenshotSources({ screenshot: [`0:${source}`] }); } catch { accepted = false; }
    check(accepted === source.startsWith('data:'), `screenshot guard agrees with the resolver for ${JSON.stringify(source)}`);
  }
  // The pinned CLI has every core function and APIClient method the catalog calls (CI checks the peer minimum the same way).
  eq(await missingFrom(join(dirname(require.resolve('@absmartly/cli/api-client')), '..', '..')), [], 'the installed CLI provides every core function and APIClient method the catalog calls');
  const stop = getCommandEntry('experiments', 'bulkStop')!;
  eq([isDangerousCall(stop, { ids: [1] }), isDangerousCall(stop, { state: 'running', dryRun: true }), isDangerousCall(getCommandEntry('experiments', 'stopExperiment')!, { dryRun: true })],
    [true, false, true], 'dryRun skips confirmation only on commands that document it');
  check(CLI_GROUPS.includes('api') && getGroupCommands('api').length === 1, 'the api group has exactly rawRequest');

  {
    const http = new Recorder(() => body());
    const tools = new Map<string, Function>();
    const ctx: ToolContext = { apiClient: new APIClient(http) as any, endpoint: 'https://api.test', authType: 'api-key', entityWarnings: [], customFields: [], currentUserId: null };
    setupTools({ tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Function) => tools.set(name, handler) } as any, ctx);
    const exec = tools.get('execute_command')!;
    const post = await exec({ group: 'api', command: 'rawRequest', params: { path: '/goals', method: 'POST', body: { name: 'g' } } });
    check(/destructive action/i.test(post.content[0].text) && http.requests.length === 0, 'execute_command asks for confirmation before a raw POST', post.content[0].text);
    const confirmed = await exec({ group: 'api', command: 'rawRequest', params: { path: '/goals', method: 'POST', body: { name: 'g' } }, confirmed: true });
    check(http.requests.length === 1 && http.requests[0].method === 'POST', 'a confirmed raw POST is sent', confirmed.content[0].text);
    const get = await exec({ group: 'api', command: 'rawRequest', params: { path: '/experiments/99/metrics/main?use_cache=1' } });
    check(http.requests.length === 2 && http.requests[1].url === '/experiments/99/metrics/main?use_cache=1', 'a raw GET runs without confirmation', get.content[0].text);
    const preview = await exec({ group: 'experiments', command: 'createExperimentFromTemplate', params: { templateContent: TEMPLATE_WITH_SCREENSHOT('package.json') } });
    check(preview.content[0].text.includes(SCREENSHOT_RULE) && !preview.content[0].text.includes('file_upload') && http.requests.length === 2,
      'the template preview refuses a file screenshot before resolving it', preview.content[0].text);
  }

  // End to end over the real FetchHttpClient: the reported endpoint reaches
  // <base>/v1 with the session credential, which a caller header cannot replace.
  {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; method: string; auth: string | null }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), method: String(init.method), auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ columnNames: [], rows: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const client = withPathIdGuard(new APIClient(new FetchHttpClient('https://tenant.absmartly.test', { authToken: 'k', authType: 'api-key' })));
      await executeCommand(client as any, 'api', 'rawRequest', { path: '/experiments/99/metrics/main?use_cache=1', headers: { Authorization: 'Api-Key stolen' } });
      eq(seen, [{ url: 'https://tenant.absmartly.test/v1/experiments/99/metrics/main?use_cache=1', method: 'GET', auth: 'Api-Key k' }],
        'api.rawRequest over FetchHttpClient: /v1 path, session credential kept');
      let error = '';
      try { await executeCommand(client as any, 'api', 'rawRequest', { path: '/%2e%2e/auth/current-user' }); } catch (e: any) { error = e.message; }
      check(error.startsWith('Invalid path argument') && seen.length === 1, 'api.rawRequest refuses an encoded dot segment before fetch', error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
