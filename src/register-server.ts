// Shared tool/resource/prompt registration — used by local-server.ts (stdio)
// and node-http-server.ts (Node HTTP transport). index.ts (Cloudflare Worker)
// keeps its own doc-resource loop (CF env.ASSETS-backed) and calls setupTools
// directly, but could migrate to this for entity resources + prompts in a
// future cleanup (out of scope here — see design doc's non-goals).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import type { CustomSectionField } from "@absmartly/cli/api-client";
import { setupTools } from "./tools.js";
import type { ToolContext } from "./tools.js";
import type { ServerContext } from "./server-context.js";

export interface RegisterServerOptions {
  docsDir?: string;
  log?: (level: string, message: string) => void;
  elicitConfirmation?: (message: string) => Promise<boolean>;
  /**
   * CLI profile name, surfaced in get_auth_status output (stdio path only —
   * not part of ServerContext since it's a stdio-CLI-specific concept, not
   * an API-derived value). Preserves parity with local-server.ts's
   * pre-refactor behavior.
   */
  profileName?: string;
}

function buildEntityContext(ctx: ServerContext): string {
  const sections: string[] = [];
  if (ctx.applications.length > 0) {
    sections.push(`Applications:\n${ctx.applications.map(a => `  - id=${a.id}, name="${a.name}"`).join('\n')}`);
  }
  if (ctx.unitTypes.length > 0) {
    sections.push(`Unit Types:\n${ctx.unitTypes.map(u => `  - id=${u.id}, name="${u.name}"`).join('\n')}`);
  }
  if (ctx.metrics.length > 0) {
    sections.push(`Metrics:\n${ctx.metrics.map(m => `  - id=${m.id}, name="${m.name}"`).join('\n')}`);
  }
  if (ctx.teams.length > 0) {
    sections.push(`Teams:\n${ctx.teams.map(t => `  - id=${t.id}, name="${t.name}"`).join('\n')}`);
  }
  if (ctx.customFields.length > 0) {
    const cfLines = ctx.customFields
      .filter((f: CustomSectionField) => !f.archived)
      .map((f: CustomSectionField) => `  - title="${f.name}", type="${f.type}", default="${f.default_value || ''}", section_type="${f.custom_section?.type || 'unknown'}"`);
    sections.push(`Custom Fields:\n${cfLines.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function registerServer(server: McpServer, ctx: ServerContext, opts: RegisterServerOptions = {}): void {
  const toolCtx: ToolContext = {
    apiClient: ctx.apiClient,
    endpoint: ctx.endpoint,
    authType: ctx.authType,
    profileName: opts.profileName,
    entityWarnings: ctx.entityWarnings,
    customFields: ctx.customFields,
    currentUserId: ctx.currentUserId,
    log: opts.log,
    elicitConfirmation: opts.elicitConfirmation,
  };
  setupTools(server, toolCtx);

  const entityConfigs = [
    { name: "Applications", uri: "absmartly://entities/applications", description: "Cached list of available applications", getData: () => ctx.applications },
    { name: "Unit Types", uri: "absmartly://entities/unit-types", description: "Cached list of available unit types", getData: () => ctx.unitTypes },
    { name: "Teams", uri: "absmartly://entities/teams", description: "Cached list of available teams", getData: () => ctx.teams },
    { name: "Users", uri: "absmartly://entities/users", description: "Cached list of users (summarized)", getData: () => ctx.users },
    { name: "Metrics", uri: "absmartly://entities/metrics", description: "Cached list of available metrics", getData: () => ctx.metrics },
    { name: "Goals", uri: "absmartly://entities/goals", description: "Cached list of available goals", getData: () => ctx.goals },
    { name: "Tags", uri: "absmartly://entities/tags", description: "Cached list of experiment tags", getData: () => ctx.experimentTags },
    {
      name: "Custom Fields",
      uri: "absmartly://entities/custom-fields",
      description: "Cached list of custom fields",
      getData: () => ctx.customFields
        .filter((f: CustomSectionField) => !f.archived)
        .map((f: CustomSectionField) => ({
          id: f.id,
          title: f.name,
          type: f.type,
          default_value: f.default_value || '',
          section_type: f.custom_section?.type || 'unknown',
        })),
    },
  ];
  for (const cfg of entityConfigs) {
    server.resource(cfg.name, cfg.uri, { description: cfg.description }, async () => ({
      contents: [{ uri: cfg.uri, mimeType: "application/json", text: JSON.stringify(cfg.getData(), null, 2) }],
    }));
  }

  if (opts.docsDir) {
    const docResources = [
      { name: "Experiment Templates", uri: "absmartly://docs/templates", file: "templates.md", description: "Markdown templates for creating experiments: A/B test, feature flag, GST, screenshots, custom fields" },
      { name: "API Examples", uri: "absmartly://examples/api-requests", file: "examples.md", description: "Common API request examples and patterns" },
    ];
    for (const doc of docResources) {
      const filePath = join(opts.docsDir, doc.file);
      server.resource(doc.name, doc.uri, { description: doc.description }, async () => {
        let content: string;
        try {
          content = readFileSync(filePath, 'utf-8');
        } catch (e) {
          console.error(`Failed to read doc resource ${doc.file} from ${filePath}:`, e);
          content = `# Error\n\nCould not load ${doc.file} from ${filePath}`;
        }
        return { contents: [{ uri: doc.uri, mimeType: "text/markdown", text: content }] };
      });
    }
  }

  server.prompt(
    "experiment-status",
    "Quick overview of all running experiments",
    async () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: "Show me all currently running experiments with their key metrics and performance" } }],
    }),
  );

  server.prompt(
    "create-experiment",
    "Create a new A/B test experiment with all required fields pre-populated from available entities",
    {
      name: z.string().describe("Experiment name (snake_case recommended)"),
      type: completable(
        z.string().default('test').describe("Experiment type: 'test' or 'feature' (default: 'test')"),
        (value) => ['test', 'feature'].filter(t => t.startsWith(value || '')),
      ),
    },
    (args) => {
      const entityContext = buildEntityContext(ctx);
      const expType = args.type || 'test';
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a new ${expType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${args.name}".\n\nUse the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the markdown template format. Fill in the template with the context below, then pass the filled template as the "templateContent" parameter.\n\n${entityContext}`,
          },
        }],
      };
    },
  );

  server.prompt(
    "create-feature-flag",
    "Create a new feature flag (simplified experiment with type=feature)",
    { name: z.string().describe("Feature flag name (snake_case recommended)") },
    (args) => {
      const entityContext = buildEntityContext(ctx);
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a new feature flag named "${args.name}".\n\nUse the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the feature flag template. Fill it in with type "feature", two variants (off/on), and the context below, then pass as "templateContent".\n\n${entityContext}`,
          },
        }],
      };
    },
  );

  server.prompt(
    "analyze-experiment",
    "Fetch and analyze a specific experiment's details, state, and performance",
    { id: z.string().describe("Experiment ID to analyze") },
    (args) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analyze experiment with ID ${args.id}.\n\n1. Use execute_command with group "experiments", command "getExperiment", params { "experimentId": ${args.id}, "show": ["experiment_report", "audience"] }\n2. Check experiment state and alerts\n3. Provide a summary with actionable recommendations`,
        },
      }],
    }),
  );

  server.prompt(
    "experiment-review",
    "Review all running experiments and identify ones needing attention",
    async () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Review all running experiments and identify any that need attention.\n\n1. Use execute_command with group "experiments", command "listExperiments", params { "state": "running", "show": ["experiment_report"] }\n2. Check for SRM alerts, audience mismatch, sample size reached\n3. Summarize findings and suggest next actions`,
        },
      }],
    }),
  );
}
