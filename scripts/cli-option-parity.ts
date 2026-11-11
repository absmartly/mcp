// Generates tests/fixtures/cli-command-options.json: every leaf command of the
// installed @absmartly/cli and each of its options, mapped to the
// execute_command command and param that carries it, or to null with the
// reason it does not apply to an MCP server (terminal rendering, local files,
// local CLI config, interactive prompts).
//
// The mapping below is the source of truth. The generator walks the CLI's
// commander tree and fails when a command or option is not mapped, so a CLI
// upgrade that adds an option fails `--check` (and the unit test) until the
// option is mapped here.
//
// Usage: npx tsx scripts/cli-option-parity.ts [--check]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_PATH = join(ROOT, "tests", "fixtures", "cli-command-options.json");
const require = createRequire(import.meta.url);
const CLI_DIST = resolve(dirname(require.resolve("@absmartly/cli/api-client")), "..");

// Why an option has no MCP param.
const RENDER = "terminal rendering only";
const LOCAL_FILE = "reads or writes a local file; pass the content instead";
const INTERACTIVE = "interactive prompt; MCP confirmation covers it";
const PIPE = "shell pipe handling";
const POLL = "polling loop; call the command again";
const NOT_SENT = "the CLI command parses it but never sends it";
const LOCAL_CONFIG = "local CLI configuration or credentials";

// Commands that manage the CLI itself (profiles, login, shell completion).
const LOCAL_COMMANDS: Record<string, string> = {
  "auth login": LOCAL_CONFIG, "auth logout": LOCAL_CONFIG, "auth status": LOCAL_CONFIG, "config list": LOCAL_CONFIG,
  "config get": LOCAL_CONFIG, "config set": LOCAL_CONFIG, "config unset": LOCAL_CONFIG, "config profiles list": LOCAL_CONFIG,
  "config profiles use": LOCAL_CONFIG, "config profiles delete": LOCAL_CONFIG, "setup": LOCAL_CONFIG, "doctor": LOCAL_CONFIG,
  "version": LOCAL_CONFIG, "open": "opens a browser", "completion": LOCAL_CONFIG,
  "experiments refresh-fields": "writes the CLI's local custom field cache",
  "activity-feed watch": POLL,
};

type Options = Record<string, string | null | [null, string]>;
const n = (reason: string): [null, string] => [null, reason];

/** CLI command → [group.command, { cliOption: param | [null, reason] }]. Positional arguments are listed as options too. */
const MAPPING: Record<string, [string, Options]> = {
  "action-dialog-fields list": ["actiondialogfields.listActionDialogFields", { items: "items", page: "page" }],
  "action-dialog-fields get": ["actiondialogfields.getActionDialogField", { id: "fieldId" }],
  "action-dialog-fields create": ["actiondialogfields.createActionDialogField", { jsonConfig: "data" }],
  "action-dialog-fields update": ["actiondialogfields.updateActionDialogField", { id: "fieldId", jsonConfig: "data" }],
  "activity-feed list": ["activity.listActivity", { experiments: "experiments", items: "experiments", limit: "limit", since: "since", state: "state", search: "search", sort: "sort", notes: "includeNotes" }],
  "api": ["api.rawRequest", { path: "path", method: "method", data: "body", header: "headers" }],
  "api-keys list": ["apikeys.listApiKeys", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "api-keys get": ["apikeys.getApiKey", { id: "keyId" }],
  "api-keys create": ["apikeys.createApiKey", { name: "data", description: "data", permissions: "data" }],
  "api-keys update": ["apikeys.updateApiKey", { id: "keyId", name: "data", description: "data" }],
  "api-keys delete": ["apikeys.deleteApiKey", { id: "keyId" }],
  "apps list": ["apps.listApps", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "apps get": ["apps.getApp", { id: "appId" }],
  "apps create": ["apps.createApp", { name: "data" }],
  "apps update": ["apps.updateApp", { id: "appId", name: "data" }],
  "apps archive": ["apps.archiveApp", { id: "appId", unarchive: "unarchive" }],
  "asset-roles list": ["assetroles.listAssetRoles", { items: "items", page: "page" }],
  "asset-roles get": ["assetroles.getAssetRole", { id: "roleId" }],
  "asset-roles create": ["assetroles.createAssetRole", { name: "data" }],
  "asset-roles update": ["assetroles.updateAssetRole", { id: "roleId", name: "data" }],
  "asset-roles delete": ["assetroles.deleteAssetRole", { id: "roleId" }],
  "auth create-api-key": ["auth.createAuthApiKey", { name: "data", description: "data" }],
  "auth whoami": ["auth.whoami", { avatar: n(RENDER) }],
  "auth list-api-keys": ["auth.listAuthApiKeys", {}],
  "auth get-api-key": ["auth.getAuthApiKey", { id: "keyId" }],
  "auth update-api-key": ["auth.updateAuthApiKey", { id: "keyId", name: "data", description: "data" }],
  "auth delete-api-key": ["auth.deleteAuthApiKey", { id: "keyId" }],
  "auth edit-profile": ["auth.editProfile", { firstName: "firstName", lastName: "lastName", department: "department", jobTitle: "jobTitle" }],
  "auth reset-my-password": ["auth.resetMyPassword", {}],
  "cors list": ["cors.listCorsOrigins", { items: "items", page: "page" }],
  "cors get": ["cors.getCorsOrigin", { id: "originId" }],
  "cors create": ["cors.createCorsOrigin", { origin: "data" }],
  "cors update": ["cors.updateCorsOrigin", { id: "originId", origin: "data" }],
  "cors delete": ["cors.deleteCorsOrigin", { id: "originId" }],
  "custom-fields list": ["customfields.listCustomFields", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "custom-fields get": ["customfields.getCustomField", { id: "fieldId" }],
  "custom-fields create": ["customfields.createCustomField", { name: "data", type: "data", defaultValue: "data" }],
  "custom-fields update": ["customfields.updateCustomField", { id: "fieldId", name: "data", type: "data", defaultValue: "data" }],
  "custom-fields archive": ["customfields.archiveCustomField", { id: "fieldId", unarchive: "unarchive" }],
  "custom-sections list": ["customsections.listCustomSections", { items: "items", page: "page" }],
  "custom-sections create": ["customsections.createCustomSection", { name: "data", type: "data" }],
  "custom-sections update": ["customsections.updateCustomSection", { id: "sectionId", name: "data" }],
  "custom-sections archive": ["customsections.archiveCustomSection", { id: "sectionId", unarchive: "unarchive" }],
  "custom-sections reorder": ["customsections.reorderCustomSections", { sections: "ids" }],
  "datasources list": ["datasources.listDatasources", { items: "items", page: "page" }],
  "datasources get": ["datasources.getDatasource", { id: "datasourceId" }],
  "datasources create": ["datasources.createDatasource", { jsonConfig: "data" }],
  "datasources update": ["datasources.updateDatasource", { id: "datasourceId", jsonConfig: "data" }],
  "datasources archive": ["datasources.archiveDatasource", { id: "datasourceId", unarchive: "unarchive" }],
  "datasources test": ["datasources.testDatasource", { jsonConfig: "config" }],
  "datasources introspect": ["datasources.introspectDatasource", { jsonConfig: "config" }],
  "datasources validate-query": ["datasources.validateDatasourceQuery", { jsonConfig: "config" }],
  "datasources preview-query": ["datasources.previewDatasourceQuery", { jsonConfig: "config" }],
  "datasources query": ["datasources.previewDatasourceQuery", { id: "datasourceId", sql: "query", limit: "limit", jsonConfig: "config" }],
  "datasources set-default": ["datasources.setDefaultDatasource", { id: "datasourceId" }],
  "datasources schema": ["datasources.getDatasourceSchema", { id: "datasourceId" }],
  "datasources delete": ["datasources.deleteDatasource", { id: "datasourceId" }],
  "datasources json-layouts create": ["datasources.createDatasourceJsonLayouts", { id: "datasourceId" }],
  "datasources json-layouts recreate": ["datasources.recreateDatasourceJsonLayouts", { id: "datasourceId", yes: n(INTERACTIVE) }],
  "datasources json-layouts preview": ["datasources.previewDatasourceJsonLayouts", { id: "datasourceId" }],
  "envs list": ["envs.listEnvs", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "envs get": ["envs.getEnv", { id: "envId" }],
  "envs create": ["envs.createEnv", { name: "data" }],
  "envs update": ["envs.updateEnv", { id: "envId", name: "data" }],
  "envs archive": ["envs.archiveEnv", { id: "envId", unarchive: "unarchive" }],
  "events list": ["events.listEvents", { from: "from", to: "to", app: "applications", unitType: "unitTypes", eventType: "eventTypes", eventName: "eventNames", unitUid: "unitUids", envType: "environmentTypes", validExposures: "validExposures", invalidExposures: "validExposures", items: "take", skip: "skip" }],
  "events history": ["events.listEventsHistory", { from: "from", to: "to", app: "applications", unitType: "unitTypes", eventType: "eventTypes", eventName: "eventNames", unitUid: "unitUids", envType: "environmentTypes", period: "period", tzOffset: "tzOffset" }],
  "events unit-data": ["events.getEventUnitData", { units: "units" }],
  "events delete-unit-data": ["events.deleteEventUnitData", { units: "units" }],
  "events json-values": ["events.getEventJsonValues", { eventType: "eventType", path: "path", experimentId: "experimentId", goalId: "goalId", from: "from", to: "to", match: "match" }],
  "events json-layouts": ["events.getEventJsonLayouts", { source: "source", phase: "phase", prefix: "prefix", sourceId: "sourceId", from: "from", to: "to", match: "match", topLevel: "topLevel", maxDepth: "maxDepth" }],
  "events summary": ["events.getEventsSummary", { from: "from", to: "to", eventType: "eventType", groupBy: "groupBy", period: "period", cumulative: "cumulative", transpose: "transpose", visualization: n(RENDER) }],
  "experiments list": ["experiments.listExperiments", {
    state: "state", type: "type", app: "app", applications: "applications", search: "search", unitTypes: "unitTypes", owners: "owners", teams: "teams", tags: "tags", ids: "ids",
    impact: "impact", confidence: "confidence", significance: "significance", iterations: "iterations", iterationsOf: "iterationsOf", metric: "metric", metricRole: "metricRole",
    createdAfter: "createdAfter", createdBefore: "createdBefore", startedAfter: "startedAfter", startedBefore: "startedBefore", stoppedAfter: "stoppedAfter", stoppedBefore: "stoppedBefore",
    analysisType: "analysisType", runningType: "runningType", alertSrm: "alertSrm", alertCleanupNeeded: "alertCleanupNeeded", alertAudienceMismatch: "alertAudienceMismatch",
    alertSampleSizeReached: "alertSampleSizeReached", alertExperimentsInteract: "alertExperimentsInteract", alertGroupSequentialUpdated: "alertGroupSequentialUpdated",
    alertAssignmentConflict: "alertAssignmentConflict", alertMetricThresholdReached: "alertMetricThresholdReached", items: "items", page: "page", sort: "sort", asc: "asc", desc: "desc",
  }],
  "experiments get": ["experiments.getExperiment", { id: "experimentId", activity: "activity", embedScreenshots: n(RENDER), screenshotsDir: n(LOCAL_FILE), showImages: n(RENDER) }],
  "experiments analyze": ["experiments.analyzeExperiment", { id: "experimentId" }],
  "experiments search": ["experiments.searchExperiments", { query: "search", limit: "items" }],
  "experiments create": ["experiments.createExperimentFromOptions", {
    fromFile: n("pass the template as experiments.createExperimentFromTemplate templateContent"), name: "name", displayName: "displayName", state: "state", variants: "variants",
    variantConfig: "variantConfig", applicationId: "applicationId", unitType: "unitType", primaryMetric: "primaryMetric", percentages: "percentages", percentageOfTraffic: "percentageOfTraffic",
    env: n(NOT_SENT), owner: "owner", screenshot: "screenshot", secondaryMetrics: "secondaryMetrics", guardrailMetrics: "guardrailMetrics", exploratoryMetrics: "exploratoryMetrics",
    teams: "teams", tags: "tags", audience: "audience", analysisType: "analysisType", requiredAlpha: "requiredAlpha", requiredPower: "requiredPower", baselineParticipants: "baselineParticipants",
    mde: "mde", baselineMean: "baselineMean", baselineStdev: "baselineStdev", gsFutilityType: "gsFutilityType", gsAnalysisCount: "gsAnalysisCount", gsMinAnalysisInterval: "gsMinAnalysisInterval",
    gsFirstAnalysisInterval: "gsFirstAnalysisInterval", gsMaxDurationInterval: "gsMaxDurationInterval", field: "customFields", interactive: n(INTERACTIVE), dryRun: "dryRun",
    asCurl: n("prints a curl command containing the API key"),
  }],
  "experiments clone": ["experiments.cloneExperiment", { id: "experimentId", name: "name", displayName: "displayName", state: "state", fromFile: "templateContent", interactive: n(INTERACTIVE), dryRun: "dryRun" }],
  "experiments update": ["experiments.updateExperiment", {
    id: "experimentId", fromFile: "templateContent", name: "name", displayName: "displayName", state: "state", variants: "variants", variantConfig: "variantConfig",
    applicationId: "applicationId", unitType: "unitType", primaryMetric: "primaryMetric", secondaryMetrics: "secondaryMetrics", guardrailMetrics: "guardrailMetrics",
    exploratoryMetrics: "exploratoryMetrics", percentages: "percentages", percentageOfTraffic: "percentageOfTraffic", owner: "owner", screenshot: "screenshot", screenshotId: "screenshotId",
    teams: "teams", tags: "tags", audience: "audience", analysisType: "analysisType", requiredAlpha: "requiredAlpha", requiredPower: "requiredPower", baselineParticipants: "baselineParticipants",
    field: "customFields", note: "note", interactive: n(INTERACTIVE), dryRun: "dryRun",
  }],
  "experiments start": ["experiments.startExperiment", { id: "experimentId", note: "note", interactive: n(INTERACTIVE), passThrough: n(PIPE) }],
  "experiments stop": ["experiments.stopExperiment", { id: "experimentId", reason: "reason", note: "note", interactive: n(INTERACTIVE), passThrough: n(PIPE) }],
  "experiments archive": ["experiments.archiveExperiment", { id: "experimentId", unarchive: "unarchive", note: "note", interactive: n(INTERACTIVE), passThrough: n(PIPE) }],
  "experiments activity list": ["experiments.listExperimentActivity", { id: "experimentId", notes: n(RENDER), showImages: n(RENDER) }],
  "experiments activity create": ["experiments.createExperimentNote", { id: "experimentId", note: "text" }],
  "experiments activity edit": ["experiments.editExperimentNote", { experimentId: "experimentId", noteId: "noteId", note: "text" }],
  "experiments activity reply": ["experiments.replyToExperimentNote", { experimentId: "experimentId", noteId: "noteId", note: "text" }],
  "experiments generate-template": ["experiments.generateTemplate", { name: "name", type: "type", output: n(LOCAL_FILE) }],
  "experiments development": ["experiments.developmentExperiment", { id: "experimentId", note: "note", interactive: n(INTERACTIVE), passThrough: n(PIPE) }],
  "experiments restart": ["experiments.restartExperiment", { id: "experimentId", fromFile: "templateContent", note: "note", reason: "reason", reshuffle: "reshuffle", state: "state", asType: "type", field: "customFields", interactive: n(INTERACTIVE), dryRun: "dryRun" }],
  "experiments full-on": ["experiments.fullOnExperiment", { id: "experimentId", variant: "variant", note: "note", interactive: n(INTERACTIVE), passThrough: n(PIPE) }],
  "experiments schedule create": ["experiments.createScheduledAction", { id: "experimentId", action: "action", at: "scheduledAt", note: "note", reason: "reason" }],
  "experiments schedule delete": ["experiments.deleteScheduledAction", { experimentId: "experimentId", actionId: "actionId" }],
  "experiments metrics results": ["experiments.getMetricResults", { id: "experimentId", metric: "metricId", segment: "segment", filter: "filter", from: "from", to: "to", cached: "cached", ciBar: "ciBar", variantIndex: "variantIndex" }],
  "experiments metrics list": ["experiments.listExperimentMetrics", { id: "experimentId" }],
  "experiments metrics add": ["experiments.addExperimentMetrics", { id: "experimentId", metrics: "metrics" }],
  "experiments metrics confirm-impact": ["experiments.confirmMetricImpact", { experimentId: "experimentId", metricId: "metricId" }],
  "experiments metrics exclude": ["experiments.excludeExperimentMetric", { experimentId: "experimentId", metricId: "metricId" }],
  "experiments metrics include": ["experiments.includeExperimentMetric", { experimentId: "experimentId", metricId: "metricId" }],
  "experiments metrics remove-impact": ["experiments.removeMetricImpact", { experimentId: "experimentId", metricId: "metricId" }],
  "experiments metrics deps": ["experiments.getMetricDeps", { metricId: "metricId" }],
  "experiments parent": ["experiments.getParentExperiment", { id: "experimentId" }],
  "experiments access list-users": ["experiments.listExperimentAccessUsers", { id: "experimentId" }],
  "experiments access grant-user": ["experiments.grantExperimentAccessUser", { id: "experimentId", user: "userId", role: "role" }],
  "experiments access revoke-user": ["experiments.revokeExperimentAccessUser", { id: "experimentId", user: "userId", role: "role" }],
  "experiments access list-teams": ["experiments.listExperimentAccessTeams", { id: "experimentId" }],
  "experiments access grant-team": ["experiments.grantExperimentAccessTeam", { id: "experimentId", team: "teamId", role: "role" }],
  "experiments access revoke-team": ["experiments.revokeExperimentAccessTeam", { id: "experimentId", team: "teamId", role: "role" }],
  "experiments follow": ["experiments.followExperiment", { id: "experimentId" }],
  "experiments unfollow": ["experiments.unfollowExperiment", { id: "experimentId" }],
  "experiments annotations list": ["experiments.listAnnotations", { experimentId: "experimentId" }],
  "experiments annotations create": ["experiments.createAnnotation", { experimentId: "experimentId", type: "data" }],
  "experiments annotations update": ["experiments.updateAnnotation", { annotationId: "annotationId", type: "data" }],
  "experiments annotations archive": ["experiments.archiveAnnotation", { annotationId: "annotationId", unarchive: "unarchive" }],
  "experiments alerts list": ["experiments.listExperimentAlerts", { experimentId: "experimentId" }],
  "experiments alerts dismiss": ["experiments.dismissAlert", { alertId: "alertId" }],
  "experiments recommendations list": ["experiments.listRecommendedActions", { experimentId: "experimentId" }],
  "experiments recommendations dismiss": ["experiments.dismissRecommendedAction", { actionId: "actionId" }],
  "experiments export": ["experiments.exportExperiment", {
    id: "experimentId", wait: n("poll experiments.getExportStatus"), download: n(LOCAL_FILE), resume: n(LOCAL_FILE),
    new: n("check experiments.findRecentExport first, as the CLI does without --new"), interval: n(POLL),
  }],
  "experiments request-update": ["experiments.requestUpdate", { id: "experimentId", tasks: "tasks", replaceGsa: "replaceGsa" }],
  "experiments diff": ["experiments.diffExperimentsCore", { id1: "experimentId1", id2: "experimentId2", iteration: "iteration" }],
  "experiments watch": ["experiments.watchExperimentTick", { id: "experimentId", interval: n(POLL), variantIndex: "variantIndex" }],
  "experiments bulk start": ["experiments.bulkStart", { ids: "ids", note: "note", stdin: n(PIPE), dryRun: "dryRun", state: "state", app: "app", yes: n(INTERACTIVE) }],
  "experiments bulk stop": ["experiments.bulkStop", { ids: "ids", reason: "reason", note: "note", stdin: n(PIPE), dryRun: "dryRun", state: "state", app: "app", yes: n(INTERACTIVE) }],
  "experiments bulk archive": ["experiments.bulkArchive", { ids: "ids", note: "note", stdin: n(PIPE), dryRun: "dryRun", state: "state", app: "app", yes: n(INTERACTIVE) }],
  "experiments bulk development": ["experiments.bulkDevelopment", { ids: "ids", note: "note", stdin: n(PIPE), dryRun: "dryRun", state: "state", app: "app", yes: n(INTERACTIVE) }],
  "experiments bulk full-on": ["experiments.bulkFullOn", { ids: "ids", variant: "variant", note: "note", stdin: n(PIPE), dryRun: "dryRun", state: "state", app: "app", yes: n(INTERACTIVE) }],
  "experiments custom-fields list": ["experiments.listCustomFields", { items: "items", page: "page" }],
  "experiments custom-fields get": ["experiments.getCustomField", { id: "fieldId" }],
  "experiments custom-fields create": ["experiments.createCustomField", { name: "data", type: "data", defaultValue: "data" }],
  "experiments custom-fields update": ["experiments.updateCustomField", { id: "fieldId", name: "data", type: "data", defaultValue: "data" }],
  "experiments custom-fields archive": ["experiments.archiveCustomField", { id: "fieldId", unarchive: "unarchive" }],
  "experiments estimate-participants": ["experiments.estimateParticipants", { unitType: "unitType", application: "application", from: "from", audience: "audience" }],
  "export-configs list": ["exportconfigs.listExportConfigs", { items: "items", page: "page" }],
  "export-configs get": ["exportconfigs.getExportConfig", { id: "configId" }],
  "export-configs create": ["exportconfigs.createExportConfig", { jsonConfig: "data" }],
  "export-configs update": ["exportconfigs.updateExportConfig", { id: "configId", jsonConfig: "data" }],
  "export-configs archive": ["exportconfigs.archiveExportConfig", { id: "configId", unarchive: "unarchive" }],
  "export-configs pause": ["exportconfigs.pauseExportConfig", { id: "configId" }],
  "export-configs histories": ["exportconfigs.listExportHistories", { id: "configId" }],
  "export-configs cancel-history": ["exportconfigs.cancelExportHistory", { "export-config-id": "configId", "history-id": "historyId", reason: "reason" }],
  "favorites add": ["favorites.addFavorite", { type: "entityType", id: "entityId" }],
  "favorites remove": ["favorites.removeFavorite", { type: "entityType", id: "entityId" }],
  "goals list": ["goals.listGoals", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "goals get": ["goals.getGoal", { id: "goalId" }],
  "goals create": ["goals.createGoal", { name: "data", description: "data" }],
  "goals update": ["goals.updateGoal", { id: "goalId", description: "data" }],
  "goals access list-users": ["goals.listGoalAccessUsers", { id: "goalId" }],
  "goals access grant-user": ["goals.grantGoalAccessUser", { id: "goalId", user: "userId", role: "role" }],
  "goals access revoke-user": ["goals.revokeGoalAccessUser", { id: "goalId", user: "userId", role: "role" }],
  "goals access list-teams": ["goals.listGoalAccessTeams", { id: "goalId" }],
  "goals access grant-team": ["goals.grantGoalAccessTeam", { id: "goalId", team: "teamId", role: "role" }],
  "goals access revoke-team": ["goals.revokeGoalAccessTeam", { id: "goalId", team: "teamId", role: "role" }],
  "goals follow": ["goals.followGoal", { id: "goalId" }],
  "goals unfollow": ["goals.unfollowGoal", { id: "goalId" }],
  "goal-tags list": ["goaltags.listGoalTags", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "goal-tags get": ["goaltags.getGoalTag", { id: "tagId" }],
  "goal-tags create": ["goaltags.createGoalTag", { tag: "data" }],
  "goal-tags update": ["goaltags.updateGoalTag", { id: "tagId", tag: "data" }],
  "goal-tags delete": ["goaltags.deleteGoalTag", { id: "tagId" }],
  "insights velocity": ["insights.getVelocityInsights", { from: "from", to: "to", aggregation: "aggregation", unitTypes: "unitTypes", teams: "teams", owners: "owners" }],
  "insights decisions": ["insights.getDecisionInsights", { from: "from", to: "to", aggregation: "aggregation", unitTypes: "unitTypes", teams: "teams", owners: "owners" }],
  "insights velocity-detail": ["insights.getVelocityInsightsDetail", { from: "from", to: "to", aggregation: "aggregation", teams: "teams", applications: "applications" }],
  "insights decisions-history": ["insights.getDecisionInsightsHistory", { from: "from", to: "to", aggregation: "aggregation", teams: "teams", applications: "applications" }],
  "metric-categories list": ["metriccategories.listMetricCategories", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "metric-categories get": ["metriccategories.getMetricCategory", { id: "categoryId" }],
  "metric-categories create": ["metriccategories.createMetricCategory", { name: "data", description: "data", color: "data" }],
  "metric-categories update": ["metriccategories.updateMetricCategory", { id: "categoryId", name: "data", description: "data", color: "data" }],
  "metric-categories archive": ["metriccategories.archiveMetricCategory", { id: "categoryId", unarchive: "unarchive" }],
  "metrics list": ["metrics.listMetrics", {
    includeDrafts: "include_drafts", owners: "owners", teams: "teams", reviewStatus: "reviewStatus", metricType: "metricType", goal: "goal", outlierLimiting: "outlierLimiting",
    outlierMethod: "outlierMethod", hasPropertyFilter: "hasPropertyFilter", propertyFilter: "hasPropertyFilter", propertyFilterPath: "propertyFilterPath",
    propertyFilterContains: "propertyFilterContains", impactDirection: "impactDirection", cuped: "cuped", items: "items", page: "page", search: "search", sort: "sort", asc: "asc",
    desc: "desc", archived: "archived", ids: "ids",
  }],
  "metrics get": ["metrics.getMetric", { id: "metricId" }],
  // Every metric field option goes into `data` (API names), as createMetric documents.
  "metrics create": ["metrics.createMetric", { activate: "activate", newVersion: "newVersion", reason: "reason", "*": "data" }],
  "metrics update": ["metrics.updateMetric", { id: "metricId", name: "data", description: "data", owner: "data" }],
  "metrics archive": ["metrics.archiveMetric", { id: "metricId", unarchive: "unarchive" }],
  "metrics activate": ["metrics.activateMetric", { id: "metricId", reason: "reason" }],
  "metrics version": ["metrics.createMetricVersion", { id: "metricId", reason: "reason", activate: "activate", "*": "data" }],
  "metrics access list-users": ["metrics.listMetricAccessUsers", { id: "metricId" }],
  "metrics access grant-user": ["metrics.grantMetricAccessUser", { id: "metricId", user: "userId", role: "assetRoleId" }],
  "metrics access revoke-user": ["metrics.revokeMetricAccessUser", { id: "metricId", user: "userId", role: "assetRoleId" }],
  "metrics access list-teams": ["metrics.listMetricAccessTeams", { id: "metricId" }],
  "metrics access grant-team": ["metrics.grantMetricAccessTeam", { id: "metricId", team: "teamId", role: "assetRoleId" }],
  "metrics access revoke-team": ["metrics.revokeMetricAccessTeam", { id: "metricId", team: "teamId", role: "assetRoleId" }],
  "metrics review status": ["metrics.getMetricReview", { id: "metricId" }],
  "metrics review request": ["metrics.requestMetricReview", { id: "metricId" }],
  "metrics review approve": ["metrics.approveMetricReview", { id: "metricId" }],
  "metrics review comments": ["metrics.listMetricReviewComments", { id: "metricId" }],
  "metrics review comment": ["metrics.addMetricReviewComment", { id: "metricId", message: "text" }],
  "metrics review reply": ["metrics.replyToMetricReviewComment", { id: "metricId", commentId: "commentId", message: "text" }],
  "metrics follow": ["metrics.followMetric", { id: "metricId" }],
  "metrics unfollow": ["metrics.unfollowMetric", { id: "metricId" }],
  "metric-tags list": ["metrictags.listMetricTags", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "metric-tags get": ["metrictags.getMetricTag", { id: "tagId" }],
  "metric-tags create": ["metrictags.createMetricTag", { tag: "data" }],
  "metric-tags update": ["metrictags.updateMetricTag", { id: "tagId", tag: "data" }],
  "metric-tags delete": ["metrictags.deleteMetricTag", { id: "tagId" }],
  "notifications list": ["notifications.listNotifications", { cursor: "cursor", limit: "limit" }],
  "notifications mark-seen": ["notifications.markNotificationsSeen", {}],
  "notifications mark-read": ["notifications.markNotificationsRead", { ids: "ids" }],
  "notifications check": ["notifications.checkNotifications", { lastId: "lastId" }],
  "permissions list": ["permissions.listPermissions", { items: "items", page: "page" }],
  "permissions categories": ["permissions.listPermissionCategories", { items: "items", page: "page" }],
  "permissions policies": ["permissions.listAccessControlPolicies", { items: "items", page: "page" }],
  "platform-config list": ["platformconfig.listPlatformConfigs", {}],
  "platform-config get": ["platformconfig.getPlatformConfig", { id: "configKey" }],
  "platform-config update": ["platformconfig.updatePlatformConfig", { id: "configKey", value: "data" }],
  "roles list": ["roles.listRoles", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "roles get": ["roles.getRole", { id: "roleId" }],
  "roles create": ["roles.createRole", { name: "data", description: "data" }],
  "roles update": ["roles.updateRole", { id: "roleId", name: "data", description: "data" }],
  "roles delete": ["roles.deleteRole", { id: "roleId" }],
  "segments list": ["segments.listSegments", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "segments get": ["segments.getSegment", { id: "segmentId" }],
  "segments create": ["segments.createSegment", { name: "data", attribute: "data", description: "data" }],
  "segments update": ["segments.updateSegment", { id: "segmentId", displayName: "data", description: "data" }],
  "segments delete": ["segments.deleteSegment", { id: "segmentId" }],
  "statistics power-matrix": ["statistics.getPowerMatrix", {
    jsonConfig: "params", analysisType: "analysisType", metricType: "metricType", metricMean: "metricMean", metricVariance: "metricVariance",
    metricCustomStatisticsType: "metricCustomStatisticsType", alpha: "alpha", powers: "powers", split: "split", sampleSizes: "sampleSizes",
    minimumDetectableEffects: "minimumDetectableEffects", twoSided: "twoSided", participants: "participants", futilityType: "futilityType",
    firstAnalysis: "firstAnalysis", minAnalysisInterval: "minAnalysisInterval",
  }],
  "storage-configs list": ["storageconfigs.listStorageConfigs", { items: "items", page: "page" }],
  "storage-configs get": ["storageconfigs.getStorageConfig", { id: "configId" }],
  "storage-configs create": ["storageconfigs.createStorageConfig", { jsonConfig: "data" }],
  "storage-configs update": ["storageconfigs.updateStorageConfig", { id: "configId", jsonConfig: "data" }],
  "storage-configs test": ["storageconfigs.testStorageConfig", { jsonConfig: n("the MCP tests the saved config by configId, so the stored secret never passes through it") }],
  "tags list": ["tags.listTags", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "tags get": ["tags.getTag", { id: "tagId" }],
  "tags create": ["tags.createTag", { tag: "data" }],
  "tags update": ["tags.updateTag", { id: "tagId", tag: "data" }],
  "tags delete": ["tags.deleteTag", { id: "tagId" }],
  "teams list": ["teams.listTeams", { includeArchived: "includeArchived", items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "teams get": ["teams.getTeam", { id: "teamId" }],
  "teams create": ["teams.createTeam", { name: "data", description: "data" }],
  "teams update": ["teams.updateTeam", { id: "teamId", description: "data" }],
  "teams archive": ["teams.archiveTeam", { id: "teamId", unarchive: "unarchive" }],
  "teams members list": ["teams.listTeamMembers", { id: "teamId" }],
  "teams members add": ["teams.addTeamMembers", { id: "teamId", users: "userIds", roles: "roleIds" }],
  "teams members edit-roles": ["teams.editTeamMemberRoles", { id: "teamId", users: "userId", roles: "roles" }],
  "teams members remove": ["teams.removeTeamMembers", { id: "teamId", users: "userIds" }],
  "units list": ["units.listUnits", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "units get": ["units.getUnit", { id: "unitId" }],
  "units create": ["units.createUnit", { name: "data", description: "data" }],
  "units update": ["units.updateUnit", { id: "unitId", name: "data", description: "data" }],
  "units archive": ["units.archiveUnit", { id: "unitId", unarchive: "unarchive" }],
  "update-schedules list": ["updateschedules.listUpdateSchedules", { items: "items", page: "page" }],
  "update-schedules get": ["updateschedules.getUpdateSchedule", { id: "scheduleId" }],
  "update-schedules create": ["updateschedules.createUpdateSchedule", { jsonConfig: "data" }],
  "update-schedules update": ["updateschedules.updateUpdateSchedule", { id: "scheduleId", jsonConfig: "data" }],
  "update-schedules delete": ["updateschedules.deleteUpdateSchedule", { id: "scheduleId" }],
  "users list": ["users.listUsers", {
    includeArchived: "includeArchived", search: "search", sort: "sort", asc: "asc", desc: "desc", ids: "ids", department: "department", role: "role", jobTitle: "jobTitle",
    email: "email", name: "name", contains: "contains", showAvatars: n(RENDER), items: "items", page: "page",
  }],
  "users get": ["users.getUser", { id: "userId", showAvatars: n(RENDER) }],
  "users create": ["users.createUser", { email: "data", name: "data", role: "role" }],
  "users update": ["users.updateUser", { id: "userId", name: "data", role: "role" }],
  "users archive": ["users.archiveUser", { id: "userId", unarchive: "unarchive" }],
  "users reset-password": ["users.resetUserPassword", { id: "userId" }],
  "users api-keys list": ["users.listUserApiKeys", { user: "userId", items: "items", page: "page" }],
  "users api-keys get": ["users.getUserApiKey", { id: "keyId", user: "userId" }],
  "users api-keys create": ["users.createUserApiKey", { user: "userId", name: "data", description: "data" }],
  "users api-keys update": ["users.updateUserApiKey", { id: "keyId", user: "userId", name: "data", description: "data" }],
  "users api-keys delete": ["users.deleteUserApiKey", { id: "keyId", user: "userId" }],
  "webhooks list": ["webhooks.listWebhooks", { items: "items", page: "page", search: "search", sort: "sort", asc: "asc", desc: "desc", archived: "archived", ids: "ids" }],
  "webhooks get": ["webhooks.getWebhook", { id: "webhookId" }],
  "webhooks create": ["webhooks.createWebhook", { name: "data", url: "data", description: "data", enabled: "data", ordered: "data", maxRetries: "data" }],
  "webhooks update": ["webhooks.updateWebhook", { id: "webhookId", name: "data", url: "data", description: "data", enabled: "data", ordered: "data", maxRetries: "data" }],
  "webhooks delete": ["webhooks.deleteWebhook", { id: "webhookId" }],
  "webhooks events": ["webhooks.listWebhookEvents", {}],
};

// The CLI's global options that change what a command returns. They map to
// the params of every command whose core reads them (show/exclude/showOnly/raw).
const GLOBAL_OPTIONS_NOTE = "--show, --exclude, --show-only and --raw are the show/exclude/showOnly/raw params of the commands that summarize; the other global options are terminal output or credential settings";

interface LeafCommand { args: string[]; options: string[] }

async function cliLeafCommands(): Promise<Record<string, LeafCommand>> {
  const base = join(CLI_DIST, "commands");
  const out: Record<string, LeafCommand> = {};
  for (const dir of readdirSync(base)) {
    let mod: Record<string, unknown>;
    try { mod = await import(pathToFileURL(join(base, dir, "index.js")).href); } catch { continue; }
    for (const value of Object.values(mod)) {
      if (!value || typeof value !== "object" || !("commands" in value)) continue;
      const walk = (cmd: any, path: string[]) => {
        const p = [...path, cmd.name()];
        if (cmd.commands.length === 0) {
          out[p.join(" ")] = { args: cmd.registeredArguments.map((a: any) => a.name()), options: [...new Set<string>(cmd.options.map((o: any) => o.attributeName()))] };
        }
        cmd.commands.forEach((c: any) => walk(c, p));
      };
      walk(value, []);
    }
  }
  return out;
}

export async function buildFixture(): Promise<Record<string, unknown>> {
  const leaves = await cliLeafCommands();
  const problems: string[] = [];
  const commands: Record<string, { mcp: string | null; reason?: string; options: Record<string, string | null> }> = {};
  for (const name of Object.keys(leaves).sort()) {
    const { args, options } = leaves[name];
    if (name in LOCAL_COMMANDS) {
      commands[name] = { mcp: null, reason: LOCAL_COMMANDS[name], options: {} };
      continue;
    }
    const mapped = MAPPING[name];
    if (!mapped) { problems.push(`CLI command "${name}" is not mapped`); continue; }
    const [mcp, map] = mapped;
    const resolved: Record<string, string | null> = {};
    for (const option of [...args, ...options]) {
      const target = option in map ? map[option] : map["*"];
      if (target === undefined) { problems.push(`"${name}" option "${option}" is not mapped`); continue; }
      resolved[option] = Array.isArray(target) ? null : target;
    }
    commands[name] = { mcp, options: resolved };
  }
  for (const name of Object.keys(MAPPING)) if (!(name in leaves)) problems.push(`mapped CLI command "${name}" no longer exists`);
  if (problems.length > 0) throw new Error(`CLI option mapping is incomplete:\n  ${problems.join("\n  ")}`);
  const cliVersion = JSON.parse(readFileSync(join(CLI_DIST, "..", "package.json"), "utf-8")).version;
  return { generatedFrom: { "@absmartly/cli": cliVersion }, globalOptions: GLOBAL_OPTIONS_NOTE, commands };
}

export function serializeFixture(fixture: Record<string, unknown>): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = serializeFixture(await buildFixture());
  if (process.argv.includes("--check")) {
    if (readFileSync(FIXTURE_PATH, "utf-8") !== text) {
      console.error(`${FIXTURE_PATH} is stale: run npx tsx scripts/cli-option-parity.ts`);
      process.exit(1);
    }
    console.log("CLI option fixture is current");
  } else {
    writeFileSync(FIXTURE_PATH, text);
    console.log(`Wrote ${FIXTURE_PATH}`);
  }
}
