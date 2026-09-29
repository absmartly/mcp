import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerServer } from "./register-server.js";
import type { RegisterServerOptions } from "./register-server.js";
import type { ServerContext } from "./server-context.js";

const ELICIT_CONFIRM_TITLE = 'Confirm';
const ELICIT_CONFIRM_DESCRIPTION = "Type 'yes' to confirm this destructive action";
const ELICIT_CONFIRM_ANSWER = 'yes';

export function registerLocalServer(
    mcpServer: McpServer,
    ctx: ServerContext,
    opts: Omit<RegisterServerOptions, 'elicitConfirmation'> = {},
): void {
    const elicitConfirmation = async (message: string): Promise<boolean> => {
        const result = await mcpServer.server.elicitInput({
            message,
            requestedSchema: {
                type: "object" as const,
                properties: {
                    confirm: {
                        type: "string",
                        title: ELICIT_CONFIRM_TITLE,
                        description: ELICIT_CONFIRM_DESCRIPTION,
                    }
                },
                required: ["confirm"]
            }
        });
        return result.action === 'accept' && result.content?.confirm === ELICIT_CONFIRM_ANSWER;
    };
    registerServer(mcpServer, ctx, { ...opts, elicitConfirmation });
}
