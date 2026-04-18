// Shared MCP tool setup — used by both index.ts (Cloudflare Worker) and local-server.ts (stdio).
// Registers the 4 tools: get_auth_status, discover_commands, get_command_docs, execute_command.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { APIClient, CustomSectionField } from "@absmartly/cli/api-client";
import {
  CLI_GROUPS,
  getGroupSummary,
  getGroupCommands,
  getCommandEntry,
  searchCommands,
  executeCommand,
  getTotalCommandCount,
} from "./cli-catalog.js";
import type { CommandEntry } from "./cli-catalog.js";

const DEFAULT_LIST_ITEMS = 20;
const USER_FIELD_TYPE = 'user';

export interface ToolContext {
  apiClient: APIClient | null;
  endpoint: string;
  authType: string;
  email?: string;
  name?: string;
  profileName?: string;
  entityWarnings: string[];
  customFields: CustomSectionField[];
  currentUserId: number | null;
  /** Optional: log a message through the MCP server logging. */
  log?: (level: string, message: string) => void;
  /** Optional: request user confirmation for destructive actions via MCP elicitation. */
  elicitConfirmation?: (message: string) => Promise<boolean>;
}

function formatCommandList(entries: CommandEntry[]): string {
  return entries.map(m => {
    const paramList = m.params.length > 0
      ? m.params.map(p => `  - \`${p.name}\` (${p.type}${p.required ? ', required' : ''}): ${p.description}`).join('\n')
      : '  (no parameters)';
    return `### ${m.group}.${m.command}\n${m.description}\n${m.dangerous ? '**WARNING: Destructive operation**\n' : ''}**Params:**\n${paramList}\n**Returns:** ${m.returns}`;
  }).join('\n\n---\n\n');
}

export function autoPopulateCustomFields(
  data: Record<string, unknown>,
  customFields: CustomSectionField[],
  currentUserId: number | null,
): void {
  const existingValues = data.custom_section_field_values as Record<string, unknown> | undefined;
  if (existingValues && Object.keys(existingValues).length > 0) {
    return;
  }

  const experimentType = data.type as string | undefined;
  const fieldValues: Record<string, { type: string; value: string }> = {};

  for (const field of customFields) {
    if (field.archived) continue;
    if (!field.custom_section) continue;
    if (field.custom_section.type !== experimentType) continue;
    if (field.custom_section.archived) continue;

    let value = field.default_value || '';
    if (field.type === USER_FIELD_TYPE && currentUserId) {
      value = JSON.stringify({ selected: [{ userId: currentUserId }] });
    }

    fieldValues[String(field.id)] = { type: field.type, value };
  }

  const customFieldsByName = (data as any).custom_fields as Record<string, string> | undefined;
  if (customFieldsByName) {
    for (const [name, val] of Object.entries(customFieldsByName)) {
      const matching = customFields.find(f => f.name === name && !f.archived);
      if (matching) {
        fieldValues[String(matching.id)] = { type: matching.type, value: val };
      }
    }
    delete (data as any).custom_fields;
  }

  data.custom_section_field_values = fieldValues;
}

export function setupTools(server: McpServer, ctx: ToolContext): void {
  // ── get_auth_status ──────────────────────────────────────────────────────
  server.tool(
    "get_auth_status",
    "Get current authentication status and user information",
    {},
    { readOnlyHint: true },
    async () => {
      const hasApi = !!ctx.apiClient;
      let text = hasApi
        ? `Authenticated with ${ctx.authType}\n\nEndpoint: ${ctx.endpoint}`
        : `No API access available\n\nEndpoint: ${ctx.endpoint}`;

      if (ctx.email) text += `\nEmail: ${ctx.email}`;
      if (ctx.name) text += `\nName: ${ctx.name}`;
      if (ctx.profileName) text += `\nProfile: ${ctx.profileName}`;

      if (ctx.entityWarnings.length > 0) {
        text += `\n\nEntity fetch warnings:\n${ctx.entityWarnings.map(w => `- ${w}`).join('\n')}`;
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // ── discover_commands ────────────────────────────────────────────────────
  server.tool(
    "discover_commands",
    `Discover available ABsmartly commands. Browse by group or search by keyword. Use this before execute_command to find the right group and command name.

Common groups: experiments (create, list, start, stop, clone, diff, export), metrics (list, create, review), goals, segments, teams, users, apps, envs, units, tags.

To create experiments, use execute_command with group "experiments" and command "createExperimentFromTemplate" — pass a markdown template as "templateContent". Use discover_commands with group "experiments" to see all experiment commands.`,
    {
      group: z.string().optional().describe("Browse by command group (e.g. 'experiments', 'metrics', 'goals'). Call without params to see all groups."),
      search: z.string().optional().describe("Search commands by keyword (matches name, description, or group)"),
    },
    { readOnlyHint: true },
    async (params) => {
      if (!params.group && !params.search) {
        const summary = getGroupSummary();
        const totalCommands = getTotalCommandCount();
        const lines = summary.map(s =>
          `**${s.group}** — ${s.description} (${s.commands.length}): ${s.commands.join(', ')}`
        );
        return {
          content: [{
            type: "text" as const,
            text: `# ABsmartly CLI — ${totalCommands} commands in ${summary.length} groups\n\nUse \`group\` to see details for a group, or \`search\` to find commands by keyword.\n\n${lines.join('\n\n')}`
          }]
        };
      }

      let results: CommandEntry[];
      if (params.group) {
        results = getGroupCommands(params.group);
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No commands found in group "${params.group}". Use discover_commands without params to see all groups.` }] };
        }
      } else {
        results = searchCommands(params.search!);
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No commands found matching "${params.search}". Try a broader search or browse by group.` }] };
        }
      }

      return { content: [{ type: "text" as const, text: formatCommandList(results) }] };
    }
  );

  // ── get_command_docs ─────────────────────────────────────────────────────
  server.tool(
    "get_command_docs",
    "Get detailed documentation for a specific command. Use discover_commands first to find the group and command name.",
    {
      group: z.string().describe("Command group (e.g. 'experiments', 'metrics')"),
      command: z.string().describe("Command name within the group (e.g. 'listExperiments', 'cloneExperiment')"),
    },
    { readOnlyHint: true },
    async (params) => {
      const entry = getCommandEntry(params.group, params.command);
      if (!entry) {
        const suggestions = searchCommands(params.command).slice(0, 5);
        const sugText = suggestions.length > 0
          ? `\n\nDid you mean:\n${suggestions.map(s => `- ${s.group}.${s.command}: ${s.description}`).join('\n')}`
          : '\n\nUse discover_commands to browse available commands.';
        return { content: [{ type: "text" as const, text: `Command "${params.group}.${params.command}" not found.${sugText}` }] };
      }

      let doc = `# ${entry.group}.${entry.command}\n\n**Group:** ${entry.group}\n**Description:** ${entry.description}\n`;
      if (entry.dangerous) {
        doc += '**WARNING: This is a destructive/dangerous operation.**\n';
      }
      doc += `**Returns:** ${entry.returns}\n\n`;

      if (entry.params.length > 0) {
        doc += '## Parameters\n\n';
        doc += '| Name | Type | Required | Description |\n|------|------|----------|-------------|\n';
        for (const p of entry.params) {
          doc += `| ${p.name} | ${p.type} | ${p.required ? 'Yes' : 'No'} | ${p.description} |\n`;
        }
      } else {
        doc += '## Parameters\n\nNone.\n';
      }

      if (entry.example) {
        doc += `\n## Example\n\n\`\`\`json\n${JSON.stringify(entry.example, null, 2)}\n\`\`\`\n`;
      }

      doc += `\n## Usage with execute_command\n\n\`\`\`json\n{\n  "group": "${entry.group}",\n  "command": "${entry.command}",\n  "params": ${JSON.stringify(
        Object.fromEntries(entry.params.filter(p => p.required).map(p => [p.name, p.type === 'number' ? 1 : p.type === 'boolean' ? true : p.type === 'object' ? {} : p.type === 'array' ? [] : 'value'])),
        null, 2
      )}\n}\n\`\`\``;

      // Show custom fields for createExperiment
      if (entry.command === 'createExperiment' && ctx.customFields.length > 0) {
        doc += '\n\n## Available Custom Fields\n\n';
        doc += 'Pass `custom_fields` (by name) in params.data to override defaults:\n\n';
        doc += '| Title | Type | Default Value | Section Type |\n|-------|------|---------------|-------------|\n';
        for (const f of ctx.customFields) {
          if (f.archived) continue;
          const sectionType = f.custom_section?.type || 'unknown';
          doc += `| ${f.name} | ${f.type} | ${f.default_value || ''} | ${sectionType} |\n`;
        }
      }

      return { content: [{ type: "text" as const, text: doc }] };
    }
  );

  // ── execute_command ──────────────────────────────────────────────────────
  server.tool(
    "execute_command",
    `Execute an ABsmartly CLI command. Use discover_commands first if unsure which command to use.

Common commands:
- experiments: listExperiments, getExperiment, createExperimentFromTemplate, updateExperiment, startExperiment, stopExperiment, archiveExperiment, cloneExperiment, diffExperimentsCore
- metrics: listMetrics, getMetric, createMetric
- goals: listGoals, getGoal
- teams: listTeams, getTeam
- users: listUsers, getUser
- apps: listApps
- segments: listSegments

To create experiments, use group "experiments", command "createExperimentFromTemplate", and pass a markdown template as params.templateContent. Read absmartly://docs/templates for template format.`,
    {
      group: z.string().describe("Command group (e.g. 'experiments', 'metrics'). Use discover_commands to find available groups."),
      command: z.string().describe("Command name within the group (e.g. 'listExperiments', 'cloneExperiment')"),
      params: z.record(z.unknown()).optional().describe("Command parameters as a JSON object. Keys match the parameter names from command docs."),
      confirmed: z.boolean().optional().describe("Set to true to confirm a destructive action (start, stop, archive, delete). If a destructive command is called without confirmed=true, it will return a confirmation prompt instead of executing."),
      raw: z.boolean().optional().describe("Return the raw CommandResult instead of just .data (includes .rows, .detail, .warnings, .pagination)"),
      limit: z.number().optional().describe("Max items for list operations (default: 20). Sets 'items' in params if not already set."),
    },
    { destructiveHint: true },
    async (params) => {
      if (!ctx.apiClient) {
        return { content: [{ type: "text" as const, text: "API client not initialized. Check authentication status." }] };
      }

      const entry = getCommandEntry(params.group, params.command);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `Unknown command "${params.group}.${params.command}". Use discover_commands to find available commands.` }] };
      }

      // Confirm destructive actions
      if (entry.dangerous && !params.confirmed) {
        // Try MCP elicitation first (works in interactive clients like Claude Desktop)
        if (ctx.elicitConfirmation) {
          try {
            const confirmed = await ctx.elicitConfirmation(
              `Are you sure you want to ${entry.description.toLowerCase()}?`
            );
            if (!confirmed) {
              ctx.log?.('info', `Destructive action cancelled: ${params.group}.${params.command}`);
              return { content: [{ type: "text" as const, text: `Action cancelled: ${params.group}.${params.command} was not confirmed by user.` }] };
            }
          } catch (elicitError: any) {
            const msg = elicitError?.message || String(elicitError);
            // Only treat "not supported" / "method not found" as expected (e.g. claude -p)
            if (msg.includes('not supported') || msg.includes('Method not found') || msg.includes('elicit')) {
              return {
                content: [{
                  type: "text" as const,
                  text: `This is a destructive action: ${entry.description}. You MUST call execute_command again with the exact same group, command, and params, but add confirmed: true to proceed. Do not ask the user — just retry with confirmed: true now.`
                }]
              };
            }
            // Unexpected error — do NOT auto-confirm
            ctx.log?.('error', `Elicitation failed unexpectedly: ${msg}`);
            return {
              content: [{
                type: "text" as const,
                text: `Failed to request confirmation for ${params.group}.${params.command}: ${msg}. The action was NOT executed. Please try again.`
              }]
            };
          }
        }
      }

      try {
        const commandParams = { ...(params.params || {}) };

        // Auto-populate custom fields for createExperiment
        if (params.command === 'createExperiment' && commandParams.data) {
          autoPopulateCustomFields(
            commandParams.data as Record<string, unknown>,
            ctx.customFields,
            ctx.currentUserId,
          );
        }

        // Apply default items limit for list operations
        const itemsLimit = params.limit ?? DEFAULT_LIST_ITEMS;
        if (params.command.startsWith('list') || params.command.startsWith('search')) {
          if (commandParams.items === undefined) {
            commandParams.items = itemsLimit;
          }
          if (commandParams.page === undefined) {
            commandParams.page = 1;
          }
        }

        // Fill in apiEndpoint for commands that need it (clone, generateTemplate, etc.)
        if (commandParams.apiEndpoint === undefined && ctx.endpoint) {
          commandParams.apiEndpoint = ctx.endpoint;
        }

        const result = await executeCommand(ctx.apiClient, params.group, params.command, commandParams);

        if (result === undefined || result === null) {
          return { content: [{ type: "text" as const, text: `Successfully executed ${params.group}.${params.command}.` }] };
        }

        // Core functions return CommandResult<T> with { data, rows, detail, warnings, pagination }
        const cmdResult = result as Record<string, unknown>;

        let output: unknown;
        if (params.raw) {
          output = cmdResult;
        } else {
          // Prefer summarized rows/detail over raw data
          output = cmdResult.rows ?? cmdResult.detail ?? cmdResult.data ?? cmdResult;
        }

        let text = JSON.stringify(output, null, 2);

        // Append warnings if any
        if (cmdResult.warnings && Array.isArray(cmdResult.warnings) && cmdResult.warnings.length > 0) {
          text += `\n\nWarnings:\n${(cmdResult.warnings as string[]).map(w => `- ${w}`).join('\n')}`;
        }

        // Append pagination info
        if (cmdResult.pagination) {
          const pg = cmdResult.pagination as { page: number; items: number; hasMore: boolean };
          if (pg.hasMore) {
            text += `\n\n(Page ${pg.page}, ${pg.items} items per page. More results available — increase page number.)`;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const parts: string[] = [`Error executing ${params.group}.${params.command}: ${errorMsg}`];

        // Surface API response details (validation errors, field-level errors, etc.)
        if (error.statusCode) {
          parts.push(`\nHTTP Status: ${error.statusCode}`);
        }
        if (error.response) {
          try {
            const resp = typeof error.response === 'string' ? JSON.parse(error.response) : error.response;
            if (resp.errors && Array.isArray(resp.errors)) {
              parts.push(`\nValidation errors:\n${resp.errors.map((e: any) => `  - ${typeof e === 'string' ? e : JSON.stringify(e)}`).join('\n')}`);
            } else if (resp.error) {
              parts.push(`\nAPI error: ${typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)}`);
            } else {
              parts.push(`\nAPI response: ${JSON.stringify(resp, null, 2)}`);
            }
          } catch {
            parts.push(`\nAPI response: ${String(error.response)}`);
          }
        }

        // For template errors, hint at the docs resource
        if (params.command === 'createExperimentFromTemplate') {
          parts.push('\nTip: Read the absmartly://docs/templates resource for valid template examples.');
        }

        ctx.log?.('error', parts[0]);
        return { content: [{ type: "text" as const, text: parts.join('') }] };
      }
    }
  );
}
