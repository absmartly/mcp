// CLI Command Catalog — maps CLI core functions for MCP tool discovery and execution.
// Each entry stores a reference to the core function, its description, and param docs.
// All core functions follow the signature: (client: APIClient, params: object) => Promise<CommandResult<T>>

import type { APIClient } from "@absmartly/cli/api-client";

// Static imports for all core modules — required for Cloudflare Workers bundling.
import * as coreExperiments from "@absmartly/cli/core/experiments";
import * as coreMetrics from "@absmartly/cli/core/metrics";
import * as coreGoals from "@absmartly/cli/core/goals";
import * as coreSegments from "@absmartly/cli/core/segments";
import * as coreTeams from "@absmartly/cli/core/teams";
import * as coreUsers from "@absmartly/cli/core/users";
import * as coreApps from "@absmartly/cli/core/apps";
import * as coreEnvs from "@absmartly/cli/core/envs";
import * as coreUnits from "@absmartly/cli/core/units";
import * as coreTags from "@absmartly/cli/core/tags";
import * as coreGoaltags from "@absmartly/cli/core/goaltags";
import * as coreMetrictags from "@absmartly/cli/core/metrictags";
import * as coreMetriccategories from "@absmartly/cli/core/metriccategories";
import * as coreAuth from "@absmartly/cli/core/auth";
import * as coreApikeys from "@absmartly/cli/core/apikeys";
import * as coreWebhooks from "@absmartly/cli/core/webhooks";
import * as coreRoles from "@absmartly/cli/core/roles";
import * as corePermissions from "@absmartly/cli/core/permissions";
import * as coreAssetroles from "@absmartly/cli/core/assetroles";
import * as coreNotifications from "@absmartly/cli/core/notifications";
import * as coreFavorites from "@absmartly/cli/core/favorites";
import * as coreInsights from "@absmartly/cli/core/insights";
import * as coreCors from "@absmartly/cli/core/cors";
import * as coreDatasources from "@absmartly/cli/core/datasources";
import * as coreExportconfigs from "@absmartly/cli/core/exportconfigs";
import * as coreUpdateschedules from "@absmartly/cli/core/updateschedules";
import * as coreCustomsections from "@absmartly/cli/core/customsections";
import * as corePlatformconfig from "@absmartly/cli/core/platformconfig";
import * as coreActivity from "@absmartly/cli/core/activity";
import * as coreStatistics from "@absmartly/cli/core/statistics";
import * as coreEvents from "@absmartly/cli/core/events";
import * as coreStorageconfigs from "@absmartly/cli/core/storageconfigs";
import * as coreActiondialogfields from "@absmartly/cli/core/actiondialogfields";
import * as coreCustomfields from "@absmartly/cli/core/customfields";

const CORE_MODULES: Record<string, Record<string, Function>> = {
  experiments: coreExperiments as unknown as Record<string, Function>,
  metrics: coreMetrics as unknown as Record<string, Function>,
  goals: coreGoals as unknown as Record<string, Function>,
  segments: coreSegments as unknown as Record<string, Function>,
  teams: coreTeams as unknown as Record<string, Function>,
  users: coreUsers as unknown as Record<string, Function>,
  apps: coreApps as unknown as Record<string, Function>,
  envs: coreEnvs as unknown as Record<string, Function>,
  units: coreUnits as unknown as Record<string, Function>,
  tags: coreTags as unknown as Record<string, Function>,
  goaltags: coreGoaltags as unknown as Record<string, Function>,
  metrictags: coreMetrictags as unknown as Record<string, Function>,
  metriccategories: coreMetriccategories as unknown as Record<string, Function>,
  auth: coreAuth as unknown as Record<string, Function>,
  apikeys: coreApikeys as unknown as Record<string, Function>,
  webhooks: coreWebhooks as unknown as Record<string, Function>,
  roles: coreRoles as unknown as Record<string, Function>,
  permissions: corePermissions as unknown as Record<string, Function>,
  assetroles: coreAssetroles as unknown as Record<string, Function>,
  notifications: coreNotifications as unknown as Record<string, Function>,
  favorites: coreFavorites as unknown as Record<string, Function>,
  insights: coreInsights as unknown as Record<string, Function>,
  cors: coreCors as unknown as Record<string, Function>,
  datasources: coreDatasources as unknown as Record<string, Function>,
  exportconfigs: coreExportconfigs as unknown as Record<string, Function>,
  updateschedules: coreUpdateschedules as unknown as Record<string, Function>,
  customsections: coreCustomsections as unknown as Record<string, Function>,
  platformconfig: corePlatformconfig as unknown as Record<string, Function>,
  activity: coreActivity as unknown as Record<string, Function>,
  statistics: coreStatistics as unknown as Record<string, Function>,
  events: coreEvents as unknown as Record<string, Function>,
  storageconfigs: coreStorageconfigs as unknown as Record<string, Function>,
  actiondialogfields: coreActiondialogfields as unknown as Record<string, Function>,
  customfields: coreCustomfields as unknown as Record<string, Function>,
};

export interface CommandParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface CommandEntry {
  command: string;
  group: string;
  description: string;
  params: CommandParam[];
  returns: string;
  dangerous?: boolean;
  example?: Record<string, unknown>;
}

export interface GroupSummary {
  group: string;
  description: string;
  commands: string[];
}

// ─── Catalog Definition ───────────────────────────────────────────────────────
// Each group maps command names to their metadata. The actual function is loaded
// at execution time from the core module via getGroupModule().

const CATALOG_GROUPS: Record<string, { description: string; commands: Record<string, Omit<CommandEntry, 'command' | 'group'>> }> = {
  experiments: {
    description: 'A/B test and feature flag experiment management',
    commands: {
      listExperiments: {
        description: 'List experiments with filtering, sorting, and pagination',
        params: [
          { name: 'items', type: 'number', required: false, description: 'Results per page (default: 20)' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default: 1)' },
          { name: 'state', type: 'string', required: false, description: 'Filter by state: created, ready, running, development, full_on, stopped, archived' },
          { name: 'type', type: 'string', required: false, description: 'Filter by type: test, feature' },
          { name: 'search', type: 'string', required: false, description: 'Search by name or display name' },
          { name: 'app', type: 'string', required: false, description: 'Filter by application name' },
          { name: 'applications', type: 'string', required: false, description: 'Filter by application IDs (comma-separated)' },
          { name: 'owners', type: 'string', required: false, description: 'Filter by owner user IDs (comma-separated)' },
          { name: 'teams', type: 'string', required: false, description: 'Filter by team IDs (comma-separated)' },
          { name: 'tags', type: 'string', required: false, description: 'Filter by tag IDs (comma-separated)' },
          { name: 'sort', type: 'string', required: false, description: 'Sort by field (created_at, name, state)' },
          { name: 'show', type: 'array', required: false, description: 'Extra fields to include (e.g. experiment_report, audience)' },
          { name: 'exclude', type: 'array', required: false, description: 'Fields to exclude from summary' },
        ],
        returns: 'Array of experiment summaries with pagination',
        example: { state: 'running', items: 10 },
      },
      searchExperiments: {
        description: 'Search experiments by name with pagination',
        params: [
          { name: 'search', type: 'string', required: true, description: 'Search query' },
          { name: 'items', type: 'number', required: false, description: 'Results per page (default: 20)' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default: 1)' },
          { name: 'show', type: 'array', required: false, description: 'Extra fields to include' },
          { name: 'exclude', type: 'array', required: false, description: 'Fields to exclude' },
        ],
        returns: 'Array of matching experiment summaries',
      },
      getExperiment: {
        description: 'Get detailed information about a specific experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'activity', type: 'boolean', required: false, description: 'Include activity notes' },
          { name: 'show', type: 'array', required: false, description: 'Extra fields to include (e.g. audience, experiment_report)' },
          { name: 'exclude', type: 'array', required: false, description: 'Fields to exclude' },
        ],
        returns: 'Experiment details with summary',
        example: { experimentId: 42 },
      },
      createExperiment: {
        description: 'Create a new experiment or feature flag from a raw API payload',
        params: [
          { name: 'data', type: 'object', required: true, description: 'Experiment data: { name, type, application_id, unit_type, variants, percentages, ... }' },
          { name: 'defaultType', type: 'string', required: false, description: 'Default experiment type (test or feature)' },
        ],
        returns: 'Created experiment with ID',
        dangerous: false,
      },
      createExperimentFromTemplate: {
        description: 'Create an experiment from a markdown template. The template uses YAML frontmatter for configuration and markdown body for variants, audience, and description. Names for applications, unit types, metrics, teams, tags, and owners are automatically resolved to IDs. Read the absmartly://docs/templates resource for template format and examples.',
        params: [
          { name: 'templateContent', type: 'string', required: true, description: 'Markdown template content with YAML frontmatter. See absmartly://docs/templates for format and examples (basic A/B, feature flag, GST, screenshots, custom fields, multi-variant).' },
          { name: 'name', type: 'string', required: false, description: 'Override the experiment name from the template' },
          { name: 'displayName', type: 'string', required: false, description: 'Override the display name from the template' },
          { name: 'defaultType', type: 'string', required: false, description: 'Default type if not specified in template (test or feature)' },
        ],
        returns: 'Created experiment with ID, name, and type',
        example: {
          templateContent: '---\nname: my_experiment\ntype: test\npercentages: 50/50\nunit_type: user_id\napplication: www\n---\n\n## Variants\n\n### variant_0\n\nname: control\nconfig: {}\n\n---\n\n### variant_1\n\nname: treatment\nconfig: {}',
        },
      },
      updateExperiment: {
        description: 'Update an existing experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'data', type: 'object', required: true, description: 'Fields to update' },
        ],
        returns: 'Updated experiment',
      },
      startExperiment: {
        description: 'Start a ready experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'note', type: 'string', required: false, description: 'Optional start note' },
        ],
        returns: 'Start result',
        dangerous: true,
      },
      stopExperiment: {
        description: 'Stop a running experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'reason', type: 'string', required: false, description: 'Stop reason' },
          { name: 'note', type: 'string', required: false, description: 'Optional note' },
        ],
        returns: 'Stop result',
        dangerous: true,
      },
      archiveExperiment: {
        description: 'Archive an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Archive result',
        dangerous: true,
      },
      restartExperiment: {
        description: 'Restart a stopped experiment with optional changes',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'reason', type: 'string', required: false, description: 'Restart reason' },
          { name: 'type', type: 'string', required: false, description: 'Restart type' },
          { name: 'note', type: 'string', required: false, description: 'Optional note' },
        ],
        returns: 'Restart result',
        dangerous: true,
      },
      developmentExperiment: {
        description: 'Put experiment into development mode',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Development mode result',
        dangerous: true,
      },
      fullOnExperiment: {
        description: 'Set experiment to full-on mode (100% traffic to winning variant)',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'variant', type: 'number', required: false, description: 'Variant index for full-on' },
        ],
        returns: 'Full-on result',
        dangerous: true,
      },
      cloneExperiment: {
        description: 'Clone an experiment with optional modifications',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Source experiment ID' },
          { name: 'name', type: 'string', required: true, description: 'Name for the cloned experiment' },
          { name: 'displayName', type: 'string', required: false, description: 'Display name for the clone' },
          { name: 'state', type: 'string', required: false, description: 'Initial state (created, ready)' },
          { name: 'defaultType', type: 'string', required: false, description: 'Default experiment type' },
          { name: 'apiEndpoint', type: 'string', required: false, description: 'API endpoint (auto-filled)' },
        ],
        returns: 'Cloned experiment with new ID',
      },
      diffExperimentsCore: {
        description: 'Compare two experiments and show differences',
        params: [
          { name: 'experimentId1', type: 'number', required: true, description: 'First experiment ID' },
          { name: 'experimentId2', type: 'number', required: false, description: 'Second experiment ID' },
          { name: 'iteration', type: 'number', required: false, description: 'Compare with iteration number' },
        ],
        returns: 'Array of differences between experiments',
      },
      exportExperiment: {
        description: 'Export experiment data',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'format', type: 'string', required: false, description: 'Export format' },
        ],
        returns: 'Exported experiment data',
      },
      generateTemplate: {
        description: 'Generate a markdown template from an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'apiEndpoint', type: 'string', required: false, description: 'API endpoint (auto-filled)' },
        ],
        returns: 'Markdown template string',
      },
      estimateParticipants: {
        description: 'Estimate required participants for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Participant estimation data',
      },
      getParentExperiment: {
        description: 'Get the parent experiment of an iteration',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Parent experiment data',
      },
      requestUpdate: {
        description: 'Request a data update for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'tasks', type: 'array', required: false, description: 'Tasks to request (e.g. update_data, sample_size)' },
        ],
        returns: 'Update request result',
      },
      followExperiment: {
        description: 'Follow an experiment to receive notifications',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Follow result',
      },
      unfollowExperiment: {
        description: 'Unfollow an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Unfollow result',
      },
      // Experiment metrics
      listExperimentMetrics: {
        description: 'List metrics attached to an experiment with their results',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of experiment metrics with results',
      },
      getMetricResults: {
        description: 'Get detailed metric results for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Detailed metric results with statistical data',
      },
      addExperimentMetrics: {
        description: 'Add metrics to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'metrics', type: 'array', required: true, description: 'Array of { metric_id, type } objects' },
        ],
        returns: 'Updated experiment metrics',
      },
      confirmMetricImpact: {
        description: 'Confirm expected metric impact direction',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'impact', type: 'string', required: true, description: 'Expected impact direction' },
        ],
        returns: 'Confirmation result',
      },
      excludeExperimentMetric: {
        description: 'Exclude a metric from experiment analysis',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Exclusion result',
      },
      includeExperimentMetric: {
        description: 'Re-include a previously excluded metric',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Inclusion result',
      },
      removeMetricImpact: {
        description: 'Remove metric impact confirmation',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Removal result',
      },
      // Experiment activity/notes
      listExperimentActivity: {
        description: 'List activity and notes for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of activity entries',
      },
      createExperimentNote: {
        description: 'Add a note to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'text', type: 'string', required: true, description: 'Note text' },
        ],
        returns: 'Created note',
      },
      editExperimentNote: {
        description: 'Edit an existing experiment note',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'noteId', type: 'number', required: true, description: 'Note ID' },
          { name: 'text', type: 'string', required: true, description: 'Updated note text' },
        ],
        returns: 'Updated note',
      },
      replyToExperimentNote: {
        description: 'Reply to an experiment note',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'noteId', type: 'number', required: true, description: 'Note ID to reply to' },
          { name: 'text', type: 'string', required: true, description: 'Reply text' },
        ],
        returns: 'Created reply',
      },
      // Experiment alerts
      listExperimentAlerts: {
        description: 'List alerts for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of alerts',
      },
      dismissAlert: {
        description: 'Dismiss an experiment alert',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'alertId', type: 'number', required: true, description: 'Alert ID' },
        ],
        returns: 'Dismissal result',
      },
      listRecommendedActions: {
        description: 'List recommended actions for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of recommended actions',
      },
      dismissRecommendedAction: {
        description: 'Dismiss a recommended action',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'actionId', type: 'number', required: true, description: 'Action ID' },
        ],
        returns: 'Dismissal result',
      },
      // Scheduled actions
      createScheduledAction: {
        description: 'Schedule an action for an experiment (e.g., auto-stop)',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'action', type: 'string', required: true, description: 'Action type (stop, full_on, etc.)' },
          { name: 'scheduledAt', type: 'string', required: true, description: 'ISO timestamp for scheduled execution' },
        ],
        returns: 'Created scheduled action',
      },
      deleteScheduledAction: {
        description: 'Delete a scheduled action',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'actionId', type: 'number', required: true, description: 'Scheduled action ID' },
        ],
        returns: 'Deletion result',
        dangerous: true,
      },
      // Experiment access
      listExperimentAccessUsers: {
        description: 'List users with access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of user access entries',
      },
      grantExperimentAccessUser: {
        description: 'Grant user access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'userId', type: 'number', required: true, description: 'User ID' },
          { name: 'role', type: 'string', required: false, description: 'Access role' },
        ],
        returns: 'Grant result',
      },
      revokeExperimentAccessUser: {
        description: 'Revoke user access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'userId', type: 'number', required: true, description: 'User ID' },
        ],
        returns: 'Revocation result',
      },
      listExperimentAccessTeams: {
        description: 'List teams with access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of team access entries',
      },
      grantExperimentAccessTeam: {
        description: 'Grant team access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
          { name: 'role', type: 'string', required: false, description: 'Access role' },
        ],
        returns: 'Grant result',
      },
      revokeExperimentAccessTeam: {
        description: 'Revoke team access to an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
        ],
        returns: 'Revocation result',
      },
      // Annotations
      listAnnotations: {
        description: 'List annotations for an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
        ],
        returns: 'Array of annotations',
      },
      createAnnotation: {
        description: 'Create an annotation on an experiment',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'data', type: 'object', required: true, description: 'Annotation data: { text, ... }' },
        ],
        returns: 'Created annotation',
      },
      updateAnnotation: {
        description: 'Update an annotation',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'annotationId', type: 'number', required: true, description: 'Annotation ID' },
          { name: 'data', type: 'object', required: true, description: 'Updated annotation data' },
        ],
        returns: 'Updated annotation',
      },
      archiveAnnotation: {
        description: 'Archive an annotation',
        params: [
          { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
          { name: 'annotationId', type: 'number', required: true, description: 'Annotation ID' },
        ],
        returns: 'Archive result',
        dangerous: true,
      },
      // Bulk operations
      bulkStart: {
        description: 'Start multiple experiments at once',
        params: [
          { name: 'ids', type: 'array', required: true, description: 'Array of experiment IDs' },
        ],
        returns: 'Bulk operation results',
        dangerous: true,
      },
      bulkStop: {
        description: 'Stop multiple experiments at once',
        params: [
          { name: 'ids', type: 'array', required: true, description: 'Array of experiment IDs' },
        ],
        returns: 'Bulk operation results',
        dangerous: true,
      },
      bulkArchive: {
        description: 'Archive multiple experiments at once',
        params: [
          { name: 'ids', type: 'array', required: true, description: 'Array of experiment IDs' },
        ],
        returns: 'Bulk operation results',
        dangerous: true,
      },
      bulkDevelopment: {
        description: 'Put multiple experiments into development mode',
        params: [
          { name: 'ids', type: 'array', required: true, description: 'Array of experiment IDs' },
        ],
        returns: 'Bulk operation results',
        dangerous: true,
      },
      bulkFullOn: {
        description: 'Set multiple experiments to full-on mode',
        params: [
          { name: 'ids', type: 'array', required: true, description: 'Array of experiment IDs' },
        ],
        returns: 'Bulk operation results',
        dangerous: true,
      },
      // Custom fields (experiment-level)
      listCustomFields: {
        description: 'List custom fields for experiments',
        params: [],
        returns: 'Array of custom field definitions',
      },
      getCustomField: {
        description: 'Get a custom field definition',
        params: [
          { name: 'fieldId', type: 'number', required: true, description: 'Custom field ID' },
        ],
        returns: 'Custom field definition',
      },
      createCustomField: {
        description: 'Create a custom field for experiments',
        params: [
          { name: 'data', type: 'object', required: true, description: 'Custom field data' },
        ],
        returns: 'Created custom field',
      },
      updateCustomField: {
        description: 'Update a custom field',
        params: [
          { name: 'fieldId', type: 'number', required: true, description: 'Custom field ID' },
          { name: 'data', type: 'object', required: true, description: 'Updated field data' },
        ],
        returns: 'Updated custom field',
      },
      archiveCustomField: {
        description: 'Archive a custom field',
        params: [
          { name: 'fieldId', type: 'number', required: true, description: 'Custom field ID' },
        ],
        returns: 'Archive result',
        dangerous: true,
      },
      refreshFields: {
        description: 'Refresh custom fields cache for experiments',
        params: [],
        returns: 'Refresh result',
      },
    },
  },

  metrics: {
    description: 'Metric definitions and review workflows',
    commands: {
      listMetrics: {
        description: 'List metrics with filtering and pagination',
        params: [
          { name: 'items', type: 'number', required: false, description: 'Results per page (default: 20)' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default: 1)' },
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'archived', type: 'boolean', required: false, description: 'Include archived metrics' },
          { name: 'include_drafts', type: 'boolean', required: false, description: 'Include draft metrics' },
          { name: 'owners', type: 'string', required: false, description: 'Filter by owner IDs (comma-separated)' },
          { name: 'teams', type: 'string', required: false, description: 'Filter by team IDs (comma-separated)' },
          { name: 'reviewStatus', type: 'string', required: false, description: 'Filter by review status' },
        ],
        returns: 'Array of metric summaries',
      },
      getMetric: {
        description: 'Get detailed metric information',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Metric details',
      },
      createMetric: {
        description: 'Create a new metric',
        params: [
          { name: 'data', type: 'object', required: true, description: 'Metric data: { name, description, ... }' },
        ],
        returns: 'Created metric',
      },
      updateMetric: {
        description: 'Update a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'data', type: 'object', required: true, description: 'Fields to update' },
        ],
        returns: 'Updated metric',
      },
      archiveMetric: {
        description: 'Archive a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Archive result',
        dangerous: true,
      },
      activateMetric: {
        description: 'Activate an archived metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Activation result',
      },
      requestMetricReview: {
        description: 'Request a review for a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Review request result',
      },
      getMetricReview: {
        description: 'Get the current review status for a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Metric review details',
      },
      approveMetricReview: {
        description: 'Approve a metric review',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Approval result',
      },
      listMetricReviewComments: {
        description: 'List comments on a metric review',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
        ],
        returns: 'Array of review comments',
      },
      addMetricReviewComment: {
        description: 'Add a comment to a metric review',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'text', type: 'string', required: true, description: 'Comment text' },
        ],
        returns: 'Created comment',
      },
      replyToMetricReviewComment: {
        description: 'Reply to a metric review comment',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'commentId', type: 'number', required: true, description: 'Comment ID to reply to' },
          { name: 'text', type: 'string', required: true, description: 'Reply text' },
        ],
        returns: 'Created reply',
      },
      followMetric: {
        description: 'Follow a metric',
        params: [{ name: 'metricId', type: 'number', required: true, description: 'Metric ID' }],
        returns: 'Follow result',
      },
      unfollowMetric: {
        description: 'Unfollow a metric',
        params: [{ name: 'metricId', type: 'number', required: true, description: 'Metric ID' }],
        returns: 'Unfollow result',
      },
      listMetricAccessUsers: {
        description: 'List users with access to a metric',
        params: [{ name: 'metricId', type: 'number', required: true, description: 'Metric ID' }],
        returns: 'Array of user access entries',
      },
      grantMetricAccessUser: {
        description: 'Grant user access to a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'userId', type: 'number', required: true, description: 'User ID' },
        ],
        returns: 'Grant result',
      },
      revokeMetricAccessUser: {
        description: 'Revoke user access to a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'userId', type: 'number', required: true, description: 'User ID' },
        ],
        returns: 'Revocation result',
      },
      listMetricAccessTeams: {
        description: 'List teams with access to a metric',
        params: [{ name: 'metricId', type: 'number', required: true, description: 'Metric ID' }],
        returns: 'Array of team access entries',
      },
      grantMetricAccessTeam: {
        description: 'Grant team access to a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
        ],
        returns: 'Grant result',
      },
      revokeMetricAccessTeam: {
        description: 'Revoke team access to a metric',
        params: [
          { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
          { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
        ],
        returns: 'Revocation result',
      },
    },
  },

  goals: {
    description: 'Goal definitions and access management',
    commands: {
      listGoals: { description: 'List goals', params: [{ name: 'items', type: 'number', required: false, description: 'Results per page' }, { name: 'page', type: 'number', required: false, description: 'Page number' }], returns: 'Array of goal summaries' },
      getGoal: { description: 'Get goal details', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }], returns: 'Goal details' },
      createGoal: { description: 'Create a goal', params: [{ name: 'data', type: 'object', required: true, description: 'Goal data' }], returns: 'Created goal' },
      updateGoal: { description: 'Update a goal', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated goal' },
      followGoal: { description: 'Follow a goal', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }], returns: 'Follow result' },
      unfollowGoal: { description: 'Unfollow a goal', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }], returns: 'Unfollow result' },
      listGoalAccessUsers: { description: 'List users with goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }], returns: 'Array of user access entries' },
      grantGoalAccessUser: { description: 'Grant user goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }, { name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'Grant result' },
      revokeGoalAccessUser: { description: 'Revoke user goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }, { name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'Revocation result' },
      listGoalAccessTeams: { description: 'List teams with goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }], returns: 'Array of team access entries' },
      grantGoalAccessTeam: { description: 'Grant team goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }, { name: 'teamId', type: 'number', required: true, description: 'Team ID' }], returns: 'Grant result' },
      revokeGoalAccessTeam: { description: 'Revoke team goal access', params: [{ name: 'goalId', type: 'number', required: true, description: 'Goal ID' }, { name: 'teamId', type: 'number', required: true, description: 'Team ID' }], returns: 'Revocation result' },
    },
  },

  segments: {
    description: 'Audience segment management',
    commands: {
      listSegments: { description: 'List segments', params: [{ name: 'items', type: 'number', required: false, description: 'Results per page' }, { name: 'page', type: 'number', required: false, description: 'Page number' }], returns: 'Array of segment summaries' },
      getSegment: { description: 'Get segment details', params: [{ name: 'segmentId', type: 'number', required: true, description: 'Segment ID' }], returns: 'Segment details' },
      createSegment: { description: 'Create a segment', params: [{ name: 'data', type: 'object', required: true, description: 'Segment data' }], returns: 'Created segment' },
      updateSegment: { description: 'Update a segment', params: [{ name: 'segmentId', type: 'number', required: true, description: 'Segment ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated segment' },
      deleteSegment: { description: 'Delete a segment', params: [{ name: 'segmentId', type: 'number', required: true, description: 'Segment ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  teams: {
    description: 'Team management and membership',
    commands: {
      listTeams: { description: 'List teams', params: [{ name: 'items', type: 'number', required: false, description: 'Results per page' }, { name: 'page', type: 'number', required: false, description: 'Page number' }], returns: 'Array of team summaries' },
      getTeam: { description: 'Get team details', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }], returns: 'Team details' },
      createTeam: { description: 'Create a team', params: [{ name: 'data', type: 'object', required: true, description: 'Team data: { name, description }' }], returns: 'Created team' },
      updateTeam: { description: 'Update a team', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated team' },
      archiveTeam: { description: 'Archive a team', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }], returns: 'Archive result', dangerous: true },
      listTeamMembers: { description: 'List team members', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }], returns: 'Array of team members' },
      addTeamMembers: { description: 'Add members to a team', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }, { name: 'userIds', type: 'array', required: true, description: 'Array of user IDs' }], returns: 'Updated membership' },
      removeTeamMembers: { description: 'Remove members from a team', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }, { name: 'userIds', type: 'array', required: true, description: 'Array of user IDs' }], returns: 'Updated membership', dangerous: true },
      editTeamMemberRoles: { description: 'Edit team member roles', params: [{ name: 'teamId', type: 'number', required: true, description: 'Team ID' }, { name: 'userId', type: 'number', required: true, description: 'User ID' }, { name: 'roles', type: 'array', required: true, description: 'New roles' }], returns: 'Updated member roles' },
    },
  },

  users: {
    description: 'User management and API keys',
    commands: {
      listUsers: { description: 'List users', params: [{ name: 'items', type: 'number', required: false, description: 'Results per page' }, { name: 'page', type: 'number', required: false, description: 'Page number' }], returns: 'Array of user summaries' },
      getUser: { description: 'Get user details', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'User details' },
      createUser: { description: 'Create a user', params: [{ name: 'data', type: 'object', required: true, description: 'User data: { email, first_name, last_name, ... }' }], returns: 'Created user' },
      updateUser: { description: 'Update a user', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated user' },
      archiveUser: { description: 'Archive a user', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'Archive result', dangerous: true },
      resetUserPassword: { description: 'Reset a user password', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'Reset result', dangerous: true },
      listUserApiKeys: { description: 'List API keys for a user', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }], returns: 'Array of API keys' },
      createUserApiKey: { description: 'Create an API key for a user', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }, { name: 'data', type: 'object', required: false, description: 'Key data' }], returns: 'Created API key' },
      deleteUserApiKey: { description: 'Delete a user API key', params: [{ name: 'userId', type: 'number', required: true, description: 'User ID' }, { name: 'keyId', type: 'number', required: true, description: 'API key ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  apps: {
    description: 'Application management',
    commands: {
      listApps: { description: 'List applications', params: [], returns: 'Array of applications' },
      getApp: { description: 'Get application details', params: [{ name: 'appId', type: 'number', required: true, description: 'Application ID' }], returns: 'Application details' },
      createApp: { description: 'Create an application', params: [{ name: 'data', type: 'object', required: true, description: 'App data: { name }' }], returns: 'Created application' },
      updateApp: { description: 'Update an application', params: [{ name: 'appId', type: 'number', required: true, description: 'Application ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated application' },
      archiveApp: { description: 'Archive an application', params: [{ name: 'appId', type: 'number', required: true, description: 'Application ID' }], returns: 'Archive result', dangerous: true },
    },
  },

  envs: {
    description: 'Environment management',
    commands: {
      listEnvs: { description: 'List environments', params: [], returns: 'Array of environments' },
      getEnv: { description: 'Get environment details', params: [{ name: 'envId', type: 'number', required: true, description: 'Environment ID' }], returns: 'Environment details' },
      createEnv: { description: 'Create an environment', params: [{ name: 'data', type: 'object', required: true, description: 'Environment data' }], returns: 'Created environment' },
      updateEnv: { description: 'Update an environment', params: [{ name: 'envId', type: 'number', required: true, description: 'Environment ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated environment' },
      archiveEnv: { description: 'Archive an environment', params: [{ name: 'envId', type: 'number', required: true, description: 'Environment ID' }], returns: 'Archive result', dangerous: true },
    },
  },

  units: {
    description: 'Unit type management',
    commands: {
      listUnits: { description: 'List unit types', params: [], returns: 'Array of unit types' },
      getUnit: { description: 'Get unit type details', params: [{ name: 'unitId', type: 'number', required: true, description: 'Unit type ID' }], returns: 'Unit type details' },
      createUnit: { description: 'Create a unit type', params: [{ name: 'data', type: 'object', required: true, description: 'Unit type data' }], returns: 'Created unit type' },
      updateUnit: { description: 'Update a unit type', params: [{ name: 'unitId', type: 'number', required: true, description: 'Unit type ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated unit type' },
      archiveUnit: { description: 'Archive a unit type', params: [{ name: 'unitId', type: 'number', required: true, description: 'Unit type ID' }], returns: 'Archive result', dangerous: true },
    },
  },

  tags: {
    description: 'Experiment tag management',
    commands: {
      listTags: { description: 'List experiment tags', params: [], returns: 'Array of tags' },
      getTag: { description: 'Get tag details', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Tag details' },
      createTag: { description: 'Create a tag', params: [{ name: 'data', type: 'object', required: true, description: 'Tag data: { name }' }], returns: 'Created tag' },
      updateTag: { description: 'Update a tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated tag' },
      deleteTag: { description: 'Delete a tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  goaltags: {
    description: 'Goal tag management',
    commands: {
      listGoalTags: { description: 'List goal tags', params: [], returns: 'Array of goal tags' },
      getGoalTag: { description: 'Get goal tag details', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Goal tag details' },
      createGoalTag: { description: 'Create a goal tag', params: [{ name: 'data', type: 'object', required: true, description: 'Tag data' }], returns: 'Created goal tag' },
      updateGoalTag: { description: 'Update a goal tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated goal tag' },
      deleteGoalTag: { description: 'Delete a goal tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  metrictags: {
    description: 'Metric tag management',
    commands: {
      listMetricTags: { description: 'List metric tags', params: [], returns: 'Array of metric tags' },
      getMetricTag: { description: 'Get metric tag details', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Metric tag details' },
      createMetricTag: { description: 'Create a metric tag', params: [{ name: 'data', type: 'object', required: true, description: 'Tag data' }], returns: 'Created metric tag' },
      updateMetricTag: { description: 'Update a metric tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated metric tag' },
      deleteMetricTag: { description: 'Delete a metric tag', params: [{ name: 'tagId', type: 'number', required: true, description: 'Tag ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  metriccategories: {
    description: 'Metric category management',
    commands: {
      listMetricCategories: { description: 'List metric categories', params: [], returns: 'Array of metric categories' },
      getMetricCategory: { description: 'Get metric category details', params: [{ name: 'categoryId', type: 'number', required: true, description: 'Category ID' }], returns: 'Category details' },
      createMetricCategory: { description: 'Create a metric category', params: [{ name: 'data', type: 'object', required: true, description: 'Category data' }], returns: 'Created category' },
      updateMetricCategory: { description: 'Update a metric category', params: [{ name: 'categoryId', type: 'number', required: true, description: 'Category ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated category' },
      archiveMetricCategory: { description: 'Archive a metric category', params: [{ name: 'categoryId', type: 'number', required: true, description: 'Category ID' }], returns: 'Archive result', dangerous: true },
    },
  },

  auth: {
    description: 'Authentication and current user operations',
    commands: {
      whoami: { description: 'Get current authenticated user info', params: [], returns: 'Current user details' },
      listAuthApiKeys: { description: 'List your API keys', params: [], returns: 'Array of API keys' },
      getAuthApiKey: { description: 'Get one of your API keys', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }], returns: 'API key details' },
      createAuthApiKey: { description: 'Create an API key for yourself', params: [{ name: 'data', type: 'object', required: false, description: 'Key data' }], returns: 'Created API key' },
      updateAuthApiKey: { description: 'Update one of your API keys', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated API key' },
      deleteAuthApiKey: { description: 'Delete one of your API keys', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }], returns: 'Deletion result', dangerous: true },
      resetMyPassword: { description: 'Reset your own password', params: [], returns: 'Reset result', dangerous: true },
    },
  },

  apikeys: {
    description: 'Platform API key management (admin)',
    commands: {
      listApiKeys: { description: 'List all API keys', params: [], returns: 'Array of API keys' },
      getApiKey: { description: 'Get API key details', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }], returns: 'API key details' },
      createApiKey: { description: 'Create an API key', params: [{ name: 'data', type: 'object', required: true, description: 'Key data' }], returns: 'Created API key' },
      updateApiKey: { description: 'Update an API key', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated API key' },
      deleteApiKey: { description: 'Delete an API key', params: [{ name: 'keyId', type: 'number', required: true, description: 'API key ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  webhooks: {
    description: 'Webhook management',
    commands: {
      listWebhooks: { description: 'List webhooks', params: [], returns: 'Array of webhooks' },
      getWebhook: { description: 'Get webhook details', params: [{ name: 'webhookId', type: 'number', required: true, description: 'Webhook ID' }], returns: 'Webhook details' },
      createWebhook: { description: 'Create a webhook', params: [{ name: 'data', type: 'object', required: true, description: 'Webhook data: { url, events, ... }' }], returns: 'Created webhook' },
      updateWebhook: { description: 'Update a webhook', params: [{ name: 'webhookId', type: 'number', required: true, description: 'Webhook ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated webhook' },
      deleteWebhook: { description: 'Delete a webhook', params: [{ name: 'webhookId', type: 'number', required: true, description: 'Webhook ID' }], returns: 'Deletion result', dangerous: true },
      listWebhookEvents: { description: 'List available webhook event types', params: [], returns: 'Array of event types' },
    },
  },

  roles: {
    description: 'Role management',
    commands: {
      listRoles: { description: 'List roles', params: [], returns: 'Array of roles' },
      getRole: { description: 'Get role details', params: [{ name: 'roleId', type: 'number', required: true, description: 'Role ID' }], returns: 'Role details' },
      createRole: { description: 'Create a role', params: [{ name: 'data', type: 'object', required: true, description: 'Role data' }], returns: 'Created role' },
      updateRole: { description: 'Update a role', params: [{ name: 'roleId', type: 'number', required: true, description: 'Role ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated role' },
      deleteRole: { description: 'Delete a role', params: [{ name: 'roleId', type: 'number', required: true, description: 'Role ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  permissions: {
    description: 'Permission and access control policy management',
    commands: {
      listPermissions: { description: 'List all permissions', params: [], returns: 'Array of permissions' },
      listPermissionCategories: { description: 'List permission categories', params: [], returns: 'Array of permission categories' },
      listAccessControlPolicies: { description: 'List access control policies', params: [], returns: 'Array of access control policies' },
    },
  },

  assetroles: {
    description: 'Asset role management',
    commands: {
      listAssetRoles: { description: 'List asset roles', params: [], returns: 'Array of asset roles' },
      getAssetRole: { description: 'Get asset role details', params: [{ name: 'roleId', type: 'number', required: true, description: 'Asset role ID' }], returns: 'Asset role details' },
      createAssetRole: { description: 'Create an asset role', params: [{ name: 'data', type: 'object', required: true, description: 'Asset role data' }], returns: 'Created asset role' },
      updateAssetRole: { description: 'Update an asset role', params: [{ name: 'roleId', type: 'number', required: true, description: 'Asset role ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated asset role' },
      deleteAssetRole: { description: 'Delete an asset role', params: [{ name: 'roleId', type: 'number', required: true, description: 'Asset role ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  notifications: {
    description: 'Notification management',
    commands: {
      listNotifications: { description: 'List notifications', params: [], returns: 'Array of notifications' },
      checkNotifications: { description: 'Check for new notifications', params: [], returns: 'Notification status' },
      markNotificationsSeen: { description: 'Mark notifications as seen', params: [], returns: 'Mark result' },
      markNotificationsRead: { description: 'Mark notifications as read', params: [], returns: 'Mark result' },
    },
  },

  favorites: {
    description: 'Favorite and follow management',
    commands: {
      addFavorite: { description: 'Add an entity to favorites', params: [{ name: 'entityType', type: 'string', required: true, description: 'Entity type (experiment, metric, goal)' }, { name: 'entityId', type: 'number', required: true, description: 'Entity ID' }], returns: 'Favorite result' },
      removeFavorite: { description: 'Remove an entity from favorites', params: [{ name: 'entityType', type: 'string', required: true, description: 'Entity type' }, { name: 'entityId', type: 'number', required: true, description: 'Entity ID' }], returns: 'Removal result' },
    },
  },

  insights: {
    description: 'Analytics insights',
    commands: {
      getVelocityInsights: { description: 'Get experiment velocity insights', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Velocity insights data' },
      getVelocityInsightsDetail: { description: 'Get detailed velocity insights', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Detailed velocity data' },
      getDecisionInsights: { description: 'Get decision-making insights', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Decision insights data' },
      getDecisionInsightsHistory: { description: 'Get decision insights history', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Decision insights history' },
    },
  },

  cors: {
    description: 'CORS origin management',
    commands: {
      listCorsOrigins: { description: 'List CORS origins', params: [], returns: 'Array of CORS origins' },
      getCorsOrigin: { description: 'Get CORS origin details', params: [{ name: 'originId', type: 'number', required: true, description: 'Origin ID' }], returns: 'CORS origin details' },
      createCorsOrigin: { description: 'Create a CORS origin', params: [{ name: 'data', type: 'object', required: true, description: 'Origin data: { origin }' }], returns: 'Created origin' },
      updateCorsOrigin: { description: 'Update a CORS origin', params: [{ name: 'originId', type: 'number', required: true, description: 'Origin ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated origin' },
      deleteCorsOrigin: { description: 'Delete a CORS origin', params: [{ name: 'originId', type: 'number', required: true, description: 'Origin ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  datasources: {
    description: 'Data source management',
    commands: {
      listDatasources: { description: 'List data sources', params: [], returns: 'Array of data sources' },
      getDatasource: { description: 'Get data source details', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }], returns: 'Datasource details' },
      createDatasource: { description: 'Create a data source', params: [{ name: 'data', type: 'object', required: true, description: 'Datasource config' }], returns: 'Created datasource' },
      updateDatasource: { description: 'Update a data source', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated datasource' },
      archiveDatasource: { description: 'Archive a data source', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }], returns: 'Archive result', dangerous: true },
      testDatasource: { description: 'Test a data source connection', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }], returns: 'Test result' },
      introspectDatasource: { description: 'Introspect a data source schema', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }], returns: 'Schema information' },
      validateDatasourceQuery: { description: 'Validate a datasource query', params: [{ name: 'datasourceId', type: 'number', required: true, description: 'Datasource ID' }, { name: 'query', type: 'string', required: true, description: 'SQL query to validate' }], returns: 'Validation result' },
    },
  },

  exportconfigs: {
    description: 'Export configuration management',
    commands: {
      listExportConfigs: { description: 'List export configurations', params: [], returns: 'Array of export configs' },
      getExportConfig: { description: 'Get export config details', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Export config details' },
      createExportConfig: { description: 'Create an export configuration', params: [{ name: 'data', type: 'object', required: true, description: 'Export config data' }], returns: 'Created export config' },
      updateExportConfig: { description: 'Update an export configuration', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated export config' },
      archiveExportConfig: { description: 'Archive an export configuration', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Archive result', dangerous: true },
      pauseExportConfig: { description: 'Pause an export configuration', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Pause result' },
      listExportHistories: { description: 'List export history for a config', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Array of export history entries' },
    },
  },

  updateschedules: {
    description: 'Data update schedule management',
    commands: {
      listUpdateSchedules: { description: 'List update schedules', params: [], returns: 'Array of update schedules' },
      getUpdateSchedule: { description: 'Get update schedule details', params: [{ name: 'scheduleId', type: 'number', required: true, description: 'Schedule ID' }], returns: 'Schedule details' },
      createUpdateSchedule: { description: 'Create an update schedule', params: [{ name: 'data', type: 'object', required: true, description: 'Schedule data' }], returns: 'Created schedule' },
      updateUpdateSchedule: { description: 'Update an update schedule', params: [{ name: 'scheduleId', type: 'number', required: true, description: 'Schedule ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated schedule' },
      deleteUpdateSchedule: { description: 'Delete an update schedule', params: [{ name: 'scheduleId', type: 'number', required: true, description: 'Schedule ID' }], returns: 'Deletion result', dangerous: true },
    },
  },

  customsections: {
    description: 'Custom section management for experiments',
    commands: {
      listCustomSections: { description: 'List custom sections', params: [], returns: 'Array of custom sections' },
      createCustomSection: { description: 'Create a custom section', params: [{ name: 'data', type: 'object', required: true, description: 'Section data' }], returns: 'Created section' },
      updateCustomSection: { description: 'Update a custom section', params: [{ name: 'sectionId', type: 'number', required: true, description: 'Section ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated section' },
      archiveCustomSection: { description: 'Archive a custom section', params: [{ name: 'sectionId', type: 'number', required: true, description: 'Section ID' }], returns: 'Archive result', dangerous: true },
      reorderCustomSections: { description: 'Reorder custom sections', params: [{ name: 'ids', type: 'array', required: true, description: 'Ordered array of section IDs' }], returns: 'Reorder result' },
    },
  },

  platformconfig: {
    description: 'Platform configuration',
    commands: {
      listPlatformConfigs: { description: 'List platform configurations', params: [], returns: 'Array of platform configs' },
      getPlatformConfig: { description: 'Get platform config', params: [{ name: 'configKey', type: 'string', required: true, description: 'Config key' }], returns: 'Config value' },
      updatePlatformConfig: { description: 'Update platform config', params: [{ name: 'configKey', type: 'string', required: true, description: 'Config key' }, { name: 'data', type: 'object', required: true, description: 'New config value' }], returns: 'Updated config', dangerous: true },
    },
  },

  activity: {
    description: 'Activity feed',
    commands: {
      listActivity: { description: 'List activity feed entries', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Array of activity entries' },
    },
  },

  statistics: {
    description: 'Statistical tools',
    commands: {
      getPowerMatrix: { description: 'Get statistical power matrix for experiment design', params: [{ name: 'params', type: 'object', required: true, description: 'Power analysis parameters' }], returns: 'Power matrix data' },
    },
  },

  events: {
    description: 'Event management',
    commands: {
      listEvents: { description: 'List events', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Array of events' },
      listEventsHistory: { description: 'List event history', params: [{ name: 'params', type: 'object', required: false, description: 'Filter parameters' }], returns: 'Array of event history entries' },
    },
  },

  storageconfigs: {
    description: 'Storage configuration management',
    commands: {
      listStorageConfigs: { description: 'List storage configurations', params: [], returns: 'Array of storage configs' },
      getStorageConfig: { description: 'Get storage config details', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Storage config details' },
      createStorageConfig: { description: 'Create a storage configuration', params: [{ name: 'data', type: 'object', required: true, description: 'Storage config data' }], returns: 'Created storage config' },
      updateStorageConfig: { description: 'Update a storage configuration', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated storage config' },
      testStorageConfig: { description: 'Test a storage configuration', params: [{ name: 'configId', type: 'number', required: true, description: 'Config ID' }], returns: 'Test result' },
    },
  },

  actiondialogfields: {
    description: 'Action dialog field configuration',
    commands: {
      listActionDialogFields: { description: 'List action dialog fields', params: [], returns: 'Array of action dialog fields' },
      getActionDialogField: { description: 'Get action dialog field details', params: [{ name: 'fieldId', type: 'number', required: true, description: 'Field ID' }], returns: 'Field details' },
      createActionDialogField: { description: 'Create an action dialog field', params: [{ name: 'data', type: 'object', required: true, description: 'Field data' }], returns: 'Created field' },
      updateActionDialogField: { description: 'Update an action dialog field', params: [{ name: 'fieldId', type: 'number', required: true, description: 'Field ID' }, { name: 'data', type: 'object', required: true, description: 'Updated fields' }], returns: 'Updated field' },
    },
  },
};

// ─── Catalog Query Helpers ──────────────────────────────────────────────────

export const CLI_GROUPS = Object.keys(CATALOG_GROUPS);

export function getGroupSummary(): GroupSummary[] {
  return CLI_GROUPS.map(group => ({
    group,
    description: CATALOG_GROUPS[group].description,
    commands: Object.keys(CATALOG_GROUPS[group].commands),
  }));
}

export function getCommandEntry(group: string, command: string): CommandEntry | undefined {
  const groupDef = CATALOG_GROUPS[group];
  if (!groupDef) return undefined;
  const cmdDef = groupDef.commands[command];
  if (!cmdDef) return undefined;
  return { ...cmdDef, command, group };
}

export function getGroupCommands(group: string): CommandEntry[] {
  const groupDef = CATALOG_GROUPS[group];
  if (!groupDef) return [];
  return Object.entries(groupDef.commands).map(([name, def]) => ({
    ...def,
    command: name,
    group,
  }));
}

export function searchCommands(query: string): CommandEntry[] {
  const q = query.toLowerCase();
  const results: CommandEntry[] = [];
  for (const [group, groupDef] of Object.entries(CATALOG_GROUPS)) {
    if (groupDef.description.toLowerCase().includes(q)) {
      results.push(...getGroupCommands(group));
      continue;
    }
    for (const [name, def] of Object.entries(groupDef.commands)) {
      if (name.toLowerCase().includes(q) || def.description.toLowerCase().includes(q)) {
        results.push({ ...def, command: name, group });
      }
    }
  }
  return results;
}

export function getTotalCommandCount(): number {
  let count = 0;
  for (const groupDef of Object.values(CATALOG_GROUPS)) {
    count += Object.keys(groupDef.commands).length;
  }
  return count;
}

// ─── Command Execution ──────────────────────────────────────────────────────

export async function executeCommand(
  client: APIClient,
  group: string,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const entry = getCommandEntry(group, command);
  if (!entry) {
    throw new Error(`Unknown command: ${group}.${command}`);
  }

  const mod = CORE_MODULES[group];
  if (!mod) {
    throw new Error(`Unknown group: "${group}". Available: ${CLI_GROUPS.join(', ')}`);
  }

  const fn = mod[command];
  if (typeof fn !== 'function') {
    throw new Error(`Function "${command}" not found in core module "${group}". Available: ${Object.keys(mod).filter(k => typeof mod[k] === 'function').join(', ')}`);
  }

  return fn(client, params);
}
