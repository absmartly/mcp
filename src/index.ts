import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { ABsmartlyAPIClient } from "./api-client";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { ABsmartlyResources } from "./resources";
// import type { Env } from "./types";

// Default ABsmartly API endpoint
const DEFAULT_ABSMARTLY_ENDPOINT = "https://dev-1.absmartly.com/v1";

// Default OAuth configuration
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";
const DEFAULT_BACKEND_ENDPOINT = "https://dev-1.absmartly.com";

export class ABsmartlyMCP extends McpAgent<any, Record<string, never>, any> {
	server = new McpServer({
		name: "ABsmartly MCP Server",
		version: "1.0.0",
		capabilities: {
			tools: {},
			resources: {},
			prompts: {}
		}
	});

	private apiClient: ABsmartlyAPIClient | null = null;
	private customFields: any[] = [];
	private users: any[] = [];
	private teams: any[] = [];
	private applications: any[] = [];
	private unitTypes: any[] = [];
	private experimentTags: any[] = [];
	private metrics: any[] = [];
	private goals: any[] = [];
	
	// OAuth props from authentication
	props: any = null;
	
	// Debug log collection
	private debugLogs: string[] = [];
	
	constructor(ctx: DurableObjectState, env: any) {
		console.log("🚨 ABsmartlyMCP constructor START");
		super(ctx, env);
		console.log("🚨 ABsmartlyMCP constructor completed");
	}
	
	
	// Helper to log debug messages
	private debug(message: string, data?: any): void {
		const timestamp = new Date().toISOString();
		const logEntry = data 
			? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
			: `[${timestamp}] ${message}`;
		this.debugLogs.push(logEntry);
		console.log(logEntry);
	}

	async init() {
		console.log("🚀 AbsmartlyMcpOAuth.init() START");
		try {
			this.debug("🚀 AbsmartlyMcpOAuth.init() called");
			this.debug("🔍 Environment:", {
				env: this.env ? Object.keys(this.env) : 'none',
				request: this.request ? 'present' : 'none',
				props: this.props ? 'present' : 'none'
			});
			
			// Check if we have request headers with ABsmartly credentials
			if (this.request) {
				const headers = Object.fromEntries(this.request.headers.entries());
				this.debug("📋 Request headers:", headers);
				
				// Try to get credentials from headers if OAuth props are missing
				const apiKeyFromHeader = this.request.headers.get('x-absmartly-api-key');
				const endpointFromHeader = this.request.headers.get('x-absmartly-endpoint');
				
				this.debug("🔍 Header credentials check:", {
					apiKeyFromHeader: apiKeyFromHeader ? apiKeyFromHeader.substring(0, 10) + '...' : 'none',
					endpointFromHeader: endpointFromHeader || 'none',
					hasPropsApiKey: !!(this.props && this.props.absmartly_api_key)
				});
				
				if (apiKeyFromHeader && endpointFromHeader && (!this.props || !this.props.absmartly_api_key)) {
					this.debug("🔑 Using credentials from request headers");
					// Create props from headers
					this.props = {
						email: 'unknown@example.com',
						name: 'API Key User',
						absmartly_endpoint: endpointFromHeader,
						absmartly_api_key: apiKeyFromHeader,
						user_id: 'api-key-user'
					};
					this.debug("🔑 Created props from headers:", {
						email: this.props.email,
						endpoint: this.props.absmartly_endpoint,
						hasApiKey: !!this.props.absmartly_api_key
					});
				}
			}
			
			// Let's inspect what's in the props tokens
			if (this.props?.absmartly_api_key && this.props.absmartly_api_key.includes('.')) {
				try {
					const parts = this.props.absmartly_api_key.split('.');
					if (parts.length === 3) {
						const payload = JSON.parse(atob(parts[1]));
						this.debug("🔍 Props absmartly_api_key JWT payload:", {
							keys: Object.keys(payload),
							hasToken: 'token' in payload,
							hasEmail: 'email' in payload,
							hasIss: 'iss' in payload,
							iss: payload.iss,
							token: payload.token ? 'present' : 'missing'
						});
					}
				} catch (e) {
					this.debug("❌ Failed to decode absmartly_api_key JWT:", e.message);
				}
			}
			
			if (this.props?.oauth_jwt && this.props.oauth_jwt.includes('.')) {
				try {
					const parts = this.props.oauth_jwt.split('.');
					if (parts.length === 3) {
						const payload = JSON.parse(atob(parts[1]));
						this.debug("🔍 Props oauth_jwt JWT payload:", {
							keys: Object.keys(payload),
							hasToken: 'token' in payload,
							hasEmail: 'email' in payload,
							hasIss: 'iss' in payload,
							iss: payload.iss,
							token: payload.token ? 'present' : 'missing'
						});
					}
				} catch (e) {
					this.debug("❌ Failed to decode oauth_jwt JWT:", e.message);
				}
			}

			this.debug("🔑 Props after header check:", {
				email: this.props?.email,
				endpoint: this.props?.absmartly_endpoint,
				apiKey: this.props?.absmartly_api_key ? this.props.absmartly_api_key.substring(0, 10) + '...' : 'none',
				oauthJwt: this.props?.oauth_jwt ? this.props.oauth_jwt.substring(0, 20) + '...' : 'none',
				hasProps: !!this.props,
				propsKeys: this.props ? Object.keys(this.props) : []
			});

			if (!this.props || !this.props.absmartly_endpoint) {
				this.debug("❌ Missing required props for initialization");
				throw new Error("Missing required ABsmartly credentials");
			}

			// Check if we have authentication token (API key or OAuth JWT)
			if (!this.props.absmartly_api_key && !this.props.oauth_jwt) {
				this.debug("⚠️ No authentication token available - need API key or OAuth JWT");
				// Continue initialization but API calls won't work
				this.apiClient = null;
			} else {
				// Determine auth token and type
				let authToken: string;
				let authType: 'api-key' | 'jwt';
				
				// Check if we have a valid API key (should not contain @ or : which indicates it's not a real API key)
				const hasValidApiKey = this.props.absmartly_api_key && 
					!this.props.absmartly_api_key.includes('@') && 
					!this.props.absmartly_api_key.includes(':') &&
					!this.props.absmartly_api_key.startsWith('unknown');
				
				if (hasValidApiKey) {
					// We have a valid API key - use it
					authToken = this.props.absmartly_api_key;
					authType = 'api-key';
					this.debug("🔑 Using ABsmartly API key for authentication");
				} else if (this.props.oauth_jwt) {
					// We have an OAuth JWT - use it
					authToken = this.props.oauth_jwt;
					authType = 'jwt';
					this.debug("🔑 Using OAuth JWT for authentication");
				} else if (this.props.absmartly_api_key) {
					// We have an invalid API key, but let's try using it anyway and log the issue
					authToken = this.props.absmartly_api_key;
					authType = 'api-key';
					this.debug("⚠️ Using potentially invalid API key (contains @ or :):", this.props.absmartly_api_key.substring(0, 20) + '...');
				} else {
					this.debug("❌ No valid authentication token found");
					throw new Error("No authentication token available");
				}
				
				this.debug(`🔑 Initializing API client with ${authType} authentication`);
				this.debug(`🔑 Token preview: ${authToken?.substring(0, 20)}...`);
				this.debug(`🔑 Token length: ${authToken?.length}`);
				
				// If it's a JWT, let's try to decode and inspect it
				if (authType === 'jwt' && authToken) {
					try {
						const parts = authToken.split('.');
						this.debug(`🔍 JWT structure: ${parts.length} parts`);
						if (parts.length === 3) {
							const payload = JSON.parse(atob(parts[1]));
							this.debug(`🔍 JWT payload keys: ${Object.keys(payload)}`);
							this.debug(`🔍 JWT payload content:`, payload);
						}
					} catch (jwtError) {
						this.debug(`❌ Failed to decode JWT: ${jwtError.message}`);
					}
				}
				
				// Initialize API client with authenticated user's credentials
				this.apiClient = new ABsmartlyAPIClient(
					authToken,
					this.props.absmartly_endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
					authType
				);
				
				this.debug("✅ API client initialized successfully");
			}

			// Fetch custom fields for dynamic schema generation (non-blocking)
			this.debug("📦 Starting fetchAndStoreCustomFields in background");
			this.fetchAndStoreCustomFields().catch(error => {
				this.debug("📦 Background custom fields fetch failed:", error);
			});
			this.debug("📦 Custom fields fetch started in background");

			// Setup tools
			this.debug("🔧 Starting setupTools");
			this.setupTools();
			this.debug("🔧 Completed setupTools");
			
			// Setup resources
			this.debug("📚 Starting setupResources");
			this.setupResources();
			this.debug("📚 Completed setupResources");
			
			// Setup prompts
			this.debug("💡 Starting setupPrompts");
			this.setupPrompts();
			this.debug("💡 Completed setupPrompts");
			
			this.debug("✅ AbsmartlyMcpOAuth initialization completed successfully");
			console.log("✅ AbsmartlyMcpOAuth.init() completed successfully");
		} catch (error) {
			console.error("❌ AbsmartlyMcpOAuth.init() ERROR:", error);
			console.error("❌ Init error message:", error?.message);
			console.error("❌ Init error stack:", error?.stack);
			this.debug("❌ Error in AbsmartlyMcpOAuth.init()", error);
			throw error;
		}
	}

	private async fetchAndStoreCustomFields(): Promise<void> {
		console.log("📦 fetchAndStoreCustomFields START");
		try {
			this.debug("📦 fetchAndStoreCustomFields - checking API client");
			if (!this.apiClient) {
				console.log("📦 No API client - setting empty custom fields");
				this.debug("📦 No API client available, skipping custom fields fetch");
				this.customFields = [];
				return;
			}

			console.log("📦 Fetching custom fields from API");
			this.debug("📦 About to call listExperimentCustomSectionFields API");
			this.debug("📦 API client endpoint:", this.apiClient.apiEndpoint);
			
			const response = await this.apiClient.listExperimentCustomSectionFields({ items: 100 });
			
			this.debug("📦 API response received:", {
				ok: response.ok,
				hasData: !!response.data,
				hasCustomFields: !!(response.data?.experiment_custom_section_fields),
				errors: response.errors
			});
			
			if (!response.ok || !response.data?.experiment_custom_section_fields) {
				console.log("📦 API response not OK or no custom fields data");
				this.debug("📦 API response details:", response);
				this.customFields = [];
				return;
			}

			this.customFields = response.data.experiment_custom_section_fields;
			this.debug("✅ Fetched custom fields:", this.customFields.length);
			console.log("✅ fetchAndStoreCustomFields completed successfully");
		} catch (error) {
			console.error("❌ fetchAndStoreCustomFields ERROR:", error);
			console.error("❌ fetchAndStoreCustomFields error message:", error?.message);
			console.error("❌ fetchAndStoreCustomFields error stack:", error?.stack);
			this.debug("❌ Error fetching custom fields:", error);
			this.customFields = [];
		}
	}

	private setupTools() {
		console.log("🔧 setupTools START");
		try {
			// Authentication status tool
			console.log("🔧 Setting up authentication status tool");
			this.server.tool(
				"get_auth_status",
				{},
				async () => {
					const hasApiAccess = !!this.apiClient;
					const authType = this.props?.absmartly_api_key ? 'API Key' : (this.props?.oauth_jwt ? 'OAuth JWT' : 'None');
					const status = hasApiAccess ? "✅ Authenticated with API access" : "⚠️ No API access available";
					const details = [
						`Email: ${this.props?.email || 'Unknown'}`,
						`Name: ${this.props?.name || 'Unknown'}`,
						`Endpoint: ${this.props?.absmartly_endpoint || 'Not configured'}`,
						`Authentication Type: ${authType}`,
						`API Access: ${hasApiAccess ? 'Available' : 'Not available'}`,
						``,
						hasApiAccess ? 
							`You can use ABsmartly tools to manage experiments.` :
							`To use ABsmartly tools, you need to provide either an API key via headers or complete the OAuth flow to get a JWT token.`
					].join('\n');

					return {
						content: [
							{
								type: "text",
								text: `${status}\n\n${details}`,
							},
						],
					};
				}
			);

			// Debug logs tool
			console.log("🔧 Setting up debug logs tool");
			this.server.tool(
				"get_debug_logs",
				{},
				async () => {
					const logs = this.debugLogs.slice(-100); // Get last 100 debug logs
					return {
						content: [
							{
								type: "text",
								text: `📋 Debug logs (last ${logs.length} entries):\n\n${logs.join('\n')}`,
							},
						],
					};
				}
			);
		
			// List experiments tool
			this.server.tool(
				"list_experiments",
				{
					search: z.string().optional().describe("Search experiments by name or description"),
					sort: z.string().optional().describe("Sort field (e.g., created_at, name, state)"),
					page: z.number().optional().describe("Page number (1-based)"),
					items: z.number().optional().describe("Number of items per page (default: 10)"),
				},
				async (params) => {
					this.debug("🔧 list_experiments tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. This should not happen with OAuth authentication.",
								},
							],
						};
					}

					try {
						this.debug("📡 Calling listExperiments API", params);
						const response = await this.apiClient.listExperiments({
							search: params.search,
							sort: params.sort,
							page: params.page,
							items: params.items || 10,
						});

						if (!response.ok) {
							this.debug("❌ API request failed", {
								status: response.status,
								statusText: response.statusText,
								body: response.data
							});
							return {
								content: [
									{
										type: "text",
										text: `❌ API request failed: ${response.status} ${response.statusText}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const experiments = response.data?.experiments || [];
						const summary = `Found ${experiments.length} experiments`;
						
						let experimentsList = experiments.map((exp: any) => 
							`• **${exp.display_name || exp.name}** (${exp.state}) - ID: ${exp.id}`
						).join('\n');

						if (experimentsList.length === 0) {
							experimentsList = "No experiments found";
						}

						return {
							content: [
								{
									type: "text",
									text: `${summary}\n\n${experimentsList}`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in listExperiments", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error fetching experiments: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			console.log("✅ setupTools completed successfully");
		} catch (error) {
			console.error("❌ setupTools ERROR:", error);
			console.error("❌ setupTools error stack:", error?.stack);
			throw error;
		}
	}
	
	/**
	 * Setup resources that can be read by the MCP client
	 */
	setupResources() {
		try {
			console.log("📚 Setting up resources with ABsmartlyResources class");
			
			// Use the dedicated resources class for comprehensive documentation
			const resourcesManager = new ABsmartlyResources(this);
			resourcesManager.setupResources();
			
			// Add experiment template resource with all available entities
			this.server.resource(
				"absmartly://templates/experiment",
				"application/json",
				{
					name: "Experiment Template",
					description: "Template for creating new experiments with available entities"
				},
				async () => {
					const template = {
						state: "ready",
						name: "my_new_experiment",
						display_name: "My New Experiment",
						description: "Description of the experiment",
						hypothesis: "We believe that changing X will result in Y",
						iteration: 1,
						percentage_of_traffic: 100,
						unit_type: this.unitTypes.length > 0 ? {
							unit_type_id: this.unitTypes[0].id
						} : { unit_type_id: 1 },
						nr_variants: 2,
						percentages: "50/50",
						audience: '{"filter":[{"and":[]}]}',
						audience_strict: true,
						owners: this.users.length > 0 ? [
							{ user_id: this.users[0].id }
						] : [],
						teams: this.teams.length > 0 ? [
							{ team_id: this.teams[0].id }
						] : [],
						experiment_tags: this.experimentTags.length > 0 ? [
							{ experiment_tag_id: this.experimentTags[0].id }
						] : [],
						applications: this.applications.length > 0 ? [
							{
								application_id: this.applications[0].id,
								application_version: "0"
							}
						] : [],
						primary_metric: this.metrics.length > 0 ? {
							metric_id: this.metrics[0].id
						} : null,
						secondary_metrics: this.metrics.length > 1 ? [
							{
								metric_id: this.metrics[1].id,
								type: "secondary",
								order_index: 0
							}
						] : [],
						custom_fields: this.customFields.reduce((acc, field) => {
							acc[field.name] = field.type === 'boolean' ? false : '';
							return acc;
						}, {} as any)
					};
					
					return {
						text: JSON.stringify(template, null, 2)
					};
				}
			);
			
			// Add available entities resource for reference
			this.server.resource(
				"absmartly://entities/available",
				"application/json",
				{
					name: "Available Entities",
					description: "All available entities for experiment creation"
				},
				async () => {
					const entities = {
						users: this.users,
						teams: this.teams,
						applications: this.applications,
						unit_types: this.unitTypes,
						experiment_tags: this.experimentTags,
						metrics: this.metrics,
						goals: this.goals,
						custom_fields: this.customFields
					};
					
					return {
						text: JSON.stringify(entities, null, 2)
					};
				}
			);
			
			console.log("✅ setupResources completed successfully");
		} catch (error) {
			console.error("❌ setupResources ERROR:", error);
			console.error("❌ setupResources error stack:", error?.stack);
			throw error;
		}
	}
	
	/**
	 * Setup prompts that guide users through common tasks
	 */
	setupPrompts() {
		try {
			console.log("💡 Setting up prompts");
			
			// Quick experiment status check
			this.server.prompt(
				"experiment-status",
				{
					name: "Check Experiment Status",
					description: "Quick overview of all running experiments"
				},
				async () => {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: "Show me all currently running experiments with their key metrics and performance"
								}
							}
						]
					};
				}
			);
			
			// Create new experiment prompt
			this.server.prompt(
				"create-experiment",
				{
					name: "Create New A/B Test",
					description: "Step-by-step guide to create a new experiment"
				},
				async () => {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: `I want to create a new A/B test experiment. Please guide me through:
1. Setting up the experiment name and description
2. Defining the control and treatment variants
3. Selecting the key metrics to track
4. Setting the audience targeting rules
5. Configuring any custom fields needed

Let's start with the experiment basics.`
								}
							}
						]
					};
				}
			);
			
			// Analyze experiment results
			this.server.prompt(
				"analyze-results",
				{
					name: "Analyze Experiment Results",
					description: "Deep dive into experiment performance and statistical significance"
				},
				async () => {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: `Help me analyze an experiment's results. I need:
1. Statistical significance analysis
2. Conversion rate comparisons between variants
3. Confidence intervals
4. Recommendations on whether to continue, stop, or roll out
5. Any concerning patterns or anomalies

Which experiment would you like to analyze?`
								}
							}
						]
					};
				}
			);
			
			// Debug authentication issues
			this.server.prompt(
				"debug-auth",
				{
					name: "Debug Authentication",
					description: "Troubleshoot API connection and authentication issues"
				},
				async () => {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: "Check my authentication status and help me troubleshoot any API connection issues. Show me the current auth configuration and test the API connection."
								}
							}
						]
					};
				}
			);
			
			console.log("✅ setupPrompts completed successfully");
		} catch (error) {
			console.error("❌ setupPrompts ERROR:", error);
			console.error("❌ setupPrompts error stack:", error?.stack);
			throw error;
		}
	}
}

const oauthProvider = new OAuthProvider({
	apiHandler: ABsmartlyMCP.mount("/sse") as any,
	apiRoute: "/sse",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: ABsmartlyOAuthHandler as any,
	tokenEndpoint: "/token",
	// Add client lookup to use our KV storage
	clientLookup: async (clientId: string, env: any) => {
		console.log(`🔍 OAuth provider clientLookup called for: ${clientId}`);
		if (!env.OAUTH_KV) {
			console.log(`🔍 No KV storage available`);
			return null;
		}
		
		const clientData = await env.OAUTH_KV.get(`client:${clientId}`);
		if (!clientData) {
			console.log(`🔍 Client not found in KV: ${clientId}`);
			return null;
		}
		
		const client = JSON.parse(clientData);
		console.log(`🔍 Client found in KV:`, client);
		return {
			clientId: client.clientId,
			clientSecret: client.clientSecret,
			redirectUris: client.redirectUris,
			clientName: client.clientName
		};
	},
});

// Custom wrapper to handle OAuth discovery endpoint
export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Check for active API key session FIRST - before anything else  
		// This prevents the OAuth provider from handling OPTIONS requests automatically
		if (env.OAUTH_KV && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/oauth-protected-resource")) {
			const userAgent = request.headers.get("User-Agent") || "unknown";
			const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
			console.log(`🔍 Early session check for ${request.method} ${url.pathname} - fingerprint: ${clientFingerprint}`);
			const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
			console.log(`🔍 Early session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
			
			if (apiKeySession) {
				console.log(`🔍 Early blocking OAuth discovery ${request.method} - client is using API key auth`);
				// Client is using API key auth, don't advertise OAuth
				return new Response(JSON.stringify({
					error: "oauth_not_available",
					error_description: "OAuth not available when using API key authentication"
				}), {
					status: 404,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}
		}
		
		// Dump request body for POST requests and extract client info
		if (request.method === 'POST' && request.body) {
			try {
				const clonedRequest = request.clone();
				const body = await clonedRequest.text();
				console.log(`🔍 Request body:`, body);
				
				// Try to extract client info from MCP requests to infer client name
				if (url.pathname === '/sse' && body.includes('clientInfo')) {
					try {
						const jsonBody = JSON.parse(body);
						const clientInfo = jsonBody?.params?.clientInfo;
						if (clientInfo?.name && env.OAUTH_KV) {
							// Extract client ID from auth header to associate with the name
							const authHeader = request.headers.get("Authorization");
							if (authHeader) {
								// Store the inferred client name for later use in OAuth dialog
								// We'll use a temporary key that expires after 1 hour
								const clientId = `claude-mcp-${Date.now()}`; // We don't have the real client ID yet
								await env.OAUTH_KV.put(`inferred_client:latest`, JSON.stringify({
									name: clientInfo.name,
									version: clientInfo.version || '1.0.0',
									timestamp: Date.now()
								}), { expirationTtl: 3600 }); // 1 hour TTL
								console.log(`🔍 Stored inferred client info:`, clientInfo.name);
							}
						}
					} catch (e) {
						console.log(`🔍 Could not parse request body as JSON:`, e);
					}
				}
			} catch (error) {
				console.log(`🔍 Could not read request body:`, error);
			}
		}
		
		
		// Handle CORS preflight requests
		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
					"Access-Control-Max-Age": "86400",
				},
			});
		}
		
		// Health check endpoint
		if (url.pathname === "/health") {
			return new Response(JSON.stringify({
				status: "ok",
				timestamp: new Date().toISOString(),
				url: request.url,
				method: request.method
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}
		
		// Handle OAuth protected resource endpoint
		if (url.pathname === "/.well-known/oauth-protected-resource") {
			// Handle OPTIONS for CORS first (but check session after)
			if (request.method === "OPTIONS") {
				// Check if this client has an active API key session
				if (env.OAUTH_KV) {
					const userAgent = request.headers.get("User-Agent") || "unknown";
					const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
					console.log(`🔍 Checking API key session for OPTIONS fingerprint: ${clientFingerprint}`);
					const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
					console.log(`🔍 API key session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
					
					if (apiKeySession) {
						console.log(`🔍 Blocking OAuth discovery OPTIONS - client is using API key auth`);
						// Client is using API key auth, don't advertise OAuth
						return new Response(JSON.stringify({
							error: "oauth_not_available",
							error_description: "OAuth not available when using API key authentication"
						}), {
							status: 404,
							headers: {
								"Content-Type": "application/json",
								"Access-Control-Allow-Origin": "*",
							},
						});
					}
				}
				
				return new Response(null, {
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
						"Access-Control-Max-Age": "86400",
					},
				});
			}
			
			// Check if this client has an active API key session for GET requests
			if (env.OAUTH_KV) {
				const userAgent = request.headers.get("User-Agent") || "unknown";
				const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
				console.log(`🔍 Checking API key session for GET fingerprint: ${clientFingerprint}`);
				const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
				console.log(`🔍 API key session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
				
				if (apiKeySession) {
					console.log(`🔍 Blocking OAuth discovery GET - client is using API key auth`);
					// Client is using API key auth, don't advertise OAuth
					return new Response(JSON.stringify({
						error: "oauth_not_available",
						error_description: "OAuth not available when using API key authentication"
					}), {
						status: 404,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}
			}
			
			const baseUrl = url.origin;
			const protectedResource = {
				resource: `${baseUrl}/sse`,
				authorization_servers: [baseUrl],
				scopes_supported: ["api:read", "api:write"],
				bearer_methods_supported: ["header"],
				resource_documentation: `${baseUrl}/docs`
			};
			return new Response(JSON.stringify(protectedResource), {
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": "public, max-age=3600"
				},
			});
		}
		
		// Handle OAuth discovery endpoint
		if (url.pathname === "/.well-known/oauth-authorization-server") {
			// Handle OPTIONS for CORS first (but check session after)
			if (request.method === "OPTIONS") {
				// Check if this client has an active API key session
				if (env.OAUTH_KV) {
					const userAgent = request.headers.get("User-Agent") || "unknown";
					const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
					console.log(`🔍 Checking API key session for OPTIONS fingerprint: ${clientFingerprint}`);
					const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
					console.log(`🔍 API key session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
					
					if (apiKeySession) {
						console.log(`🔍 Blocking OAuth discovery OPTIONS - client is using API key auth`);
						// Client is using API key auth, don't advertise OAuth
						return new Response(JSON.stringify({
							error: "oauth_not_available",
							error_description: "OAuth not available when using API key authentication"
						}), {
							status: 404,
							headers: {
								"Content-Type": "application/json",
								"Access-Control-Allow-Origin": "*",
							},
						});
					}
				}
				
				return new Response(null, {
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
						"Access-Control-Max-Age": "86400",
					},
				});
			}
			
			// Check if this client has an active API key session for GET requests
			if (env.OAUTH_KV) {
				const userAgent = request.headers.get("User-Agent") || "unknown";
				const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
				console.log(`🔍 Checking API key session for GET fingerprint: ${clientFingerprint}`);
				const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
				console.log(`🔍 API key session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
				
				if (apiKeySession) {
					console.log(`🔍 Blocking OAuth discovery GET - client is using API key auth`);
					// Client is using API key auth, don't advertise OAuth
					return new Response(JSON.stringify({
						error: "oauth_not_available",
						error_description: "OAuth not available when using API key authentication"
					}), {
						status: 404,
						headers: {
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}
			}
			
			const baseUrl = url.origin;
			const discovery = {
				issuer: baseUrl,
				authorization_endpoint: `${baseUrl}/authorize`,
				token_endpoint: `${baseUrl}/token`,
				registration_endpoint: `${baseUrl}/register`,
				response_types_supported: ["code"],
				grant_types_supported: ["authorization_code", "refresh_token"],
				code_challenge_methods_supported: ["S256", "plain"],
				scopes_supported: ["api:read", "api:write"],
				subject_types_supported: ["public"],
				id_token_signing_alg_values_supported: ["RS256"],
				token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
				// Dynamic Client Registration support
				registration_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
				// Additional OAuth 2.0 Dynamic Client Registration spec compliance
				client_id_issued_at_supported: true,
				client_secret_expires_at_supported: false,
				// Additional metadata that some clients might expect
				response_modes_supported: ["query", "fragment"],
				// Claude MCP specific requirements
				mcp_version: "2024-11-05"
			};
			return new Response(JSON.stringify(discovery), {
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": "public, max-age=3600"
				},
			});
		}
		
		// TEMPORARY: Clean up old client with wrong field names
		if (url.pathname === "/cleanup-client" && request.method === "POST") {
			if (env.OAUTH_KV) {
				await env.OAUTH_KV.delete("client:claude-mcp-1752076571269");
				console.log("🔍 Deleted old client with wrong field names");
			}
			return new Response(JSON.stringify({ status: "deleted" }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Handle Dynamic Client Registration endpoint
		if (url.pathname === "/register" && request.method === "POST") {
			try {
				const body = await request.json();
				console.log(`🔍 Client registration request:`, body);
				
				// Generate a client ID for Claude
				const clientId = `claude-mcp-${Date.now()}`;
				const clientSecret = `secret-${Math.random().toString(36).substring(2)}`;
				
				// Store the client registration in KV
				if (env.OAUTH_KV) {
					await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify({
						clientId: clientId,
						clientSecret: clientSecret,
						redirectUris: body.redirect_uris || [],
						clientName: body.client_name || "Claude MCP Client",
						registrationDate: Date.now()
					}));
				}
				
				const registrationResponse = {
					client_id: clientId,
					client_secret: clientSecret,
					client_id_issued_at: Math.floor(Date.now() / 1000),
					client_name: body.client_name || "Claude MCP Client",
					redirect_uris: body.redirect_uris || []
				};
				
				return new Response(JSON.stringify(registrationResponse), {
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*"
					}
				});
			} catch (error) {
				console.error("Client registration error:", error);
				return new Response(JSON.stringify({
					error: "invalid_client_metadata",
					error_description: "Invalid client registration request"
				}), {
					status: 400,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*"
					}
				});
			}
		}
		
		

		// Handle Claude's expected agent path format
		if (url.pathname.startsWith("/agents/absmartly-mcp/")) {
			// Redirect to the main SSE endpoint with OAuth
			const sseUrl = new URL("/sse", url.origin);
			sseUrl.search = url.search; // Preserve query parameters
			
			console.log(`🔀 Redirecting agent path to SSE: ${sseUrl.href}`);
			
			// For GET requests (SSE), redirect to SSE endpoint
			if (request.method === "GET") {
				return Response.redirect(sseUrl.href, 302);
			}
			
			// For POST requests, proxy to SSE endpoint
			const newRequest = new Request(sseUrl.href, {
				method: request.method,
				headers: request.headers,
				body: request.body
			});
			
			return oauthProvider.fetch(newRequest, env, ctx);
		}

		// Store ABsmartly endpoint in KV if provided (from header or query param)
		const absmartlyEndpoint = request.headers.get("x-absmartly-endpoint") || url.searchParams.get("absmartly-endpoint");
		if (absmartlyEndpoint && env.OAUTH_KV) {
			await env.OAUTH_KV.put("absmartly_endpoint_config", absmartlyEndpoint);
		}
		
		// Check for Authorization header first - if present, use API key auth
		const authHeader = request.headers.get("Authorization");
		
		// Track API key sessions to prevent OAuth discovery
		if (authHeader && env.OAUTH_KV) {
			// Mark that an API key session is active for this client
			const userAgent = request.headers.get("User-Agent") || "unknown";
			const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
			console.log(`🔍 Setting API key session for fingerprint: ${clientFingerprint}`);
			await env.OAUTH_KV.put(`api_key_session:${clientFingerprint}`, "active", { expirationTtl: 300 }); // 5 minutes TTL
		}
		
		// For /sse endpoint with Authorization header, use API key auth
		if (url.pathname === "/sse" && authHeader) {
			// Parse Authorization header: [Bearer] [Api-Key] [subdomain|APIendpoint] <token>
			const parts = authHeader.trim().split(/\s+/);
			let apiKey = "";
			// Check for endpoint in order of priority: query param, header, then parse from auth
			let absmartlyEndpoint = url.searchParams.get("absmartly-endpoint") || 
			                        request.headers.get("x-absmartly-endpoint") || 
			                        "";
			
			// Remove "Bearer" if present (it's optional)
			let startIndex = 0;
			if (parts[0] === "Bearer") {
				startIndex = 1;
			}
			
			// Remove "Api-Key" if present (it's optional but we'll always add it later)
			if (parts[startIndex] === "Api-Key") {
				startIndex++;
			}
			
			// Check if next part looks like subdomain or API endpoint
			if (parts[startIndex] && parts[startIndex + 1]) {
				const potentialEndpoint = parts[startIndex];
				
				// Check if it's a subdomain (no dots, no protocol)
				if (!potentialEndpoint.includes('.') && !potentialEndpoint.includes('://')) {
					// It's a subdomain
					if (!absmartlyEndpoint) {
						absmartlyEndpoint = `https://${potentialEndpoint}.absmartly.com`;
					}
					apiKey = parts[startIndex + 1];
				}
				// Check if it's an API endpoint (has dots or protocol)
				else if (potentialEndpoint.includes('.') || potentialEndpoint.includes('://')) {
					// It's an API endpoint
					if (!absmartlyEndpoint) {
						absmartlyEndpoint = potentialEndpoint.startsWith('http') ? potentialEndpoint : `https://${potentialEndpoint}`;
					}
					apiKey = parts[startIndex + 1];
				}
				else {
					// No endpoint specified, just the API key
					apiKey = potentialEndpoint;
				}
			} else if (parts[startIndex]) {
				// Only API key provided
				apiKey = parts[startIndex];
			}
			
			// Use default endpoint if none specified
			if (!absmartlyEndpoint) {
				absmartlyEndpoint = "https://sandbox.absmartly.com";
			}
			
			console.log(`🔍 Parsed auth - endpoint: ${absmartlyEndpoint}, apiKey: ${apiKey.substring(0, 10)}...`);
			
			// Create a request with the API key format that ABsmartly expects
			const authenticatedRequest = new Request(request.url, {
				method: request.method,
				headers: new Headers(request.headers),
				body: request.body
			});
			
			// Always use "Authorization: Api-Key <token>" format for ABsmartly API
			authenticatedRequest.headers.set("Authorization", `Api-Key ${apiKey}`);
			authenticatedRequest.headers.set("x-absmartly-endpoint", absmartlyEndpoint);
			
			// For API key auth, we bypass OAuth and use ABsmartlyMCP directly
			// Following the reference pattern from cloudflare/ai demo
			ctx.props = {
				email: 'api-key@example.com',
				name: 'API Key User',
				absmartly_endpoint: absmartlyEndpoint,
				absmartly_api_key: apiKey,
				user_id: 'api-key-user'
			};
			
			return ABsmartlyMCP.mount("/sse").fetch(authenticatedRequest, env, ctx);
		}
		
		// Check for API key sessions before allowing OAuth endpoints
		if (env.OAUTH_KV && (url.pathname === "/authorize" || url.pathname === "/token" || url.pathname === "/register" || url.pathname.startsWith("/oauth/"))) {
			const userAgent = request.headers.get("User-Agent") || "unknown";
			const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
			console.log(`🔍 Checking API key session before OAuth endpoint ${url.pathname} - fingerprint: ${clientFingerprint}`);
			const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
			console.log(`🔍 API key session result: ${apiKeySession ? "FOUND" : "NOT FOUND"}`);
			
			if (apiKeySession) {
				console.log(`🔍 Blocking OAuth endpoint ${url.pathname} - client is using API key auth`);
				// Client is using API key auth, block OAuth endpoints
				return new Response(JSON.stringify({
					error: "oauth_not_available",
					error_description: "OAuth endpoints not available when using API key authentication"
				}), {
					status: 404,
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}
		}
		
		// For everything else (no Authorization header, or non-/sse paths), use OAuth
		return await oauthProvider.fetch(request, env, ctx);
	}
};