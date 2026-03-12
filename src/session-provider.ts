import { ABsmartlyMCP } from "./index";
import type { Env } from "./types";
import { debug } from "./config";
import {
  ABsmartlyProps,
  CORS_HEADERS,
  detectApiKey,
} from "./shared";

export class SessionProvider {
  private apiHandler: any;

  constructor(apiHandler: any) {
    this.apiHandler = apiHandler;
  }

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...CORS_HEADERS,
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const { apiKey, endpoint } = detectApiKey(request);

    if (!apiKey || !endpoint) {
      return new Response("Missing or invalid API key", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Api-Key realm="ABsmartly"'
        }
      });
    }

    const props: ABsmartlyProps = {
      email: 'api-key-user@example.com',
      name: 'API Key User',
      absmartly_endpoint: endpoint,
      absmartly_api_key: apiKey,
      user_id: 'api-key-user'
    };

    const enrichedCtx = { ...ctx, props };

    debug("API key authenticated, routing to MCP with session management");

    return this.apiHandler.fetch(request, env, enrichedCtx);
  }
}
