// Shared entity-fetch/shape logic — used by index.ts (Cloudflare Worker),
// local-server.ts (stdio CLI), and node-http-server.ts (Node HTTP transport).
import type { APIClient, CustomSectionField } from "@absmartly/cli/api-client";

const ENTITY_LIST_PAGE_SIZE = 100;
const ENTITY_LIST_FIRST_PAGE = 1;

export interface SummarizedEntity {
  id: number;
  name: string;
  description: string;
}

export interface ServerContext {
  apiClient: APIClient;
  endpoint: string;
  authType: string;
  currentUserId: number | null;
  entityWarnings: string[];
  customFields: CustomSectionField[];
  users: SummarizedEntity[];
  teams: SummarizedEntity[];
  applications: SummarizedEntity[];
  unitTypes: SummarizedEntity[];
  experimentTags: SummarizedEntity[];
  metrics: SummarizedEntity[];
  goals: SummarizedEntity[];
}

export async function buildServerContext(
  apiClient: APIClient,
  opts: { endpoint: string; authType: string },
): Promise<ServerContext> {
  const entityWarnings: string[] = [];
  let currentUserId: number | null = null;

  const safeCall = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch (e) {
      const msg = `Failed to fetch ${label}: ${e}`;
      entityWarnings.push(msg);
      console.error(msg);
      return [];
    }
  };

  try {
    const user = await apiClient.getCurrentUser();
    currentUserId = user?.id || null;
  } catch (e) {
    const msg = `Failed to fetch current user: ${e}`;
    entityWarnings.push(msg);
    console.error(msg);
  }

  const [
    rawCustomFields,
    rawUsers,
    rawTeams,
    rawApplications,
    rawUnitTypes,
    rawExperimentTags,
    rawMetrics,
    rawGoals,
  ] = await Promise.all([
    safeCall('customFields', () => apiClient.listCustomSectionFields()),
    safeCall('users', () => apiClient.listUsers()),
    safeCall('teams', () => apiClient.listTeams()),
    safeCall('applications', () => apiClient.listApplications()),
    safeCall('unitTypes', () => apiClient.listUnitTypes()),
    safeCall('experimentTags', () => apiClient.listExperimentTags({ items: ENTITY_LIST_PAGE_SIZE, page: ENTITY_LIST_FIRST_PAGE })),
    safeCall('metrics', () => apiClient.listMetrics({ items: ENTITY_LIST_PAGE_SIZE })),
    safeCall('goals', () => apiClient.listGoals({ items: ENTITY_LIST_PAGE_SIZE, page: ENTITY_LIST_FIRST_PAGE })),
  ]);

  return {
    apiClient,
    endpoint: opts.endpoint,
    authType: opts.authType,
    currentUserId,
    entityWarnings,
    customFields: rawCustomFields as CustomSectionField[],
    users: (rawUsers as any[]).map((u: any) => ({
      id: u.id,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
      description: u.email || '',
    })),
    teams: (rawTeams as any[]).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description || `${t.member_count || 0} members`,
    })),
    applications: (rawApplications as any[]).map((a: any) => ({
      id: a.id,
      name: a.name,
      description: `Environment: ${a.environment || 'default'}`,
    })),
    unitTypes: (rawUnitTypes as any[]).map((e: any) => ({
      id: e.id, name: e.name || e.tag, description: e.description || `unit_type: ${e.name || e.tag}`,
    })),
    experimentTags: (rawExperimentTags as any[]).map((e: any) => ({
      id: e.id, name: e.name || e.tag, description: e.description || `experiment_tag: ${e.name || e.tag}`,
    })),
    metrics: (rawMetrics as any[]).map((e: any) => ({
      id: e.id, name: e.name || e.tag, description: e.description || `metric: ${e.name || e.tag}`,
    })),
    goals: (rawGoals as any[]).map((e: any) => ({
      id: e.id, name: e.name || e.tag, description: e.description || `goal: ${e.name || e.tag}`,
    })),
  };
}

/**
 * Deferred ServerContext: identity fields are available immediately, while
 * the entity lists (current user + eight list calls) are fetched only the
 * first time `load()` is called, then memoized. Lets per-request transports
 * (node-http-server.ts) skip the prefetch for messages that never touch
 * entity data (initialize, tools/list, resources/list, most tool calls).
 */
export interface ServerContextLoader {
  apiClient: APIClient;
  endpoint: string;
  authType: string;
  load(): Promise<ServerContext>;
}

export function createServerContextLoader(
  apiClient: APIClient,
  opts: { endpoint: string; authType: string },
): ServerContextLoader {
  let pending: Promise<ServerContext> | undefined;
  return {
    apiClient,
    endpoint: opts.endpoint,
    authType: opts.authType,
    load: () => (pending ??= buildServerContext(apiClient, opts)),
  };
}

export function isServerContextLoader(
  source: ServerContext | ServerContextLoader,
): source is ServerContextLoader {
  return typeof (source as ServerContextLoader).load === 'function';
}
