export interface ApiMethodParam {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
}

export interface ApiMethodEntry {
  method: string;
  category: string;
  description: string;
  params: ApiMethodParam[];
  returns: string;
  example?: Record<string, unknown>;
  dangerous?: boolean;
}

export const API_CATEGORIES = [
  'experiments',
  'experiment-metrics',
  'experiment-notes',
  'experiment-alerts',
  'scheduled-actions',
  'experiment-access',
  'goals',
  'segments',
  'metrics',
  'metric-review',
  'metric-access',
  'metric-categories',
  'teams',
  'users',
  'applications',
  'environments',
  'unit-types',
  'tags',
  'roles',
  'webhooks',
  'annotations',
  'insights',
  'api-keys',
  'cors',
  'datasources',
  'export-configs',
  'update-schedules',
  'custom-sections',
  'notifications',
  'follow-favorite',
  'platform-config',
  'asset-roles',
  'access-control-policies',
  'resolve-helpers',
] as const;

export type ApiCategory = typeof API_CATEGORIES[number];

export const API_CATALOG: ApiMethodEntry[] = [
  // --- experiments ---
  {
    method: 'listExperiments',
    category: 'experiments',
    description: 'List experiments with filtering, sorting, and pagination',
    params: [
      { name: 'options', type: 'object', required: false, description: '{ page?, items?, sort?, ascending?, select?, include?, previews?, applications?, application?, status?, state?, type?, unit_types?, owners?, teams?, tags?, templates?, ids?, impact?, confidence?, iterations?, iterations_of?, created_at?, created_after?, created_before?, updated_at?, started_at?, started_after?, started_before?, stopped_at?, stopped_after?, stopped_before?, full_on_at?, analysis_type?, running_type?, search?, alert_srm?, alert_cleanup_needed?, alert_audience_mismatch?, alert_sample_size_reached?, alert_experiments_interact?, alert_group_sequential_updated?, alert_assignment_conflict?, alert_metric_threshold_reached?, significance? }' },
    ],
    returns: 'Array of experiment objects',
  },
  {
    method: 'getExperiment',
    category: 'experiments',
    description: 'Get detailed information about a specific experiment by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Experiment object with full details',
    example: { id: 42 },
  },
  {
    method: 'createExperiment',
    category: 'experiments',
    description: 'Create a new experiment or feature flag. The data object must include all required fields. Use listApplications and listUnitTypes to get valid IDs.',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Experiment data: { name, display_name, type ("test"|"feature"), state ("created"), percentages ("50/50"), percentage_of_traffic (100), audience ("", means 100%), audience_strict (false), nr_variants (2), variants ([{name, variant (0-based index), config ("{}")]}, unit_type ({unit_type_id}), applications ([{application_id, application_version: "0"}]), owners ([]), teams ([]), experiment_tags ([]), secondary_metrics ([]), variant_screenshots ([]), custom_section_field_values ({}) }' },
    ],
    returns: 'Created experiment object with id',
    example: {
      data: {
        name: 'my_experiment',
        display_name: 'My Experiment',
        type: 'test',
        state: 'created',
        percentages: '50/50',
        percentage_of_traffic: 100,
        audience: '',
        audience_strict: false,
        nr_variants: 2,
        variants: [
          { name: 'Control', variant: 0, config: '{}' },
          { name: 'Treatment', variant: 1, config: '{}' },
        ],
        unit_type: { unit_type_id: 1 },
        applications: [{ application_id: 1, application_version: '0' }],
        owners: [],
        teams: [],
        experiment_tags: [],
        secondary_metrics: [],
        variant_screenshots: [],
        custom_section_field_values: {},
      },
    },
  },
  {
    method: 'updateExperiment',
    category: 'experiments',
    description: 'Update an existing experiment. Fetches current state first, then applies changes.',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'changes', type: 'object', required: true, description: 'Fields to update' },
      { name: 'options', type: 'object', required: false, description: '{ note?: string, update_metric_versions?: boolean }' },
    ],
    returns: 'Updated experiment object',
  },
  {
    method: 'deleteExperiment',
    category: 'experiments',
    description: 'Permanently delete an experiment. This is irreversible.',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'startExperiment',
    category: 'experiments',
    description: 'Start an experiment (transition to running state)',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Updated experiment object',
  },
  {
    method: 'stopExperiment',
    category: 'experiments',
    description: 'Stop a running experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for stopping' },
    ],
    returns: 'Updated experiment object',
  },
  {
    method: 'archiveExperiment',
    category: 'experiments',
    description: 'Archive or unarchive an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'getParentExperiment',
    category: 'experiments',
    description: 'Get the parent experiment (for restarted experiments)',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Parent experiment object',
  },
  {
    method: 'developmentExperiment',
    category: 'experiments',
    description: 'Put an experiment into development mode',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'note', type: 'string', required: true, description: 'Note explaining the change' },
    ],
    returns: 'Updated experiment object',
  },
  {
    method: 'restartExperiment',
    category: 'experiments',
    description: 'Restart a stopped experiment with optional changes',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'options', type: 'object', required: false, description: '{ note?, reason?, reshuffle?, state?, restart_as_type?, changes? }' },
    ],
    returns: 'New experiment object (restarted experiments get a new iteration)',
  },
  {
    method: 'fullOnExperiment',
    category: 'experiments',
    description: 'Set experiment to full-on mode (100% traffic to one variant)',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'fullOnVariant', type: 'number', required: true, description: 'Variant number to go full-on with (>= 1)' },
      { name: 'note', type: 'string', required: true, description: 'Note explaining the decision' },
    ],
    returns: 'Updated experiment object',
  },
  {
    method: 'searchExperiments',
    category: 'experiments',
    description: 'Search experiments by name or description',
    params: [
      { name: 'query', type: 'string', required: true, description: 'Search query' },
      { name: 'items', type: 'number', required: false, description: 'Max results (default: 50)' },
    ],
    returns: 'Array of matching experiments',
  },
  {
    method: 'requestExperimentUpdate',
    category: 'experiments',
    description: 'Request a data update for an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'void',
  },
  {
    method: 'exportExperimentData',
    category: 'experiments',
    description: 'Export experiment data',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'void',
  },

  // --- experiment-metrics ---
  {
    method: 'listExperimentMetrics',
    category: 'experiment-metrics',
    description: 'List all metrics attached to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Array of metric objects',
  },
  {
    method: 'getExperimentMetricData',
    category: 'experiment-metrics',
    description: 'Get metric data/results for an experiment',
    params: [
      { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricId', type: 'string', required: true, description: 'Metric ID number or "main" for primary metric' },
    ],
    returns: '{ columnNames: string[], rows: unknown[][] }',
  },
  {
    method: 'addExperimentMetrics',
    category: 'experiment-metrics',
    description: 'Add metrics to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricIds', type: 'array', required: true, description: 'Array of metric IDs to add' },
    ],
    returns: 'void',
  },
  {
    method: 'confirmMetricImpact',
    category: 'experiment-metrics',
    description: 'Confirm that a metric impact on an experiment is expected',
    params: [
      { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'excludeExperimentMetric',
    category: 'experiment-metrics',
    description: 'Exclude a metric from experiment analysis',
    params: [
      { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'includeExperimentMetric',
    category: 'experiment-metrics',
    description: 'Re-include a previously excluded metric',
    params: [
      { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'removeMetricImpact',
    category: 'experiment-metrics',
    description: 'Remove a metric impact confirmation',
    params: [
      { name: 'experimentId', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'metricId', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },

  // --- experiment-notes ---
  {
    method: 'listExperimentActivity',
    category: 'experiment-notes',
    description: 'List activity log and notes for an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Array of activity/note objects',
  },
  {
    method: 'createExperimentNote',
    category: 'experiment-notes',
    description: 'Add a note to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'note', type: 'string', required: true, description: 'Note text' },
    ],
    returns: 'Created note object',
  },
  {
    method: 'editExperimentNote',
    category: 'experiment-notes',
    description: 'Edit an existing experiment note',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'noteId', type: 'number', required: true, description: 'Note ID' },
      { name: 'note', type: 'string', required: true, description: 'Updated note text' },
    ],
    returns: 'Updated note object',
  },
  {
    method: 'replyToExperimentNote',
    category: 'experiment-notes',
    description: 'Reply to an experiment note',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'noteId', type: 'number', required: true, description: 'Note ID to reply to' },
      { name: 'note', type: 'string', required: true, description: 'Reply text' },
    ],
    returns: 'Created reply note object',
  },

  // --- experiment-alerts ---
  {
    method: 'listExperimentAlerts',
    category: 'experiment-alerts',
    description: 'List alerts for an experiment (or all experiments if no ID)',
    params: [
      { name: 'experimentId', type: 'number', required: false, description: 'Experiment ID (optional, omit for all alerts)' },
    ],
    returns: 'Array of alert objects',
  },
  {
    method: 'dismissAlert',
    category: 'experiment-alerts',
    description: 'Dismiss an alert',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Alert ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listRecommendedActions',
    category: 'experiment-alerts',
    description: 'List recommended actions for an experiment',
    params: [
      { name: 'experimentId', type: 'number', required: false, description: 'Experiment ID (optional)' },
    ],
    returns: 'Array of recommended action objects',
  },
  {
    method: 'dismissRecommendedAction',
    category: 'experiment-alerts',
    description: 'Dismiss a recommended action',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Recommended action ID' },
    ],
    returns: 'void',
  },

  // --- scheduled-actions ---
  {
    method: 'createScheduledAction',
    category: 'scheduled-actions',
    description: 'Schedule a future action for an experiment (e.g. auto-stop)',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'action', type: 'string', required: true, description: 'Action to schedule (e.g. stop, full_on)' },
      { name: 'scheduledAt', type: 'string', required: true, description: 'ISO 8601 date when to execute' },
      { name: 'note', type: 'string', required: true, description: 'Note explaining the scheduled action' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for the action' },
    ],
    returns: 'Created scheduled action object',
  },
  {
    method: 'deleteScheduledAction',
    category: 'scheduled-actions',
    description: 'Cancel a scheduled action',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'actionId', type: 'number', required: true, description: 'Scheduled action ID' },
    ],
    returns: 'void',
  },

  // --- experiment-access ---
  {
    method: 'listExperimentAccessUsers',
    category: 'experiment-access',
    description: 'List users with access to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Array of user access objects',
  },
  {
    method: 'grantExperimentAccessUser',
    category: 'experiment-access',
    description: 'Grant a user access to an experiment with a specific role',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeExperimentAccessUser',
    category: 'experiment-access',
    description: "Revoke a user's access to an experiment",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listExperimentAccessTeams',
    category: 'experiment-access',
    description: 'List teams with access to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'Array of team access objects',
  },
  {
    method: 'grantExperimentAccessTeam',
    category: 'experiment-access',
    description: 'Grant a team access to an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeExperimentAccessTeam',
    category: 'experiment-access',
    description: "Revoke a team's access to an experiment",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },

  // --- goals ---
  {
    method: 'listGoals',
    category: 'goals',
    description: 'List all goals with optional pagination',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset for pagination' },
    ],
    returns: 'Array of goal objects',
  },
  {
    method: 'getGoal',
    category: 'goals',
    description: 'Get a specific goal by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
    ],
    returns: 'Goal object',
  },
  {
    method: 'createGoal',
    category: 'goals',
    description: 'Create a new goal',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Goal data with name, description, etc.' },
    ],
    returns: 'Created goal object',
  },
  {
    method: 'updateGoal',
    category: 'goals',
    description: 'Update an existing goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated goal object',
  },
  {
    method: 'listGoalAccessUsers',
    category: 'goals',
    description: 'List users with access to a goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
    ],
    returns: 'Array of user access objects',
  },
  {
    method: 'grantGoalAccessUser',
    category: 'goals',
    description: 'Grant a user access to a goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeGoalAccessUser',
    category: 'goals',
    description: "Revoke a user's access to a goal",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listGoalAccessTeams',
    category: 'goals',
    description: 'List teams with access to a goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
    ],
    returns: 'Array of team access objects',
  },
  {
    method: 'grantGoalAccessTeam',
    category: 'goals',
    description: 'Grant a team access to a goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeGoalAccessTeam',
    category: 'goals',
    description: "Revoke a team's access to a goal",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },

  // --- segments ---
  {
    method: 'listSegments',
    category: 'segments',
    description: 'List all segments with optional pagination',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset for pagination' },
    ],
    returns: 'Array of segment objects',
  },
  {
    method: 'getSegment',
    category: 'segments',
    description: 'Get a specific segment by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Segment ID' },
    ],
    returns: 'Segment object',
  },
  {
    method: 'createSegment',
    category: 'segments',
    description: 'Create a new segment',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Segment data with name, definition, etc.' },
    ],
    returns: 'Created segment object',
  },
  {
    method: 'updateSegment',
    category: 'segments',
    description: 'Update an existing segment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Segment ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated segment object',
  },
  {
    method: 'deleteSegment',
    category: 'segments',
    description: 'Delete a segment permanently',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Segment ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- metrics ---
  {
    method: 'listMetrics',
    category: 'metrics',
    description: 'List metrics with optional filtering',
    params: [
      { name: 'options', type: 'object', required: false, description: '{ items?, page?, archived?, search? }' },
    ],
    returns: 'Array of metric objects',
  },
  {
    method: 'getMetric',
    category: 'metrics',
    description: 'Get a specific metric by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'Metric object with full details',
  },
  {
    method: 'createMetric',
    category: 'metrics',
    description: 'Create a new metric',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Metric data with name, type, query, etc.' },
    ],
    returns: 'Created metric object',
  },
  {
    method: 'updateMetric',
    category: 'metrics',
    description: 'Update an existing metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated metric object',
  },
  {
    method: 'activateMetric',
    category: 'metrics',
    description: 'Activate a metric (make it available for use in experiments)',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'reason', type: 'string', required: true, description: 'Reason for activation' },
    ],
    returns: 'Activated metric object',
  },
  {
    method: 'archiveMetric',
    category: 'metrics',
    description: 'Archive or unarchive a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },

  // --- metric-access ---
  {
    method: 'listMetricAccessUsers',
    category: 'metric-access',
    description: 'List users with access to a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'Array of user access objects',
  },
  {
    method: 'grantMetricAccessUser',
    category: 'metric-access',
    description: 'Grant a user access to a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeMetricAccessUser',
    category: 'metric-access',
    description: "Revoke a user's access to a metric",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'userId', type: 'number', required: true, description: 'User ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listMetricAccessTeams',
    category: 'metric-access',
    description: 'List teams with access to a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'Array of team access objects',
  },
  {
    method: 'grantMetricAccessTeam',
    category: 'metric-access',
    description: 'Grant a team access to a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },
  {
    method: 'revokeMetricAccessTeam',
    category: 'metric-access',
    description: "Revoke a team's access to a metric",
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'teamId', type: 'number', required: true, description: 'Team ID' },
      { name: 'assetRoleId', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
  },

  // --- metric-review ---
  {
    method: 'requestMetricReview',
    category: 'metric-review',
    description: 'Request a review for a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'getMetricReview',
    category: 'metric-review',
    description: 'Get the current review status for a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'Review status object',
  },
  {
    method: 'approveMetricReview',
    category: 'metric-review',
    description: 'Approve a metric review',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listMetricReviewComments',
    category: 'metric-review',
    description: 'List comments on a metric review',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'Array of comment objects',
  },
  {
    method: 'addMetricReviewComment',
    category: 'metric-review',
    description: 'Add a comment to a metric review',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'message', type: 'string', required: true, description: 'Comment text' },
    ],
    returns: 'Created comment object',
  },
  {
    method: 'replyToMetricReviewComment',
    category: 'metric-review',
    description: 'Reply to a comment on a metric review',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'commentId', type: 'number', required: true, description: 'Comment ID to reply to' },
      { name: 'message', type: 'string', required: true, description: 'Reply text' },
    ],
    returns: 'Created reply object',
  },

  // --- metric-categories ---
  {
    method: 'listMetricCategories',
    category: 'metric-categories',
    description: 'List metric categories',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of category objects',
  },
  {
    method: 'getMetricCategory',
    category: 'metric-categories',
    description: 'Get a metric category by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Category ID' },
    ],
    returns: 'Category object',
  },
  {
    method: 'createMetricCategory',
    category: 'metric-categories',
    description: 'Create a new metric category',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, description?: string, color: string }' },
    ],
    returns: 'Created category object',
  },
  {
    method: 'updateMetricCategory',
    category: 'metric-categories',
    description: 'Update a metric category',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Category ID' },
      { name: 'data', type: 'object', required: true, description: '{ name?, description?, color? }' },
    ],
    returns: 'Updated category object',
  },
  {
    method: 'archiveMetricCategory',
    category: 'metric-categories',
    description: 'Archive or unarchive a metric category',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Category ID' },
      { name: 'archive', type: 'boolean', required: false, description: 'Set false to unarchive (default: true)' },
    ],
    returns: 'void',
  },

  // --- teams ---
  {
    method: 'listTeams',
    category: 'teams',
    description: 'List all teams',
    params: [
      { name: 'includeArchived', type: 'boolean', required: false, description: 'Include archived teams (default: false)' },
    ],
    returns: 'Array of team objects',
  },
  {
    method: 'getTeam',
    category: 'teams',
    description: 'Get a team by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
    ],
    returns: 'Team object',
  },
  {
    method: 'createTeam',
    category: 'teams',
    description: 'Create a new team',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Team data with name, description, etc.' },
    ],
    returns: 'Created team object',
  },
  {
    method: 'updateTeam',
    category: 'teams',
    description: 'Update an existing team',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated team object',
  },
  {
    method: 'archiveTeam',
    category: 'teams',
    description: 'Archive or unarchive a team',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'listTeamMembers',
    category: 'teams',
    description: 'List members of a team',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
    ],
    returns: 'Array of user objects',
  },
  {
    method: 'addTeamMembers',
    category: 'teams',
    description: 'Add users to a team',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
      { name: 'userIds', type: 'array', required: true, description: 'Array of user IDs to add' },
      { name: 'roleIds', type: 'array', required: false, description: 'Array of role IDs to assign' },
    ],
    returns: 'void',
  },
  {
    method: 'editTeamMemberRoles',
    category: 'teams',
    description: 'Edit roles for team members',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
      { name: 'userIds', type: 'array', required: true, description: 'Array of user IDs' },
      { name: 'roleIds', type: 'array', required: true, description: 'Array of role IDs to set' },
    ],
    returns: 'void',
  },
  {
    method: 'removeTeamMembers',
    category: 'teams',
    description: 'Remove users from a team',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Team ID' },
      { name: 'userIds', type: 'array', required: true, description: 'Array of user IDs to remove' },
    ],
    returns: 'void',
  },

  // --- users ---
  {
    method: 'listUsers',
    category: 'users',
    description: 'List all users',
    params: [
      { name: 'options', type: 'object', required: false, description: '{ includeArchived?: boolean, search?: string }' },
    ],
    returns: 'Array of user objects',
  },
  {
    method: 'getUser',
    category: 'users',
    description: 'Get a user by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'User ID' },
    ],
    returns: 'User object',
  },
  {
    method: 'createUser',
    category: 'users',
    description: 'Create a new user',
    params: [
      { name: 'data', type: 'object', required: true, description: 'User data with email, first_name, last_name, etc.' },
    ],
    returns: 'Created user object',
  },
  {
    method: 'updateUser',
    category: 'users',
    description: 'Update an existing user',
    params: [
      { name: 'id', type: 'number', required: true, description: 'User ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated user object',
  },
  {
    method: 'archiveUser',
    category: 'users',
    description: 'Archive or unarchive a user',
    params: [
      { name: 'id', type: 'number', required: true, description: 'User ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'resetUserPassword',
    category: 'users',
    description: "Reset a user's password (sends reset email)",
    params: [
      { name: 'id', type: 'number', required: true, description: 'User ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'getCurrentUser',
    category: 'users',
    description: 'Get the currently authenticated user',
    params: [],
    returns: 'Current user object',
  },
  {
    method: 'createUserApiKey',
    category: 'users',
    description: 'Create a new API key for the current user',
    params: [
      { name: 'name', type: 'string', required: true, description: 'API key name' },
      { name: 'description', type: 'string', required: false, description: 'API key description' },
    ],
    returns: '{ id, name, key } — key is only shown once',
    dangerous: true,
  },

  // --- applications ---
  {
    method: 'listApplications',
    category: 'applications',
    description: 'List all applications',
    params: [],
    returns: 'Array of application objects',
  },
  {
    method: 'getApplication',
    category: 'applications',
    description: 'Get an application by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Application ID' },
    ],
    returns: 'Application object',
  },
  {
    method: 'createApplication',
    category: 'applications',
    description: 'Create a new application',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, ... }' },
    ],
    returns: 'Created application object',
  },
  {
    method: 'updateApplication',
    category: 'applications',
    description: 'Update an application',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Application ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated application object',
  },
  {
    method: 'archiveApplication',
    category: 'applications',
    description: 'Archive or unarchive an application',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Application ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },

  // --- environments ---
  {
    method: 'listEnvironments',
    category: 'environments',
    description: 'List all environments',
    params: [],
    returns: 'Array of environment objects',
  },
  {
    method: 'getEnvironment',
    category: 'environments',
    description: 'Get an environment by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Environment ID' },
    ],
    returns: 'Environment object',
  },
  {
    method: 'createEnvironment',
    category: 'environments',
    description: 'Create a new environment',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, ... }' },
    ],
    returns: 'Created environment object',
  },
  {
    method: 'updateEnvironment',
    category: 'environments',
    description: 'Update an environment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Environment ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated environment object',
  },
  {
    method: 'archiveEnvironment',
    category: 'environments',
    description: 'Archive or unarchive an environment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Environment ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },

  // --- unit-types ---
  {
    method: 'listUnitTypes',
    category: 'unit-types',
    description: 'List all unit types',
    params: [],
    returns: 'Array of unit type objects',
  },
  {
    method: 'getUnitType',
    category: 'unit-types',
    description: 'Get a unit type by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Unit type ID' },
    ],
    returns: 'Unit type object',
  },
  {
    method: 'createUnitType',
    category: 'unit-types',
    description: 'Create a new unit type',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, ... }' },
    ],
    returns: 'Created unit type object',
  },
  {
    method: 'updateUnitType',
    category: 'unit-types',
    description: 'Update a unit type',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Unit type ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated unit type object',
  },
  {
    method: 'archiveUnitType',
    category: 'unit-types',
    description: 'Archive or unarchive a unit type',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Unit type ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },

  // --- tags ---
  {
    method: 'listExperimentTags',
    category: 'tags',
    description: 'List experiment tags',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of tag objects',
  },
  {
    method: 'getExperimentTag',
    category: 'tags',
    description: 'Get an experiment tag by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'Tag object',
  },
  {
    method: 'createExperimentTag',
    category: 'tags',
    description: 'Create a new experiment tag',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Created tag object',
  },
  {
    method: 'updateExperimentTag',
    category: 'tags',
    description: 'Update an experiment tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Updated tag object',
  },
  {
    method: 'deleteExperimentTag',
    category: 'tags',
    description: 'Delete an experiment tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'listGoalTags',
    category: 'tags',
    description: 'List goal tags',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of tag objects',
  },
  {
    method: 'getGoalTag',
    category: 'tags',
    description: 'Get a goal tag by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'Tag object',
  },
  {
    method: 'createGoalTag',
    category: 'tags',
    description: 'Create a new goal tag',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Created tag object',
  },
  {
    method: 'updateGoalTag',
    category: 'tags',
    description: 'Update a goal tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Updated tag object',
  },
  {
    method: 'deleteGoalTag',
    category: 'tags',
    description: 'Delete a goal tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'listMetricTags',
    category: 'tags',
    description: 'List metric tags',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of tag objects',
  },
  {
    method: 'getMetricTag',
    category: 'tags',
    description: 'Get a metric tag by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'Tag object',
  },
  {
    method: 'createMetricTag',
    category: 'tags',
    description: 'Create a new metric tag',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Created tag object',
  },
  {
    method: 'updateMetricTag',
    category: 'tags',
    description: 'Update a metric tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
      { name: 'data', type: 'object', required: true, description: '{ tag: string }' },
    ],
    returns: 'Updated tag object',
  },
  {
    method: 'deleteMetricTag',
    category: 'tags',
    description: 'Delete a metric tag',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Tag ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- roles ---
  {
    method: 'listRoles',
    category: 'roles',
    description: 'List all roles',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 20)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of role objects',
  },
  {
    method: 'getRole',
    category: 'roles',
    description: 'Get a role by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Role ID' },
    ],
    returns: 'Role object',
  },
  {
    method: 'createRole',
    category: 'roles',
    description: 'Create a new role',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Role data with name, permissions, etc.' },
    ],
    returns: 'Created role object',
  },
  {
    method: 'updateRole',
    category: 'roles',
    description: 'Update a role',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Role ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated role object',
  },
  {
    method: 'deleteRole',
    category: 'roles',
    description: 'Delete a role',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Role ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'listPermissions',
    category: 'roles',
    description: 'List all available permissions',
    params: [],
    returns: 'Array of permission objects',
  },
  {
    method: 'listPermissionCategories',
    category: 'roles',
    description: 'List permission categories',
    params: [],
    returns: 'Array of permission category objects',
  },

  // --- webhooks ---
  {
    method: 'listWebhooks',
    category: 'webhooks',
    description: 'List all webhooks',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 20)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of webhook objects',
  },
  {
    method: 'getWebhook',
    category: 'webhooks',
    description: 'Get a webhook by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Webhook ID' },
    ],
    returns: 'Webhook object',
  },
  {
    method: 'createWebhook',
    category: 'webhooks',
    description: 'Create a new webhook',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Webhook data with url, events, etc.' },
    ],
    returns: 'Created webhook object',
  },
  {
    method: 'updateWebhook',
    category: 'webhooks',
    description: 'Update a webhook',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Webhook ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated webhook object',
  },
  {
    method: 'deleteWebhook',
    category: 'webhooks',
    description: 'Delete a webhook',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Webhook ID' },
    ],
    returns: 'void',
    dangerous: true,
  },
  {
    method: 'listWebhookEvents',
    category: 'webhooks',
    description: 'List available webhook event types',
    params: [],
    returns: 'Array of event type objects',
  },

  // --- annotations ---
  {
    method: 'listAnnotations',
    category: 'annotations',
    description: 'List annotations, optionally filtered by experiment',
    params: [
      { name: 'experimentId', type: 'number', required: false, description: 'Filter by experiment ID' },
    ],
    returns: 'Array of annotation objects',
  },
  {
    method: 'createAnnotation',
    category: 'annotations',
    description: 'Create an annotation (e.g. deployment marker)',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ experiment_id: number, type?: string, ... }' },
    ],
    returns: 'Created annotation object',
  },
  {
    method: 'updateAnnotation',
    category: 'annotations',
    description: 'Update an annotation',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Annotation ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated annotation object',
  },
  {
    method: 'archiveAnnotation',
    category: 'annotations',
    description: 'Archive or unarchive an annotation',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Annotation ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },

  // --- insights ---
  {
    method: 'getVelocityInsights',
    category: 'insights',
    description: 'Get experimentation velocity insights (how many experiments started/stopped over time)',
    params: [
      { name: 'params', type: 'object', required: true, description: '{ from: number (epoch ms), to: number, aggregation: string (day/week/month), unit_type_ids?: number[], team_ids?: number[], owner_ids?: number[] }' },
    ],
    returns: 'Velocity data object',
  },
  {
    method: 'getDecisionInsights',
    category: 'insights',
    description: 'Get decision insights (experiment outcomes and decision quality)',
    params: [
      { name: 'params', type: 'object', required: true, description: '{ from: number (epoch ms), to: number, aggregation: string (day/week/month), unit_type_ids?: number[], team_ids?: number[], owner_ids?: number[] }' },
    ],
    returns: 'Decision data object',
  },

  // --- api-keys ---
  {
    method: 'listApiKeys',
    category: 'api-keys',
    description: 'List all API keys',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 20)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of API key objects (keys are masked)',
  },
  {
    method: 'getApiKey',
    category: 'api-keys',
    description: 'Get an API key by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'API key ID' },
    ],
    returns: 'API key object',
  },
  {
    method: 'createApiKey',
    category: 'api-keys',
    description: 'Create a new API key',
    params: [
      { name: 'data', type: 'object', required: true, description: 'API key data with name, permissions, etc.' },
    ],
    returns: 'Created API key object (key shown only once)',
    dangerous: true,
  },
  {
    method: 'updateApiKey',
    category: 'api-keys',
    description: 'Update an API key',
    params: [
      { name: 'id', type: 'number', required: true, description: 'API key ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated API key object',
  },
  {
    method: 'deleteApiKey',
    category: 'api-keys',
    description: 'Delete an API key',
    params: [
      { name: 'id', type: 'number', required: true, description: 'API key ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- cors ---
  {
    method: 'listCorsOrigins',
    category: 'cors',
    description: 'List CORS allowed origins',
    params: [],
    returns: 'Array of CORS origin objects',
  },
  {
    method: 'getCorsOrigin',
    category: 'cors',
    description: 'Get a CORS origin by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'CORS origin ID' },
    ],
    returns: 'CORS origin object',
  },
  {
    method: 'createCorsOrigin',
    category: 'cors',
    description: 'Add a CORS allowed origin',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ origin: string }' },
    ],
    returns: 'Created origin object',
  },
  {
    method: 'updateCorsOrigin',
    category: 'cors',
    description: 'Update a CORS origin',
    params: [
      { name: 'id', type: 'number', required: true, description: 'CORS origin ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated origin object',
  },
  {
    method: 'deleteCorsOrigin',
    category: 'cors',
    description: 'Delete a CORS origin',
    params: [
      { name: 'id', type: 'number', required: true, description: 'CORS origin ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- datasources ---
  {
    method: 'listDatasources',
    category: 'datasources',
    description: 'List all datasources',
    params: [],
    returns: 'Array of datasource objects',
  },
  {
    method: 'getDatasource',
    category: 'datasources',
    description: 'Get a datasource by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Datasource ID' },
    ],
    returns: 'Datasource object',
  },
  {
    method: 'createDatasource',
    category: 'datasources',
    description: 'Create a new datasource',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Datasource config data' },
    ],
    returns: 'Created datasource object',
  },
  {
    method: 'updateDatasource',
    category: 'datasources',
    description: 'Update a datasource',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Datasource ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated datasource object',
  },
  {
    method: 'archiveDatasource',
    category: 'datasources',
    description: 'Archive or unarchive a datasource',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Datasource ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'testDatasource',
    category: 'datasources',
    description: 'Test a datasource connection',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Datasource config to test' },
    ],
    returns: 'void (throws on failure)',
  },
  {
    method: 'introspectDatasource',
    category: 'datasources',
    description: 'Introspect a datasource to discover its schema',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Datasource config to introspect' },
    ],
    returns: 'Schema information object',
  },
  {
    method: 'validateDatasourceQuery',
    category: 'datasources',
    description: 'Validate a query against a datasource',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Query and datasource config' },
    ],
    returns: 'void (throws on failure)',
  },

  // --- export-configs ---
  {
    method: 'listExportConfigs',
    category: 'export-configs',
    description: 'List all export configurations',
    params: [],
    returns: 'Array of export config objects',
  },
  {
    method: 'getExportConfig',
    category: 'export-configs',
    description: 'Get an export config by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Export config ID' },
    ],
    returns: 'Export config object',
  },
  {
    method: 'createExportConfig',
    category: 'export-configs',
    description: 'Create a new export config',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Export config data' },
    ],
    returns: 'Created export config object',
  },
  {
    method: 'updateExportConfig',
    category: 'export-configs',
    description: 'Update an export config',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Export config ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated export config object',
  },
  {
    method: 'archiveExportConfig',
    category: 'export-configs',
    description: 'Archive or unarchive an export config',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Export config ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'pauseExportConfig',
    category: 'export-configs',
    description: 'Pause an export config',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Export config ID' },
    ],
    returns: 'void',
  },
  {
    method: 'listExportHistories',
    category: 'export-configs',
    description: 'List export history for an export config',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Export config ID' },
    ],
    returns: 'Array of export history objects',
  },

  // --- update-schedules ---
  {
    method: 'listUpdateSchedules',
    category: 'update-schedules',
    description: 'List all update schedules',
    params: [],
    returns: 'Array of schedule objects',
  },
  {
    method: 'getUpdateSchedule',
    category: 'update-schedules',
    description: 'Get an update schedule by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Schedule ID' },
    ],
    returns: 'Schedule object',
  },
  {
    method: 'createUpdateSchedule',
    category: 'update-schedules',
    description: 'Create a new update schedule',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Schedule data' },
    ],
    returns: 'Created schedule object',
  },
  {
    method: 'updateUpdateSchedule',
    category: 'update-schedules',
    description: 'Update an update schedule',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Schedule ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated schedule object',
  },
  {
    method: 'deleteUpdateSchedule',
    category: 'update-schedules',
    description: 'Delete an update schedule',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Schedule ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- custom-sections ---
  {
    method: 'listCustomSectionFields',
    category: 'custom-sections',
    description: 'List custom section fields (used in experiment forms)',
    params: [
      { name: 'limit', type: 'number', required: false, description: 'Max results (default: 100)' },
      { name: 'offset', type: 'number', required: false, description: 'Offset' },
    ],
    returns: 'Array of custom section field objects',
  },
  {
    method: 'getCustomSectionField',
    category: 'custom-sections',
    description: 'Get a custom section field by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Field ID' },
    ],
    returns: 'Custom section field object',
  },
  {
    method: 'createCustomSectionField',
    category: 'custom-sections',
    description: 'Create a custom section field',
    params: [
      { name: 'data', type: 'object', required: true, description: 'Field data with title, type, etc.' },
    ],
    returns: 'Created field object',
  },
  {
    method: 'updateCustomSectionField',
    category: 'custom-sections',
    description: 'Update a custom section field',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Field ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated field object',
  },
  {
    method: 'archiveCustomSectionField',
    category: 'custom-sections',
    description: 'Archive or unarchive a custom section field',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Field ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'listCustomSections',
    category: 'custom-sections',
    description: 'List custom sections',
    params: [],
    returns: 'Array of custom section objects',
  },
  {
    method: 'createCustomSection',
    category: 'custom-sections',
    description: 'Create a custom section',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, type: string }' },
    ],
    returns: 'Created section object',
  },
  {
    method: 'updateCustomSection',
    category: 'custom-sections',
    description: 'Update a custom section',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Section ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated section object',
  },
  {
    method: 'archiveCustomSection',
    category: 'custom-sections',
    description: 'Archive or unarchive a custom section',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Section ID' },
      { name: 'unarchive', type: 'boolean', required: false, description: 'Set true to unarchive' },
    ],
    returns: 'void',
  },
  {
    method: 'reorderCustomSections',
    category: 'custom-sections',
    description: 'Reorder custom sections',
    params: [
      { name: 'sections', type: 'array', required: true, description: 'Array of { id: number, order_index: number }' },
    ],
    returns: 'void',
  },

  // --- notifications ---
  {
    method: 'getNotifications',
    category: 'notifications',
    description: 'Get notifications for the current user',
    params: [
      { name: 'cursor', type: 'number', required: false, description: 'Cursor for pagination' },
    ],
    returns: 'Array of notification objects',
  },
  {
    method: 'markNotificationsSeen',
    category: 'notifications',
    description: 'Mark all notifications as seen',
    params: [],
    returns: 'void',
  },
  {
    method: 'markNotificationsRead',
    category: 'notifications',
    description: 'Mark specific notifications as read',
    params: [
      { name: 'ids', type: 'array', required: false, description: 'Array of notification IDs (omit for all)' },
    ],
    returns: 'void',
  },
  {
    method: 'hasNewNotifications',
    category: 'notifications',
    description: 'Check if there are new notifications since a given ID',
    params: [
      { name: 'lastNotificationId', type: 'number', required: false, description: 'Last seen notification ID' },
    ],
    returns: 'boolean',
  },

  // --- follow-favorite ---
  {
    method: 'followExperiment',
    category: 'follow-favorite',
    description: 'Follow an experiment to receive notifications',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'void',
  },
  {
    method: 'unfollowExperiment',
    category: 'follow-favorite',
    description: 'Unfollow an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
    ],
    returns: 'void',
  },
  {
    method: 'followMetric',
    category: 'follow-favorite',
    description: 'Follow a metric to receive notifications',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'unfollowMetric',
    category: 'follow-favorite',
    description: 'Unfollow a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
    ],
    returns: 'void',
  },
  {
    method: 'followGoal',
    category: 'follow-favorite',
    description: 'Follow a goal to receive notifications',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
    ],
    returns: 'void',
  },
  {
    method: 'unfollowGoal',
    category: 'follow-favorite',
    description: 'Unfollow a goal',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Goal ID' },
    ],
    returns: 'void',
  },
  {
    method: 'favoriteExperiment',
    category: 'follow-favorite',
    description: 'Favorite or unfavorite an experiment',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Experiment ID' },
      { name: 'favorite', type: 'boolean', required: true, description: 'true to favorite, false to unfavorite' },
    ],
    returns: 'void',
  },
  {
    method: 'favoriteMetric',
    category: 'follow-favorite',
    description: 'Favorite or unfavorite a metric',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Metric ID' },
      { name: 'favorite', type: 'boolean', required: true, description: 'true to favorite, false to unfavorite' },
    ],
    returns: 'void',
  },

  // --- asset-roles ---
  {
    method: 'listAssetRoles',
    category: 'asset-roles',
    description: 'List asset roles (used for per-entity access control)',
    params: [],
    returns: 'Array of asset role objects',
  },
  {
    method: 'getAssetRole',
    category: 'asset-roles',
    description: 'Get an asset role by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'Asset role object',
  },
  {
    method: 'createAssetRole',
    category: 'asset-roles',
    description: 'Create a new asset role',
    params: [
      { name: 'data', type: 'object', required: true, description: '{ name: string, ... }' },
    ],
    returns: 'Created asset role object',
  },
  {
    method: 'updateAssetRole',
    category: 'asset-roles',
    description: 'Update an asset role',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Asset role ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated asset role object',
  },
  {
    method: 'deleteAssetRole',
    category: 'asset-roles',
    description: 'Delete an asset role',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Asset role ID' },
    ],
    returns: 'void',
    dangerous: true,
  },

  // --- access-control-policies ---
  {
    method: 'listAccessControlPolicies',
    category: 'access-control-policies',
    description: 'List all access control policies',
    params: [],
    returns: 'Array of policy objects',
  },

  // --- platform-config ---
  {
    method: 'listPlatformConfigs',
    category: 'platform-config',
    description: 'List platform configurations',
    params: [],
    returns: 'Array of platform config objects',
  },
  {
    method: 'getPlatformConfig',
    category: 'platform-config',
    description: 'Get a platform config by ID',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Platform config ID' },
    ],
    returns: 'Platform config object',
  },
  {
    method: 'updatePlatformConfig',
    category: 'platform-config',
    description: 'Update a platform config',
    params: [
      { name: 'id', type: 'number', required: true, description: 'Platform config ID' },
      { name: 'data', type: 'object', required: true, description: 'Fields to update' },
    ],
    returns: 'Updated platform config object',
    dangerous: true,
  },

  // --- resolve-helpers ---
  {
    method: 'resolveMetrics',
    category: 'resolve-helpers',
    description: 'Resolve metric names or IDs to metric objects. Useful for looking up metrics by name.',
    params: [
      { name: 'namesOrIds', type: 'array', required: true, description: 'Array of metric names or IDs (strings)' },
    ],
    returns: 'Array of resolved metric objects',
  },
  {
    method: 'resolveTeams',
    category: 'resolve-helpers',
    description: 'Resolve team names or IDs to team objects. Useful for looking up teams by name.',
    params: [
      { name: 'namesOrIds', type: 'array', required: true, description: 'Array of team names or IDs (strings)' },
    ],
    returns: 'Array of resolved team objects',
  },
  {
    method: 'resolveTags',
    category: 'resolve-helpers',
    description: 'Resolve tag names or IDs to tag objects. Useful for looking up experiment tags by name.',
    params: [
      { name: 'namesOrIds', type: 'array', required: true, description: 'Array of tag names or IDs (strings)' },
    ],
    returns: 'Array of resolved tag objects',
  },
  {
    method: 'resolveUsers',
    category: 'resolve-helpers',
    description: 'Resolve user names, emails, or IDs to user objects. Supports "Name <email>" format.',
    params: [
      { name: 'namesOrEmails', type: 'array', required: true, description: 'Array of user emails, names, or IDs (strings)' },
    ],
    returns: 'Array of resolved user objects',
  },

  // --- rawRequest ---
  {
    method: 'rawRequest',
    category: 'experiments',
    description: 'Make a raw API request to any endpoint. Use when no specific method exists.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'API path starting with / (e.g. /experiments)' },
      { name: 'method', type: 'string', required: false, description: 'HTTP method (default: GET)' },
      { name: 'data', type: 'object', required: false, description: 'Request body data' },
      { name: 'headers', type: 'object', required: false, description: 'Additional headers' },
    ],
    returns: 'Raw response data',
  },
];

export function searchCatalog(query: string): ApiMethodEntry[] {
  const q = query.toLowerCase();
  return API_CATALOG.filter(entry =>
    entry.method.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q)
  );
}

export function getCatalogByCategory(category: string): ApiMethodEntry[] {
  return API_CATALOG.filter(entry => entry.category === category);
}

export function getMethodEntry(methodName: string): ApiMethodEntry | undefined {
  return API_CATALOG.find(entry => entry.method === methodName);
}

export function getCategorySummary(): Array<{ category: string; count: number; methods: string[] }> {
  const groups = new Map<string, string[]>();
  for (const entry of API_CATALOG) {
    const list = groups.get(entry.category) || [];
    list.push(entry.method);
    groups.set(entry.category, list);
  }
  return Array.from(groups.entries())
    .map(([category, methods]) => ({ category, count: methods.length, methods }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
