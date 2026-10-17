import { ABsmartlyMCP } from "./index.js";
import type { Env } from "./types.js";
import { debug } from "./config.js";
import {
  ABsmartlyProps,
  CORS_HEADERS,
  DEFAULT_API_KEY_USER_EMAIL,
  DEFAULT_API_KEY_USER_NAME,
  detectApiKey,
} from "./shared.js";
import { HTTP_STATUS_BAD_REQUEST, MESSAGE_INVALID_ENDPOINT, tryParseAbsmartlyEndpoint } from "./oauth/index.js";

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

    const parsedEndpoint = tryParseAbsmartlyEndpoint(endpoint);
    if (!parsedEndpoint) {
      return new Response(MESSAGE_INVALID_ENDPOINT, { status: HTTP_STATUS_BAD_REQUEST, headers: CORS_HEADERS });
    }

    const props: ABsmartlyProps = {
      email: DEFAULT_API_KEY_USER_EMAIL,
      name: DEFAULT_API_KEY_USER_NAME,
      absmartly_endpoint: parsedEndpoint.apiUrl,
      absmartly_api_key: apiKey,
      user_id: DEFAULT_API_KEY_USER_EMAIL,
    };

    const enrichedCtx = { ...ctx, props };

    debug("API key authenticated, routing to MCP with session management");

    return this.apiHandler.fetch(request, env, enrichedCtx);
  }
}
