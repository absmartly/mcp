// Runs catalog commands through the real @absmartly/cli core over a fake
// HttpClient, and guards the whole catalog with scripts/audit-catalog-params.ts.
import { APIClient } from '@absmartly/cli/api-client';
import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { CLI_GROUPS, documentedParams, executeCommand, getCommandEntry, getGroupCommands, validateCommandParams } from '../../src/cli-catalog';
import { auditCatalogParams } from '../../scripts/audit-catalog-params';

const BASE_URL = 'https://api.test/v1';
const ROOT_URL = 'https://api.test';

interface RecordedRequest {
  method: string;
  url: string;
  params?: unknown;
  data?: unknown;
}

// Any entity key resolves to a record that is also a one-element array, so
// both validateEntityResponse and validateListResponse accept it.
function permissiveBody(): Record<string, unknown> {
  const record = () => Object.assign([{ id: 1, name: 'entity' }], { id: 1, name: 'entity', key: 'k' });
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' || typeof prop !== 'string' ? undefined : prop === 'ok' ? true : record()),
  });
}

class FakeHttpClient implements HttpClient {
  requests: RecordedRequest[] = [];
  constructor(private respond: (config: HttpRequestConfig) => unknown = () => permissiveBody()) {}
  getBaseUrl(): string { return BASE_URL; }
  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const recorded: RecordedRequest = { method: config.method, url: config.url };
    if (config.params !== undefined) recorded.params = config.params;
    if (config.data !== undefined) recorded.data = config.data;
    this.requests.push(recorded);
    return { status: 200, data: this.respond(config) as T, headers: {} };
  }
}

interface Case {
  name: string;
  group: string;
  command: string;
  params: Record<string, unknown>;
  expected: RecordedRequest[];
  respond?: (config: HttpRequestConfig) => unknown;
  /** The error executeCommand must throw, when the call is expected to fail. */
  expectedError?: string;
  /** Like expectedError, for messages with a long variable tail. */
  expectedErrorPrefix?: string;
  /** Narrows the recorded requests before comparing, for bodies with incidental fields. */
  select?: (requests: RecordedRequest[]) => RecordedRequest[];
}

const CASES: Case[] = [
  // ── auth (originally reported) ────────────────────────────────────────────
  { name: 'getAuthApiKey maps keyId to the URL id', group: 'auth', command: 'getAuthApiKey', params: { keyId: 42 },
    expected: [{ method: 'GET', url: `${ROOT_URL}/auth/current-user/api_keys/42` }] },
  { name: 'createAuthApiKey flattens data', group: 'auth', command: 'createAuthApiKey', params: { data: { name: 'ci', description: 'CI key' } },
    expected: [{ method: 'POST', url: `${ROOT_URL}/auth/current-user/api_keys`, data: { name: 'ci', description: 'CI key' } }] },
  { name: 'updateAuthApiKey maps keyId and flattens data', group: 'auth', command: 'updateAuthApiKey', params: { keyId: 42, data: { name: 'renamed', description: 'd' } },
    expected: [{ method: 'PUT', url: `${ROOT_URL}/auth/current-user/api_keys/42`, data: { data: { name: 'renamed', description: 'd' } } }] },
  { name: 'deleteAuthApiKey maps keyId', group: 'auth', command: 'deleteAuthApiKey', params: { keyId: 42 },
    expected: [{ method: 'DELETE', url: `${ROOT_URL}/auth/current-user/api_keys/42` }] },

  // ── users (originally reported) ───────────────────────────────────────────
  { name: 'createUser sends data verbatim, keeping multi-word first names', group: 'users', command: 'createUser',
    params: { data: { email: 'mj@example.com', first_name: 'Mary Jane', last_name: 'Watson', job_title: 'Editor' } },
    expected: [{ method: 'POST', url: '/users', data: { email: 'mj@example.com', first_name: 'Mary Jane', last_name: 'Watson', job_title: 'Editor' } }] },
  { name: 'updateUser maps userId and sends a partial update without touching the other name half', group: 'users', command: 'updateUser',
    params: { userId: 7, data: { last_name: 'Hopper' } },
    expected: [{ method: 'PUT', url: '/users/7', data: { data: { last_name: 'Hopper' } } }] },
  { name: 'getUser maps userId', group: 'users', command: 'getUser', params: { userId: 7 },
    expected: [{ method: 'GET', url: '/users/7' }] },
  { name: 'archiveUser maps userId', group: 'users', command: 'archiveUser', params: { userId: 7 },
    expected: [{ method: 'PUT', url: '/users/7/archive', data: { archive: true } }] },
  { name: 'resetUserPassword maps userId', group: 'users', command: 'resetUserPassword', params: { userId: 7 },
    expected: [{ method: 'PUT', url: '/users/7/reset-password' }] },
  { name: 'listUserApiKeys maps userId to userRef', group: 'users', command: 'listUserApiKeys', params: { userId: 7, items: 10, page: 1 },
    expected: [{ method: 'GET', url: '/users/7/api_keys', params: { items: '10', page: '1' } }] },
  { name: 'createUserApiKey maps userId and flattens data', group: 'users', command: 'createUserApiKey',
    params: { userId: 7, data: { name: 'bot', description: 'Bot key' } },
    expected: [{ method: 'POST', url: '/users/7/api_keys', data: { name: 'bot', description: 'Bot key' } }] },
  { name: 'deleteUserApiKey maps userId', group: 'users', command: 'deleteUserApiKey', params: { userId: 7, keyId: 9 },
    expected: [{ method: 'DELETE', url: '/users/7/api_keys/9' }] },

  // ── experiments ───────────────────────────────────────────────────────────
  { name: 'createExperiment posts data as the body', group: 'experiments', command: 'createExperiment',
    params: { data: { name: 'exp', type: 'test' }, apiEndpoint: 'https://ignored' },
    expected: [{ method: 'POST', url: '/experiments', data: { name: 'exp', type: 'test' } }] },
  { name: 'searchExperiments maps search/items to query/limit', group: 'experiments', command: 'searchExperiments',
    params: { search: 'checkout', items: 5 },
    expected: [{ method: 'GET', url: '/experiments', params: { items: '5', search: 'checkout' } }] },
  { name: 'restartExperiment maps type to asType', group: 'experiments', command: 'restartExperiment',
    params: { experimentId: 3, reason: 'testing', type: 'feature', note: 'go' },
    // The restart body also carries the full fetched experiment; pin the options only.
    select: (requests) => requests.map(({ method, url, data }) => {
      const { note, reason, restart_as_type } = (data ?? {}) as Record<string, unknown>;
      return data === undefined ? { method, url } : { method, url, data: { note, reason, restart_as_type } };
    }),
    expected: [
      { method: 'GET', url: '/experiments/3' },
      { method: 'PUT', url: '/experiments/3/restart', data: { note: 'go', reason: 'testing', restart_as_type: 'feature' } },
    ] },
  { name: 'createExperimentNote maps text to note', group: 'experiments', command: 'createExperimentNote',
    params: { experimentId: 3, text: 'hello' },
    expected: [{ method: 'POST', url: '/experiments/3/activity', data: { note: 'hello' } }] },
  { name: 'editExperimentNote maps text to note', group: 'experiments', command: 'editExperimentNote',
    params: { experimentId: 3, noteId: 8, text: 'edited' },
    expected: [{ method: 'PUT', url: '/experiments/3/activity/8', data: { note: 'edited' } }] },
  { name: 'replyToExperimentNote maps text to note', group: 'experiments', command: 'replyToExperimentNote',
    params: { experimentId: 3, noteId: 8, text: 'reply' },
    expected: [{ method: 'POST', url: '/experiments/3/activity/8/reply', data: { note: 'reply' } }] },
  { name: 'addExperimentMetrics maps metrics[].metric_id to metricIds', group: 'experiments', command: 'addExperimentMetrics',
    params: { experimentId: 3, metrics: [{ metric_id: 5, type: 'secondary' }, { metric_id: 6 }] },
    expected: [{ method: 'POST', url: '/experiments/3/metrics', data: { metric_ids: [5, 6] } }] },
  { name: 'createScheduledAction maps scheduledAt to at', group: 'experiments', command: 'createScheduledAction',
    params: { experimentId: 3, action: 'stop', scheduledAt: '2030-01-01T00:00:00.000Z' },
    expected: [{ method: 'POST', url: '/experiments/3/scheduled_action', data: { action: 'stop', scheduled_at: '2030-01-01T00:00:00.000Z', note: 'Scheduled via CLI' } }] },
  { name: 'grantExperimentAccessUser maps role to roleId', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 4 },
    expected: [{ method: 'POST', url: '/experiments/3/asset_role_users', data: { user_id: 2, asset_role_id: 4 } }] },
  { name: 'grantExperimentAccessTeam maps a numeric role string to roleId', group: 'experiments', command: 'grantExperimentAccessTeam',
    params: { experimentId: 3, teamId: 2, role: '4' },
    expected: [{ method: 'POST', url: '/experiments/3/asset_role_teams', data: { team_id: 2, asset_role_id: 4 } }] },
  { name: 'grantExperimentAccessUser resolves a role name to its asset role id', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'editor' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 1, name: 'Viewer' }, { id: 5, name: 'Editor' }] } : {}),
    expected: [
      { method: 'GET', url: '/asset_roles', params: { items: '100', page: '1' } },
      { method: 'POST', url: '/experiments/3/asset_role_users', data: { user_id: 2, asset_role_id: 5 } },
    ] },
  { name: 'grantExperimentAccessUser finds a role name past the first page', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'Late' },
    respond: (config) => {
      if (config.url !== '/asset_roles') return {};
      const page = Number(config.params?.page);
      const roles = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Role ${i + 1}` })) : [{ id: 777, name: 'Late' }];
      return { asset_roles: roles };
    },
    select: (requests) => requests.map(({ method, url, params, data }) => ({ method, url, ...(params ? { params } : {}), ...(data ? { data } : {}) })),
    expected: [
      { method: 'GET', url: '/asset_roles', params: { items: '100', page: '1' } },
      { method: 'GET', url: '/asset_roles', params: { items: '100', page: '2' } },
      { method: 'POST', url: '/experiments/3/asset_role_users', data: { user_id: 2, asset_role_id: 777 } },
    ] },
  // Pre-1.16 cores drop { items, page } and return every role on each call
  // (simulated by a server that ignores the paging params).
  { name: 'role lookup makes one request when paging is ignored and the list exceeds a page', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'Role 150' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: Array.from({ length: 150 }, (_, i) => ({ id: i + 1, name: `Role ${i + 1}` })) } : {}),
    select: (requests) => requests.map(({ method, url, data }) => ({ method, url, ...(data ? { data } : {}) })),
    expected: [
      { method: 'GET', url: '/asset_roles' },
      { method: 'POST', url: '/experiments/3/asset_role_users', data: { user_id: 2, asset_role_id: 150 } },
    ] },
  { name: 'role lookup stops on a repeated page when paging is ignored and the list is exactly one page', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'Missing' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Role ${i + 1}` })) } : {}),
    select: (requests) => requests.map(({ method, url }) => ({ method, url })),
    expectedErrorPrefix: 'Asset role "Missing" not found',
    expected: [{ method: 'GET', url: '/asset_roles' }, { method: 'GET', url: '/asset_roles' }] },
  { name: 'listUserApiKeys resolves an email userId', group: 'users', command: 'listUserApiKeys', params: { userId: 'jane@example.com' },
    respond: (config) => (config.url === '/users' ? { users: [{ id: 42, email: 'jane@example.com' }] } : { user_api_keys: [] }),
    select: (requests) => requests.filter((r) => r.url.includes('/api_keys')).map(({ method, url }) => ({ method, url })),
    expected: [{ method: 'GET', url: '/users/42/api_keys' }] },
  { name: 'listEvents treats params: null as no filters', group: 'events', command: 'listEvents', params: { params: null },
    // take: 100 is the core's default page size (@absmartly/cli >= 1.16).
    expected: [{ method: 'POST', url: '/events', data: { take: 100 } }] },
  { name: 'grantExperimentAccessUser does not put role 1.5 into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: '1.5' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "1.5" not found', expected: [] },
  { name: 'grantExperimentAccessUser does not put role -3 into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: '-3' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "-3" not found', expected: [] },
  { name: 'grantExperimentAccessUser does not put role Infinity into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'Infinity' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "Infinity" not found', expected: [] },
  { name: 'grantExperimentAccessUser does not put role 1e3 into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: '1e3' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "1e3" not found', expected: [] },
  { name: 'grantExperimentAccessUser does not put role 0x10 into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: '0x10' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "0x10" not found', expected: [] },
  { name: 'grantExperimentAccessUser does not put role 0 into a path', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: '0' },
    respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 5, name: 'Editor' }] } : {}),
    select: (requests) => requests.filter((r) => r.method !== 'GET'),
    expectedErrorPrefix: 'Asset role "0" not found', expected: [] },
  { name: 'getPlatformConfig resolves a non-integer configKey by name, never as an ID', group: 'platformconfig', command: 'getPlatformConfig',
    params: { configKey: '1e3' },
    respond: (config) => (config.url === '/configs' ? { configs: [{ id: 1000, name: 'other' }] } : { config: {} }),
    expectedError: 'Platform config "1e3" not found', expected: [{ method: 'GET', url: '/configs' }] },
  { name: 'bulkStart rejects non-integer ids before any request', group: 'experiments', command: 'bulkStart', params: { ids: [1, '2.5'] },
    expectedError: 'experiments.bulkStart: "ids" must be positive integer experiment IDs', expected: [] },
  { name: 'grantExperimentAccessUser without role fails before any request', group: 'experiments', command: 'grantExperimentAccessUser',
    params: { experimentId: 3, userId: 2 },
    expectedError: 'experiments.grantExperimentAccessUser requires "role" (an asset role ID or name)', expected: [] },
  { name: 'createAnnotation sends the whole annotation data', group: 'experiments', command: 'createAnnotation',
    params: { experimentId: 3, data: { type: 'deploy', text: 'Shipped v2' } },
    expected: [{ method: 'POST', url: '/experiment_annotations', data: { type: 'deploy', text: 'Shipped v2', experiment_id: 3 } }] },
  { name: 'updateAnnotation sends the whole annotation data', group: 'experiments', command: 'updateAnnotation',
    params: { experimentId: 3, annotationId: 4, data: { text: 'Rolled back' } },
    expected: [{ method: 'PUT', url: '/experiment_annotations/4', data: { data: { text: 'Rolled back' } } }] },
  { name: 'getCustomField maps fieldId', group: 'experiments', command: 'getCustomField', params: { fieldId: 11 },
    expected: [{ method: 'GET', url: '/experiment_custom_section_fields/11' }] },
  { name: 'createCustomField flattens data and maps default_value', group: 'experiments', command: 'createCustomField',
    params: { data: { name: 'Owner', type: 'string', default_value: 'none' } },
    expected: [{ method: 'POST', url: '/experiment_custom_section_fields', data: { name: 'Owner', type: 'string', default_value: 'none' } }] },
  { name: 'updateCustomField maps fieldId and flattens data', group: 'experiments', command: 'updateCustomField',
    params: { fieldId: 11, data: { name: 'Team' } },
    expected: [{ method: 'PUT', url: '/experiment_custom_section_fields/11', data: { name: 'Team' } }] },
  { name: 'archiveCustomField maps fieldId', group: 'experiments', command: 'archiveCustomField', params: { fieldId: 11 },
    expected: [{ method: 'PUT', url: '/experiment_custom_section_fields/11/archive', data: { archive: true } }] },
  { name: 'bulkStart passes ids positionally without per-experiment lookups', group: 'experiments', command: 'bulkStart', params: { ids: [1, '2'] },
    expected: [
      { method: 'PUT', url: '/experiments/1/start', data: {} },
      { method: 'PUT', url: '/experiments/2/start', data: {} },
    ] },
  { name: 'bulkArchive passes ids positionally', group: 'experiments', command: 'bulkArchive', params: { ids: [5] },
    expected: [{ method: 'PUT', url: '/experiments/5/archive', data: { archive: true } }] },
  { name: 'bulkStop passes reason and note positionally', group: 'experiments', command: 'bulkStop',
    params: { ids: [5], reason: 'testing', note: 'done' },
    expected: [{ method: 'PUT', url: '/experiments/5/stop', data: { reason: 'testing', note: 'done' } }] },
  { name: 'bulkFullOn passes variant positionally', group: 'experiments', command: 'bulkFullOn', params: { ids: [5], variant: 1 },
    expected: [{ method: 'PUT', url: '/experiments/5/full_on', data: { full_on_variant: 1, note: 'Bulk full-on via CLI' } }] },
  { name: 'bulkStop without reason fails before any request', group: 'experiments', command: 'bulkStop', params: { ids: [5] },
    expectedError: 'experiments.bulkStop requires "reason"', expected: [] },

  // ── goals ─────────────────────────────────────────────────────────────────
  { name: 'getGoal maps goalId', group: 'goals', command: 'getGoal', params: { goalId: 12 },
    expected: [{ method: 'GET', url: '/goals/12' }] },
  { name: 'createGoal flattens data', group: 'goals', command: 'createGoal', params: { data: { name: 'purchase', description: 'Purchases' } },
    expected: [{ method: 'POST', url: '/goals', data: { name: 'purchase', description: 'Purchases' } }] },
  { name: 'updateGoal maps goalId and flattens data', group: 'goals', command: 'updateGoal', params: { goalId: 12, data: { description: 'new' } },
    expected: [{ method: 'PUT', url: '/goals/12', data: { data: { description: 'new' } } }] },
  { name: 'followGoal maps goalId', group: 'goals', command: 'followGoal', params: { goalId: 12 },
    expected: [{ method: 'POST', url: '/goals/12/follow' }] },
  { name: 'listGoalAccessTeams maps goalId', group: 'goals', command: 'listGoalAccessTeams', params: { goalId: 12 },
    expected: [{ method: 'GET', url: '/goals/12/asset_role_teams' }] },

  // ── segments ──────────────────────────────────────────────────────────────
  { name: 'createSegment flattens data and maps value_source_attribute', group: 'segments', command: 'createSegment',
    params: { data: { name: 'country', value_source_attribute: 'country', description: 'By country' } },
    expected: [{ method: 'POST', url: '/segments', data: { name: 'country', value_source_attribute: 'country', description: 'By country' } }] },
  { name: 'updateSegment maps segmentId and display_name', group: 'segments', command: 'updateSegment',
    params: { segmentId: 4, data: { display_name: 'Country' } },
    expected: [{ method: 'PUT', url: '/segments/4', data: { data: { display_name: 'Country' } } }] },
  { name: 'deleteSegment maps segmentId', group: 'segments', command: 'deleteSegment', params: { segmentId: 4 },
    expected: [{ method: 'DELETE', url: '/segments/4' }] },

  // ── teams ─────────────────────────────────────────────────────────────────
  { name: 'createTeam flattens data', group: 'teams', command: 'createTeam', params: { data: { name: 'Growth', description: 'g' } },
    expected: [{ method: 'POST', url: '/teams', data: { name: 'Growth', description: 'g' } }] },
  { name: 'updateTeam maps teamId and flattens data', group: 'teams', command: 'updateTeam', params: { teamId: 5, data: { description: 'd' } },
    expected: [{ method: 'PUT', url: '/teams/5', data: { data: { description: 'd' } } }] },
  { name: 'addTeamMembers maps teamId', group: 'teams', command: 'addTeamMembers', params: { teamId: 5, userIds: [2, 3] },
    expected: [{ method: 'PUT', url: '/teams/5/members/add', data: { user_ids: [2, 3] } }] },
  { name: 'removeTeamMembers maps teamId', group: 'teams', command: 'removeTeamMembers', params: { teamId: 5, userIds: [2] },
    expected: [{ method: 'PUT', url: '/teams/5/members/remove', data: { user_ids: [2] } }] },
  { name: 'editTeamMemberRoles maps userId/roles to userIds/roleIds', group: 'teams', command: 'editTeamMemberRoles',
    params: { teamId: 5, userId: 2, roles: [7, 8] },
    expected: [{ method: 'PUT', url: '/teams/5/members/edit_roles', data: { user_ids: [2], role_ids: [7, 8] } }] },

  // ── simple entity groups ──────────────────────────────────────────────────
  { name: 'createApp flattens data', group: 'apps', command: 'createApp', params: { data: { name: 'www' } },
    expected: [{ method: 'POST', url: '/applications', data: { name: 'www' } }] },
  { name: 'updateApp maps appId', group: 'apps', command: 'updateApp', params: { appId: 2, data: { name: 'web' } },
    expected: [{ method: 'PUT', url: '/applications/2', data: { data: { name: 'web' } } }] },
  { name: 'archiveEnv maps envId', group: 'envs', command: 'archiveEnv', params: { envId: 2 },
    expected: [{ method: 'PUT', url: '/environments/2/archive', data: { archive: true } }] },
  { name: 'createEnv flattens data', group: 'envs', command: 'createEnv', params: { data: { name: 'prod' } },
    expected: [{ method: 'POST', url: '/environments', data: { name: 'prod' } }] },
  { name: 'updateUnit maps unitId', group: 'units', command: 'updateUnit', params: { unitId: 2, data: { description: 'users' } },
    expected: [{ method: 'PUT', url: '/unit_types/2', data: { data: { description: 'users' } } }] },
  { name: 'createTag flattens data', group: 'tags', command: 'createTag', params: { data: { tag: 'q4' } },
    expected: [{ method: 'POST', url: '/experiment_tags', data: { tag: 'q4' } }] },
  { name: 'deleteGoalTag maps tagId', group: 'goaltags', command: 'deleteGoalTag', params: { tagId: 6 },
    expected: [{ method: 'DELETE', url: '/goal_tags/6' }] },
  { name: 'updateMetricTag maps tagId', group: 'metrictags', command: 'updateMetricTag', params: { tagId: 6, data: { tag: 'core' } },
    expected: [{ method: 'PUT', url: '/metric_tags/6', data: { data: { tag: 'core' } } }] },
  { name: 'createMetricCategory flattens data', group: 'metriccategories', command: 'createMetricCategory',
    params: { data: { name: 'Revenue', color: '#00ff00' } },
    expected: [{ method: 'POST', url: '/metric_categories', data: { name: 'Revenue', color: '#00ff00' } }] },
  { name: 'getMetricCategory maps categoryId', group: 'metriccategories', command: 'getMetricCategory', params: { categoryId: 3 },
    expected: [{ method: 'GET', url: '/metric_categories/3' }] },
  { name: 'createApiKey flattens data', group: 'apikeys', command: 'createApiKey', params: { data: { name: 'svc', permissions: 'read' } },
    expected: [{ method: 'POST', url: '/api_keys', data: { name: 'svc', permissions: 'read' } }] },
  { name: 'deleteApiKey maps keyId', group: 'apikeys', command: 'deleteApiKey', params: { keyId: 9 },
    expected: [{ method: 'DELETE', url: '/api_keys/9' }] },
  { name: 'createWebhook flattens data and maps max_retries', group: 'webhooks', command: 'createWebhook',
    params: { data: { name: 'hook', url: 'https://hook.test', max_retries: 3 } },
    expected: [{ method: 'POST', url: '/webhooks', data: { name: 'hook', url: 'https://hook.test', max_retries: 3 } }] },
  { name: 'updateWebhook maps webhookId', group: 'webhooks', command: 'updateWebhook', params: { webhookId: 4, data: { enabled: false } },
    expected: [{ method: 'PUT', url: '/webhooks/4', data: { data: { enabled: false } } }] },
  { name: 'updateRole maps roleId', group: 'roles', command: 'updateRole', params: { roleId: 4, data: { name: 'Admin' } },
    expected: [{ method: 'PUT', url: '/roles/4', data: { data: { name: 'Admin' } } }] },
  { name: 'createAssetRole flattens data', group: 'assetroles', command: 'createAssetRole', params: { data: { name: 'Viewer' } },
    expected: [{ method: 'POST', url: '/asset_roles', data: { name: 'Viewer' } }] },
  { name: 'getAssetRole maps roleId', group: 'assetroles', command: 'getAssetRole', params: { roleId: 4 },
    expected: [{ method: 'GET', url: '/asset_roles/4' }] },
  { name: 'createCorsOrigin flattens data', group: 'cors', command: 'createCorsOrigin', params: { data: { origin: 'https://a.test' } },
    expected: [{ method: 'POST', url: '/cors', data: { origin: 'https://a.test' } }] },
  { name: 'updateCorsOrigin maps originId', group: 'cors', command: 'updateCorsOrigin', params: { originId: 2, data: { origin: 'https://b.test' } },
    expected: [{ method: 'PUT', url: '/cors/2', data: { data: { origin: 'https://b.test' } } }] },

  // ── favorites, insights, activity, events, statistics ─────────────────────
  { name: 'addFavorite maps entityType/entityId', group: 'favorites', command: 'addFavorite', params: { entityType: 'experiment', entityId: 3 },
    expected: [{ method: 'PUT', url: '/favorites/experiment', params: { id: '3', favorite: 'true' } }] },
  { name: 'removeFavorite maps entityType/entityId', group: 'favorites', command: 'removeFavorite', params: { entityType: 'metric', entityId: 4 },
    expected: [{ method: 'PUT', url: '/favorites/metric', params: { id: '4', favorite: 'false' } }] },
  { name: 'addFavorite rejects goal, which the core does not support', group: 'favorites', command: 'addFavorite', params: { entityType: 'goal', entityId: 3 },
    expectedError: 'Invalid type "goal". Must be "experiment" or "metric".', expected: [] },
  { name: 'listEvents flattens params', group: 'events', command: 'listEvents', params: { params: { eventTypes: ['goal'], take: 10 } },
    expected: [{ method: 'POST', url: '/events', data: { filters: { event_types: ['goal'] }, take: 10 } }] },
  { name: 'listEventsHistory flattens params', group: 'events', command: 'listEventsHistory', params: { params: { period: 'day', tzOffset: 60 } },
    expected: [{ method: 'POST', url: '/events/history', data: { period: 'day', tz_offset: 60 } }] },
  { name: 'getPowerMatrix maps params to config', group: 'statistics', command: 'getPowerMatrix', params: { params: { alpha: 0.05 } },
    expected: [{ method: 'POST', url: '/statistics/power/plan/matrix', data: { alpha: 0.05 } }] },

  // ── config-body groups ────────────────────────────────────────────────────
  { name: 'createDatasource sends data as the body', group: 'datasources', command: 'createDatasource', params: { data: { name: 'ch', type: 'clickhouse' } },
    expected: [{ method: 'POST', url: '/datasources', data: { name: 'ch', type: 'clickhouse' } }] },
  { name: 'updateDatasource maps datasourceId and data', group: 'datasources', command: 'updateDatasource', params: { datasourceId: 2, data: { name: 'ch2' } },
    expected: [{ method: 'PUT', url: '/datasources/2', data: { data: { name: 'ch2' } } }] },
  { name: 'archiveDatasource maps datasourceId', group: 'datasources', command: 'archiveDatasource', params: { datasourceId: 2 },
    expected: [{ method: 'PUT', url: '/datasources/2/archive', data: { archive: true } }] },
  { name: 'createExportConfig sends data as the body', group: 'exportconfigs', command: 'createExportConfig', params: { data: { name: 'nightly' } },
    expected: [{ method: 'POST', url: '/export_configs', data: { name: 'nightly' } }] },
  { name: 'pauseExportConfig maps configId', group: 'exportconfigs', command: 'pauseExportConfig', params: { configId: 3 },
    expected: [{ method: 'PUT', url: '/export_configs/3/pause' }] },
  { name: 'listExportHistories maps configId', group: 'exportconfigs', command: 'listExportHistories', params: { configId: 3 },
    expected: [{ method: 'GET', url: '/export_configs/3/export_histories' }] },
  { name: 'updateUpdateSchedule maps scheduleId and data', group: 'updateschedules', command: 'updateUpdateSchedule',
    params: { scheduleId: 4, data: { cron: '0 * * * *' } },
    expected: [{ method: 'PUT', url: '/experiment_update_schedules/4', data: { data: { cron: '0 * * * *' } } }] },
  { name: 'deleteUpdateSchedule maps scheduleId', group: 'updateschedules', command: 'deleteUpdateSchedule', params: { scheduleId: 4 },
    expected: [{ method: 'DELETE', url: '/experiment_update_schedules/4' }] },
  { name: 'createStorageConfig sends data as the body', group: 'storageconfigs', command: 'createStorageConfig', params: { data: { type: 's3' } },
    expected: [{ method: 'POST', url: '/storage_configs', data: { type: 's3' } }] },
  { name: 'getStorageConfig maps configId', group: 'storageconfigs', command: 'getStorageConfig', params: { configId: 5 },
    expected: [{ method: 'GET', url: '/storage_configs/5' }] },
  { name: 'updateActionDialogField maps fieldId and data', group: 'actiondialogfields', command: 'updateActionDialogField',
    params: { fieldId: 6, data: { required: true } },
    expected: [{ method: 'PUT', url: '/experiment_action_dialog_fields/6', data: { data: { required: true } } }] },

  // ── custom sections, platform config ─────────────────────────────────────
  { name: 'createCustomSection flattens data', group: 'customsections', command: 'createCustomSection', params: { data: { name: 'Info', type: 'test' } },
    expected: [{ method: 'POST', url: '/experiment_custom_sections', data: { name: 'Info', type: 'test' } }] },
  { name: 'updateCustomSection maps sectionId', group: 'customsections', command: 'updateCustomSection', params: { sectionId: 2, data: { name: 'Details' } },
    expected: [{ method: 'PUT', url: '/experiment_custom_sections/2', data: { data: { name: 'Details' } } }] },
  { name: 'reorderCustomSections turns ids into order_index rows', group: 'customsections', command: 'reorderCustomSections', params: { ids: [9, 7] },
    expected: [{ method: 'PUT', url: '/experiment_custom_sections/order', data: { experiment_custom_sections: [{ id: 9, order_index: 0 }, { id: 7, order_index: 1 }] } }] },
  { name: 'getPlatformConfig maps a numeric configKey to the id', group: 'platformconfig', command: 'getPlatformConfig', params: { configKey: 12 },
    expected: [{ method: 'GET', url: '/configs/12' }] },
  { name: 'getPlatformConfig resolves a config name to its id', group: 'platformconfig', command: 'getPlatformConfig',
    params: { configKey: 'experiment_form_team_visibility' },
    respond: (config) => (config.url === '/configs'
      ? { configs: [{ id: 3, name: 'other' }, { id: 12, name: 'experiment_form_team_visibility' }] }
      : { config: { id: 12, name: 'experiment_form_team_visibility', value: 'optional' } }),
    expected: [{ method: 'GET', url: '/configs' }, { method: 'GET', url: '/configs/12' }] },
  { name: 'updatePlatformConfig maps configKey and data.value', group: 'platformconfig', command: 'updatePlatformConfig',
    params: { configKey: 12, data: { value: 'true' } },
    respond: () => ({ config: { id: 12, name: 'flag', value: 'false' } }),
    expected: [
      { method: 'GET', url: '/configs/12' },
      { method: 'PUT', url: '/configs/12', data: { data: { name: 'flag', value: 'true' } } },
    ] },

  // ── 2.1.0 contract additions ──────────────────────────────────────────────
  { name: 'revokeExperimentAccessUser resolves role into the URL', group: 'experiments', command: 'revokeExperimentAccessUser',
    params: { experimentId: 3, userId: 2, role: 'Editor' }, respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 1, name: 'Viewer' }, { id: 5, name: 'Editor' }] } : {}),
    expected: [{ method: 'GET', url: '/asset_roles', params: { items: '100', page: '1' } }, { method: 'DELETE', url: '/experiments/3/asset_role_users/2/5' }] },
  { name: 'revokeExperimentAccessTeam takes a numeric role', group: 'experiments', command: 'revokeExperimentAccessTeam',
    params: { experimentId: 3, teamId: 4, role: 5 },
    expected: [{ method: 'DELETE', url: '/experiments/3/asset_role_teams/4/5' }] },
  { name: 'grantGoalAccessUser maps goalId and role', group: 'goals', command: 'grantGoalAccessUser',
    params: { goalId: 12, userId: 2, role: 5 },
    expected: [{ method: 'POST', url: '/goals/12/asset_role_users', data: { user_id: 2, asset_role_id: 5 } }] },
  { name: 'revokeGoalAccessTeam maps goalId and resolves a role name', group: 'goals', command: 'revokeGoalAccessTeam',
    params: { goalId: 12, teamId: 4, role: 'viewer' }, respond: (config) => (config.url === '/asset_roles' ? { asset_roles: [{ id: 1, name: 'Viewer' }, { id: 5, name: 'Editor' }] } : {}),
    expected: [{ method: 'GET', url: '/asset_roles', params: { items: '100', page: '1' } }, { method: 'DELETE', url: '/goals/12/asset_role_teams/4/1' }] },
  { name: 'revokeGoalAccessUser without role fails before any request', group: 'goals', command: 'revokeGoalAccessUser',
    params: { goalId: 12, userId: 2 },
    expectedError: 'goals.revokeGoalAccessUser requires "role" (an asset role ID or name)', expected: [] },
  { name: 'restartExperiment passes state and reshuffle', group: 'experiments', command: 'restartExperiment',
    params: { experimentId: 3, reason: 'testing', state: 'development', reshuffle: true },
    select: (requests) => requests.map(({ method, url, data }) => {
      const { reason, state, reshuffle } = (data ?? {}) as Record<string, unknown>;
      return data === undefined ? { method, url } : { method, url, data: { reason, state, reshuffle } };
    }),
    expected: [
      { method: 'GET', url: '/experiments/3' },
      { method: 'PUT', url: '/experiments/3/restart', data: { reason: 'testing', state: 'development', reshuffle: true } },
    ] },
  { name: 'estimateParticipants resolves unitType and applications', group: 'experiments', command: 'estimateParticipants',
    params: { unitType: 'user_id', application: ['www'], from: '1700000000000' },
    respond: (config) => {
      if (config.url === '/unit_types') return { unit_types: [{ id: 7, name: 'user_id' }] };
      if (config.url === '/applications') return { applications: [{ id: 2, name: 'www' }] };
      return { columnNames: ['unit_count'], rows: [[42]] };
    },
    select: (requests) => requests.filter((r) => r.method === 'POST'),
    expected: [{ method: 'POST', url: '/experiments/estimate/max_participants', data: { from: 1700000000000, unit_type_id: 7, applications: [2] } }] },
  { name: 'generateTemplate makes no API request', group: 'experiments', command: 'generateTemplate',
    params: { name: 'Checkout', type: 'feature' }, select: (requests) => requests.filter((r) => r.method !== 'GET'), expected: [] },
  { name: 'listCustomFields defaults type to test', group: 'experiments', command: 'listCustomFields', params: {},
    expected: [{ method: 'GET', url: '/experiment_custom_section_fields', params: { items: '100', page: '1' } }] },
  { name: 'resetMyPassword sends old and new password', group: 'auth', command: 'resetMyPassword',
    params: { oldPassword: 'old-pw', newPassword: 'new-pw' },
    expected: [{ method: 'PUT', url: `${ROOT_URL}/auth/current-user`, data: { data: { old_password: 'old-pw', new_password: 'new-pw' } } }] },
  { name: 'getVelocityInsights takes documented top-level filters', group: 'insights', command: 'getVelocityInsights',
    params: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', aggregation: 'week' },
    select: (requests) => requests.filter((r) => r.url.startsWith('/insights')),
    expected: [{ method: 'GET', url: '/insights/summary', params: { from: '1767225600', to: '1769904000', aggregation: 'week' } }] },
  { name: 'getVelocityInsights still accepts the deprecated params bag', group: 'insights', command: 'getVelocityInsights',
    params: { params: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', aggregation: 'week' } },
    select: (requests) => requests.filter((r) => r.url.startsWith('/insights')),
    expected: [{ method: 'GET', url: '/insights/summary', params: { from: '1767225600', to: '1769904000', aggregation: 'week' } }] },
  { name: 'listEvents takes documented top-level filters', group: 'events', command: 'listEvents', params: { eventTypes: ['goal'], take: 10 },
    expected: [{ method: 'POST', url: '/events', data: { filters: { event_types: ['goal'] }, take: 10 } }] },
  { name: 'testDatasource tests the stored datasource by id', group: 'datasources', command: 'testDatasource', params: { datasourceId: 2 },
    expected: [{ method: 'POST', url: '/datasources/test', data: { datasource_id: 2 } }] },
  { name: 'testDatasource merges unsaved edits but keeps the id', group: 'datasources', command: 'testDatasource',
    params: { datasourceId: 2, config: { type: 'clickhouse', properties: { host: 'ch.test' }, datasource_id: 99 } },
    expected: [{ method: 'POST', url: '/datasources/test', data: { datasource_id: 2, type: 'clickhouse', properties: { host: 'ch.test' } } }] },
  { name: 'testDatasource rejects a partial config instead of testing the stored one', group: 'datasources', command: 'testDatasource',
    params: { datasourceId: 2, config: { properties: { host: 'ch.test' } } },
    expectedError: 'datasources.testDatasource: "config" must be an object with "type" (string) and "properties" (object)', expected: [] },
  { name: 'testDatasource rejects a non-object config', group: 'datasources', command: 'testDatasource',
    params: { datasourceId: 2, config: 'clickhouse' },
    expectedError: 'datasources.testDatasource: "config" must be an object with "type" (string) and "properties" (object)', expected: [] },
  { name: 'introspectDatasource introspects the stored datasource by id', group: 'datasources', command: 'introspectDatasource', params: { datasourceId: 2 },
    expected: [{ method: 'POST', url: '/datasources/introspect', data: { datasource_id: 2 } }] },
  { name: 'validateDatasourceQuery sends the id and query', group: 'datasources', command: 'validateDatasourceQuery',
    params: { datasourceId: 2, query: 'select 1' },
    expected: [{ method: 'POST', url: '/datasources/validate_query', data: { datasource_id: 2, query: 'select 1' } }] },
  { name: 'testStorageConfig tests the stored config by id', group: 'storageconfigs', command: 'testStorageConfig', params: { configId: 5 },
    respond: (config) => (config.method === 'GET'
      ? { storage_config: { id: 5, name: 's3', type: 'S3', properties: { bucket: 'b', accessKey: 'AK' } } }
      : { ok: true, test: {} }),
    expected: [
      { method: 'GET', url: '/storage_configs/5' },
      { method: 'POST', url: '/storage_configs/test', data: { type: 'S3', properties: { bucket: 'b', accessKey: 'AK' }, storage_config_id: 5 } },
    ] },
];

// Catalog/core mismatches the translation layer cannot fix without changing
// the documented catalog contract. Each is reported in the PR for a follow-up;
// keep this list exact so a new mismatch, or a fixed one, fails the test.
// Catalog/core mismatches the translation layer does not fix. Keep it empty:
// the guard below fails on any new mismatch, so a catalog change must ship
// with its translation (or a documented reason to list it here).
export const KNOWN_CATALOG_GAPS: Record<string, { dropped: string[]; missingRequired: string[] }> = {};

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr === expectedStr) {
      passed++;
      details.push({ name, status: 'PASS' });
    } else {
      failed++;
      details.push({ name, status: 'FAIL', error: `Expected ${expectedStr}, got ${actualStr}` });
    }
  }

  for (const c of CASES) {
    const http = new FakeHttpClient(c.respond);
    let error: string | undefined;
    try {
      await executeCommand(new APIClient(http) as any, c.group, c.command, structuredClone(c.params));
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    const requests = c.select ? c.select(http.requests) : http.requests;
    const actualError = c.expectedErrorPrefix && error?.startsWith(c.expectedErrorPrefix) ? c.expectedErrorPrefix : error;
    assertEquals({ error: actualError, requests }, { error: c.expectedError ?? c.expectedErrorPrefix, requests: c.expected }, `${c.group}.${c.command}: ${c.name}`);
  }

  // cloneExperiment builds its payload from the source experiment (many
  // lookups), so pin only that it reads the source and posts one new experiment.
  // The source carries a custom field value with no matching field definition,
  // which makes buildClonePayload return a warning the runner must surface.
  {
    const source = {
      id: 3, name: 'src', type: 'test', state: 'running', percentages: '50/50',
      variants: [{ variant: 0, name: 'a', config: '{}' }, { variant: 1, name: 'b', config: '{}' }],
      custom_section_field_values: [{ value: 'x', custom_section_field: { title: 'Orphan', type: 'text', custom_section: { title: 'S', type: 'test' } } }],
    };
    const http = new FakeHttpClient((config) => {
      if (config.method === 'GET' && config.url === '/experiments/3') return { experiment: source };
      if (config.url === '/experiment_custom_section_fields') return { experiment_custom_section_fields: [] };
      return permissiveBody();
    });
    let error: string | undefined;
    let result: any;
    try {
      result = await executeCommand(new APIClient(http) as any, 'experiments', 'cloneExperiment', { experimentId: '3', name: 'copy', apiEndpoint: BASE_URL });
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    const posts = http.requests.filter((r) => r.method === 'POST');
    assertEquals(
      {
        error,
        firstRequest: http.requests[0],
        posts: posts.map((r) => ({ url: r.url, name: (r.data as any)?.name, state: (r.data as any)?.state })),
        sourceId: result?.data?.sourceId,
        surfacesPayloadWarnings: Array.isArray(result?.warnings) && result.warnings.length > 0,
      },
      { firstRequest: { method: 'GET', url: '/experiments/3' }, posts: [{ url: '/experiments', name: 'copy', state: 'created' }], sourceId: 3, surfacesPayloadWarnings: true },
      'experiments.cloneExperiment: builds the payload from the source, posts the clone and surfaces payload warnings',
    );
  }

  // Documented enum values must be ones the core accepts.
  for (const command of ['addFavorite', 'removeFavorite']) {
    const doc = getCommandEntry('favorites', command)!.params.find((p) => p.name === 'entityType')!.description;
    assertEquals(/\bgoal\b/.test(doc), false, `favorites.${command}: does not advertise goal favorites`);
  }

  // Every param a runner requires must also pass execute_command's catalog
  // validation, or the command is unreachable through the MCP tool.
  for (const [command, params] of [
    ['bulkStop', { ids: [5], reason: 'testing', note: 'done' }],
    ['bulkFullOn', { ids: [5], variant: 1, note: 'done' }],
    ['grantExperimentAccessUser', { experimentId: 3, userId: 2, role: 'Editor' }],
  ] as const) {
    assertEquals(validateCommandParams(getCommandEntry('experiments', command)!, params), [], `experiments.${command}: runner params pass catalog validation`);
  }

  // The deprecated `params` bag still satisfies the required filters it replaced.
  {
    const insights = getCommandEntry('insights', 'getVelocityInsights')!;
    assertEquals(
      validateCommandParams(insights, { params: { from: '2026-01-01', to: '2026-02-01', aggregation: 'week' } }),
      [],
      'insights: the legacy params bag passes validation',
    );
    assertEquals(
      validateCommandParams(insights, { params: { from: '2026-01-01' } }).length,
      2,
      'insights: a legacy params bag missing filters still fails validation',
    );
    assertEquals(
      validateCommandParams(insights, { params: { from: '2026-01-01', to: '2026-02-01', aggregation: 'week', tems: 'Growth' } })
        .some((e) => e.startsWith('Unknown param "tems"') && e.includes('Did you mean "teams"?')),
      true,
      'insights: a typo inside the legacy params bag is reported as unknown',
    );
    assertEquals(
      validateCommandParams(getCommandEntry('events', 'listEvents')!, { params: { take: 10 }, skip: 5 }),
      [],
      'events: legacy bag and top-level filters can be mixed',
    );
    assertEquals(
      validateCommandParams(insights, { params: 'from=2026-01-01' }),
      ['Param "params" for insights.getVelocityInsights must be an object.'],
      'insights: a non-object params bag is rejected',
    );
    assertEquals(
      validateCommandParams(insights, { params: { params: { from: 'x' } } }),
      ['Param "params" for insights.getVelocityInsights must not contain a nested "params".'],
      'insights: a nested params key inside the bag is rejected',
    );
    assertEquals(
      getCommandEntry('experiments', 'restartExperiment')!.params.some((p) => p.name === 'defaultType'),
      false,
      'restartExperiment does not document defaultType, which the core never reads',
    );
  }

  // IDs are interpolated into request paths, so a "../users/5" ID must never
  // pass validation (it would DELETE /v1/users/5 from deleteSegment).
  {
    const del = getCommandEntry('segments', 'deleteSegment')!;
    const bad = 'Param "segmentId" for segments.deleteSegment must be a positive integer ID.';
    assertEquals(validateCommandParams(del, { segmentId: '../users/5' }), [bad], 'segments.deleteSegment: a path in segmentId is rejected');
    assertEquals(validateCommandParams(del, { segmentId: '5/../../users/5' }), [bad], 'segments.deleteSegment: a trailing path in segmentId is rejected');
    assertEquals(validateCommandParams(del, { segmentId: 0 }), [bad], 'segments.deleteSegment: a zero ID is rejected');
    assertEquals(validateCommandParams(del, { segmentId: 1.5 }), [bad], 'segments.deleteSegment: a fractional ID is rejected');
    assertEquals(validateCommandParams(del, { segmentId: '7' }), [], 'segments.deleteSegment: a numeric-string ID is accepted');
    assertEquals(validateCommandParams(del, { segmentId: 7 }), [], 'segments.deleteSegment: a number ID is accepted');
    assertEquals(
      validateCommandParams(getCommandEntry('goals', 'getGoal')!, { goalId: '..%2Fusers' }),
      ['Param "goalId" for goals.getGoal must be a positive integer ID.'],
      'goals.getGoal: an encoded traversal in goalId is rejected',
    );
    assertEquals(
      validateCommandParams(getCommandEntry('experiments', 'diffExperimentsCore')!, { experimentId1: 1, experimentId2: '../2' }),
      ['Param "experimentId2" for experiments.diffExperimentsCore must be a positive integer ID.'],
      'numbered ID params are checked too',
    );
  }

  // userId on the user API-key commands is a ref (ID or email); deprecated
  // "Ignored" params are not checked as IDs either.
  {
    for (const command of ['listUserApiKeys', 'createUserApiKey', 'deleteUserApiKey']) {
      const params: Record<string, unknown> = { userId: 'jane@example.com' };
      if (command === 'deleteUserApiKey') params.keyId = 3;
      assertEquals(validateCommandParams(getCommandEntry('users', command)!, params), [], `users.${command}: userId accepts an email`);
    }
    assertEquals(
      validateCommandParams(getCommandEntry('experiments', 'dismissAlert')!, { alertId: 4, experimentId: 'legacy' }),
      [],
      'a deprecated experimentId is not checked as an ID',
    );
    assertEquals(
      validateCommandParams(getCommandEntry('events', 'listEvents')!, { params: null }),
      [],
      'params: null is accepted for legacy-bag commands',
    );
  }

  // Deprecated params stay accepted (old callers keep working) but are not documented.
  {
    const search = getCommandEntry('experiments', 'searchExperiments')!;
    assertEquals(validateCommandParams(search, { search: 'x', show: ['audience'] }), [], 'deprecated params are still accepted');
    assertEquals(documentedParams(search).map((p) => p.name), ['search', 'items'], 'deprecated params are hidden from docs');
    assertEquals(
      validateCommandParams(search, { serch: 'x' }).some((e) => e.includes('Valid params: search, items.')),
      true,
      'unknown-param errors list only documented params',
    );
    assertEquals(getCommandEntry('experiments', 'refreshFields'), undefined, 'refreshFields is not in the MCP catalog');
  }

  // A param documented twice would render twice in docs and validation errors.
  const duplicated = CLI_GROUPS.flatMap((g) => getGroupCommands(g))
    .filter((e) => new Set(e.params.map((p) => p.name)).size !== e.params.length)
    .map((e) => `${e.group}.${e.command}`);
  assertEquals(duplicated, [], 'no command documents a param twice');

  // Broad guard: every catalog command, after translation, supplies the
  // params its core function reads (see scripts/audit-catalog-params.ts).
  const findings = Object.fromEntries(
    auditCatalogParams().map((f) => [f.command, { dropped: f.dropped, missingRequired: f.missingRequired }]),
  );
  for (const [command, finding] of Object.entries(findings)) {
    assertEquals(finding, KNOWN_CATALOG_GAPS[command] ?? null, `catalog/core params match for ${command}`);
  }
  for (const command of Object.keys(KNOWN_CATALOG_GAPS)) {
    if (!(command in findings)) {
      assertEquals(null, KNOWN_CATALOG_GAPS[command], `${command} is fixed: remove it from KNOWN_CATALOG_GAPS`);
    }
  }

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}
