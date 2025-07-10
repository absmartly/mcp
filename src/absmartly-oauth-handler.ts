import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
} from "./workers-oauth-utils";

// Props that will be available to the MCP agent after authentication
export type ABsmartlyProps = {
	email: string;
	absmartly_endpoint: string;
	absmartly_api_key: string;
	user_id: string;
	name?: string;
	oauth_jwt?: string;
};

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
	// Debug log collection
	const debugLogs: string[] = [];
	
	// Helper to log debug messages
	const debug = (message: string, data?: any): void => {
		const timestamp = new Date().toISOString();
		const logEntry = data 
			? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
			: `[${timestamp}] ${message}`;
		debugLogs.push(logEntry);
		console.log(logEntry);
	};
	
	debug('=== Worker OAuth Authorize Debug ===');
	debug('URL', c.req.url);
	debug('Query params', c.req.query());
	
	// Dump all headers for client identification
	const headers: Record<string, string> = {};
	for (const [key, value] of c.req.raw.headers.entries()) {
		headers[key] = value;
	}
	debug('Request headers', headers);
	
	// Dump request body if present
	if (c.req.raw.method === 'POST' && c.req.raw.body) {
		try {
			const clonedRequest = c.req.raw.clone();
			const body = await clonedRequest.text();
			debug('Request body', body);
		} catch (error) {
			debug('Could not read request body', error);
		}
	}
	
	// Extract and store ABsmartly endpoint from resource parameter
	const resourceParam = c.req.query('resource');
	debug('Resource parameter', resourceParam);
	if (resourceParam && c.env.OAUTH_KV) {
		try {
			const resourceUrl = new URL(resourceParam);
			debug('Parsed resource URL', resourceUrl.href);
			debug('Resource URL search params', Object.fromEntries(resourceUrl.searchParams.entries()));
			const absmartlyEndpoint = resourceUrl.searchParams.get('absmartly-endpoint');
			debug('Extracted ABsmartly endpoint', absmartlyEndpoint);
			if (absmartlyEndpoint) {
				debug('Storing ABsmartly endpoint from resource param', absmartlyEndpoint);
				await c.env.OAUTH_KV.put("absmartly_endpoint_config", absmartlyEndpoint);
			} else {
				debug('No absmartly-endpoint found in resource URL');
			}
		} catch (e) {
			debug('Failed to parse resource parameter', e);
		}
	} else {
		debug('No resource parameter or OAUTH_KV not available', { 
			hasResourceParam: !!resourceParam,
			hasOAuthKV: !!c.env.OAUTH_KV
		});
	}
	
	debug('About to parse OAuth request');
	let oauthReqInfo;
	try {
		oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
		debug('Parsed OAuth request', oauthReqInfo);
	} catch (error) {
		debug('Error parsing OAuth request', error);
		debug('Error message', error.message);
		debug('Error stack', error.stack);
		return c.text(`OAuth request parsing failed: ${error.message}\n\nDebug Logs:\n${debugLogs.join('\n')}`, 400);
	}
	
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		debug('No client ID found, returning error');
		return c.text(`Invalid request\n\nDebug Logs:\n${debugLogs.join('\n')}`, 400);
	}
	
	debug('Client ID found', clientId);

	// Debug: check what the client lookup returns
	try {
		const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(clientId);
		debug('Client lookup result', clientInfo);
		if (clientInfo) {
			debug('Client redirectUris', clientInfo.redirectUris);
			debug('Client redirectUris type', typeof clientInfo.redirectUris);
			debug('Client redirectUris is array', Array.isArray(clientInfo.redirectUris));
		}
	} catch (error) {
		debug('Client lookup error', error);
	}

	// Check if client is already approved
	try {
		debug('Checking if client is already approved', oauthReqInfo.clientId);
		const isApproved = await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY || "default-key");
		debug('Client approval check result', isApproved);
		
		if (isApproved) {
			debug('Client is already approved, redirecting to OAuth');
			return redirectToAbsmartlyOAuth(c, c.req.raw, oauthReqInfo, {}, debugLogs);
		}
	} catch (error) {
		debug('Error in client approval check', error);
		debug('Error message', error.message);
		debug('Error stack', error.stack);
		// Continue to approval dialog even if check fails
	}

	// Show approval dialog
	const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(clientId);
	debug('Client info for approval dialog', clientInfo);
	
	// Try to extract client name from recent request body if available
	let inferredClientName = null;
	if (c.env.OAUTH_KV) {
		try {
			// Try specific client ID first, then fall back to latest
			let storedClientInfo = await c.env.OAUTH_KV.get(`inferred_client:${clientId}`);
			if (!storedClientInfo) {
				storedClientInfo = await c.env.OAUTH_KV.get(`inferred_client:latest`);
			}
			if (storedClientInfo) {
				inferredClientName = JSON.parse(storedClientInfo).name;
				debug('Found inferred client name', inferredClientName);
			}
		} catch (e) {
			debug('Error reading inferred client info', e);
		}
	}
	
	// Create enhanced client info with inferred name if available
	const enhancedClientInfo = clientInfo ? clientInfo : {
		clientId: clientId,
		clientName: inferredClientName || clientId,
		redirectUris: [oauthReqInfo.redirectUri]
	};
	
	return renderApprovalDialog(c.req.raw, {
		client: enhancedClientInfo,
		server: {
			description: "This MCP server provides access to ABsmartly experiment management tools using SAML-based authentication.",
			logo: "https://docs.absmartly.com/img/logo.png",
			name: "ABsmartly MCP Server",
		},
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	// Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
	const { state, headers } = await parseRedirectApproval(c.req.raw, env.COOKIE_ENCRYPTION_KEY || "default-key");
	if (!state.oauthReqInfo) {
		return c.text("Invalid request", 400);
	}

	return redirectToAbsmartlyOAuth(c, c.req.raw, state.oauthReqInfo, headers, []);
});

async function redirectToAbsmartlyOAuth(
	c: any,
	request: Request,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
	debugLogs: string[] = [],
) {
	// Helper to log debug messages
	const debug = (message: string, data?: any): void => {
		const timestamp = new Date().toISOString();
		const logEntry = data 
			? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
			: `[${timestamp}] ${message}`;
		debugLogs.push(logEntry);
		console.log(logEntry);
	};
	
	// Get the endpoint from KV storage (stored from headers)
	let endpoint = null;
	if (c.env.OAUTH_KV) {
		const storedEndpoint = await c.env.OAUTH_KV.get("absmartly_endpoint_config");
		debug('Retrieved from KV storage', { storedEndpoint, hasKV: !!c.env.OAUTH_KV });
		if (storedEndpoint) {
			endpoint = storedEndpoint;
			debug('Using stored endpoint', endpoint);
		} else {
			debug('No endpoint found in KV storage');
		}
	} else {
		debug('No OAUTH_KV available');
	}
	
	// If we still don't have an endpoint, try to use a reasonable default
	if (!endpoint) {
		debug('No endpoint available, using default');
		endpoint = "https://sandbox.absmartly.com";
	}
	
	debug('Final endpoint to use', endpoint);
	
	// Redirect to our SAML → OAuth bridge (at /auth/oauth/authorize)
	const absmartlyOAuthUrl = new URL(`${endpoint}/auth/oauth/authorize`);
	absmartlyOAuthUrl.searchParams.set("client_id", "mcp-absmartly-universal");
	absmartlyOAuthUrl.searchParams.set("redirect_uri", new URL("/oauth/callback", request.url).href);
	absmartlyOAuthUrl.searchParams.set("scope", "api:read api:write");
	absmartlyOAuthUrl.searchParams.set("response_type", "code");
	absmartlyOAuthUrl.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));
	
	// Add ngrok bypass header as query param if using ngrok
	if (endpoint && endpoint.includes("ngrok")) {
		absmartlyOAuthUrl.searchParams.set("ngrok-skip-browser-warning", "true");
	}

	return new Response(null, {
		headers: {
			...headers,
			location: absmartlyOAuthUrl.toString(),
		},
		status: 302,
	});
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from ABsmartly after user authentication.
 * It exchanges the temporary code for an access token, then stores the
 * user metadata & credentials as part of the 'props' on the token passed
 * down to the MCP client.
 */
app.get("/oauth/callback", async (c) => {
	// Debug log collection
	const debugLogs: string[] = [];
	
	// Helper to log debug messages
	const debug = (message: string, data?: any): void => {
		const timestamp = new Date().toISOString();
		const logEntry = data 
			? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
			: `[${timestamp}] ${message}`;
		debugLogs.push(logEntry);
		console.log(logEntry);
	};
	
	debug('=== OAuth Callback Debug ===');
	debug('URL', c.req.url);
	debug('Query params', c.req.query());
	
	// Get the oauthReqInfo out of the state parameter
	const stateParam = c.req.query("state");
	debug('State parameter', stateParam);
	
	const oauthReqInfo = JSON.parse(atob(stateParam as string)) as AuthRequest;
	debug('Parsed OAuth request info', oauthReqInfo);
	
	if (!oauthReqInfo.clientId) {
		debug('No client ID in state, returning error');
		return c.text(`Invalid state\n\nDebug Logs:\n${debugLogs.join('\n')}`, 400);
	}

	const code = c.req.query("code");
	debug('Authorization code', code);
	
	if (!code) {
		debug('No authorization code provided');
		return c.text(`Authorization code not provided\n\nDebug Logs:\n${debugLogs.join('\n')}`, 400);
	}

	try {
		// Get the endpoint from KV storage
		let endpoint = "https://dev-1.absmartly.com"; // Default fallback
		if (c.env.OAUTH_KV) {
			const storedEndpoint = await c.env.OAUTH_KV.get("absmartly_endpoint_config");
			if (storedEndpoint) {
				endpoint = storedEndpoint;
			}
		}
		
		// Exchange the code for an access token with our SAML → OAuth bridge (at /auth/oauth/token)
		const tokenUrl = `${endpoint}/auth/oauth/token`;
		const requestBody = new URLSearchParams({
			grant_type: "authorization_code",
			client_id: "mcp-absmartly-universal", // Use the pre-registered universal client
			code: code,
			redirect_uri: new URL("/oauth/callback", c.req.url).href,
		});
		// Note: No client_secret needed for the universal client
		
		debug('Token exchange request URL', tokenUrl);
		debug('Token exchange request body', Object.fromEntries(requestBody.entries()));
		
		const tokenResponse = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": "ABsmartly-MCP-OAuth/1.0",
				"Accept": "application/json",
				"ngrok-skip-browser-warning": "true", // Required for ngrok endpoints
				"CF-Connecting-IP": "127.0.0.1", // Bypass Cloudflare bot protection
				"X-Forwarded-For": "127.0.0.1", // Additional bypass header
			},
			body: requestBody,
		});

		debug('Token response status', tokenResponse.status);
		const responseText = await tokenResponse.text();
		debug('Token response body', responseText);

		if (!tokenResponse.ok) {
			debug('Token exchange failed', responseText);
			return c.text(`Failed to exchange authorization code: ${responseText}\n\nDebug Logs:\n${debugLogs.join('\n')}`, 400);
		}

		const tokenData = JSON.parse(responseText);
		debug('Parsed token data', tokenData);
		debug('Token data keys', Object.keys(tokenData));
		
		const { access_token } = tokenData;

		// Decode the JWT to extract user information
		let userInfo: any = {};
		try {
			// JWT has 3 parts separated by dots: header.payload.signature
			const jwtParts = access_token.split('.');
			if (jwtParts.length === 3) {
				// Decode the payload (middle part)
				const payload = atob(jwtParts[1]);
				userInfo = JSON.parse(payload);
				debug('Decoded JWT payload', userInfo);
			}
		} catch (error) {
			debug('Failed to decode JWT', error);
		}

		// Extract user information from JWT payload
		const email = userInfo?.email || userInfo?.sub || "unknown@example.com";
		const name = userInfo?.name || userInfo?.given_name || email;
		const userId = userInfo?.sub || userInfo?.absmartly_user_id?.toString() || email;
		
		debug('Extracted user information', { email, name, userId, userInfo });

		// The access token from our bridge should contain the ABsmartly API key
		// Use the endpoint from configuration, removing any trailing slashes
		const cleanEndpoint = endpoint.replace(/\/+$/, '');
		const absmartlyEndpoint = cleanEndpoint.endsWith('/v1') ? cleanEndpoint : `${cleanEndpoint}/v1`;
		
		// Check if the token response has an api_key field
		// The OAuth JWT is NOT a valid API key - we need to get the user's API key separately
		const absmartlyApiKey = tokenData.api_key || tokenData.absmartly_api_key || null;
		
		debug('Token response analysis:', {
			hasApiKey: !!absmartlyApiKey,
			accessTokenIsJWT: access_token?.includes('.') && access_token.split('.').length === 3,
			tokenDataKeys: Object.keys(tokenData)
		});
		
		if (!absmartlyApiKey) {
			debug('No API key found in token response. Will use OAuth JWT for authentication.');
		} else {
			debug('API key found in token response:', absmartlyApiKey?.substring(0, 10) + '...');
		}
		
		debug('ABsmartly configuration', { 
			absmartlyEndpoint, 
			hasApiKey: !!absmartlyApiKey,
			hasOAuthJWT: !!access_token
		});

		// Return back to the MCP client a new token with ABsmartly credentials
		const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
			metadata: {
				label: name || email,
			},
			// This will be available on this.props inside AbsmartlyMcpOAuth
			props: {
				email,
				name,
				absmartly_endpoint: absmartlyEndpoint,
				absmartly_api_key: absmartlyApiKey, // Only set if we have a real API key
				user_id: userId,
				oauth_jwt: access_token, // Store the original OAuth JWT
			} as ABsmartlyProps,
			request: oauthReqInfo,
			scope: oauthReqInfo.scope,
			userId: userId,
		});
		
		debug('OAuth authorization completed successfully', { redirectTo });

		return Response.redirect(redirectTo);
	} catch (error) {
		debug('OAuth callback error', error);
		debug('Error message', error?.message);
		debug('Error stack', error?.stack);
		return c.text(`Authentication failed: ${error?.message || error}\n\nDebug Logs:\n${debugLogs.join('\n')}`, 500);
	}
});

export { app as ABsmartlyOAuthHandler };