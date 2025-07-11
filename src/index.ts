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
	private _customFields: any[] = [];
	private users: any[] = [];
	private teams: any[] = [];
	private applications: any[] = [];
	private unitTypes: any[] = [];
	private experimentTags: any[] = [];
	private metrics: any[] = [];
	private goals: any[] = [];
	
	// OAuth props from authentication
	props: any = null;
	
	// Request object for header access
	request: Request | null = null;
	
	// Debug log collection
	private debugLogs: string[] = [];
	
	// Getter for customFields to be accessible from resources
	get customFields() {
		return this._customFields;
	}
	
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
					this.debug("❌ Failed to decode absmartly_api_key JWT:", e instanceof Error ? e.message : String(e));
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
					this.debug("❌ Failed to decode oauth_jwt JWT:", e instanceof Error ? e.message : String(e));
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
						this.debug(`❌ Failed to decode JWT: ${jwtError instanceof Error ? jwtError.message : String(jwtError)}`);
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

			// Fetch all entities needed for experiment creation (non-blocking)
			this.debug("📦 Starting to fetch all entities in background");
			this.fetchAllEntities().catch(error => {
				this.debug("📦 Background entities fetch failed:", error);
			});
			this.debug("📦 All entities fetch started in background");

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
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error("❌ Init error message:", errorMessage);
			console.error("❌ Init error stack:", errorStack);
			this.debug("❌ Error in AbsmartlyMcpOAuth.init()", error);
			throw error;
		}
	}

	private async fetchAllEntities(): Promise<void> {
		console.log("📦 fetchAllEntities START");
		try {
			this.debug("📦 fetchAllEntities - checking API client");
			if (!this.apiClient) {
				console.log("📦 No API client - setting empty arrays for all entities");
				this.debug("📦 No API client available, skipping entities fetch");
				this._customFields = [];
				this.users = [];
				this.teams = [];
				this.applications = [];
				this.unitTypes = [];
				this.experimentTags = [];
				this.metrics = [];
				this.goals = [];
				return;
			}

			console.log("📦 Fetching all entities from API in parallel");
			this.debug("📦 API client endpoint:", this.apiClient.apiEndpoint);
			
			// Fetch all entities in parallel
			const [
				customFieldsResponse,
				usersResponse,
				teamsResponse,
				applicationsResponse,
				unitTypesResponse,
				experimentTagsResponse,
				metricsResponse,
				goalsResponse
			] = await Promise.allSettled([
				this.apiClient.listExperimentCustomSectionFields({ items: 100 }),
				this.apiClient.listUsers(),
				this.apiClient.listTeams(),
				this.apiClient.listApplications({ items: 100 }),
				this.apiClient.listUnitTypes({ items: 100 }),
				this.apiClient.listExperimentTags({ items: 100 }),
				this.apiClient.listMetrics({ items: 100 }),
				this.apiClient.listGoals()
			]);

			// Process custom fields
			if (customFieldsResponse.status === 'fulfilled' && customFieldsResponse.value.ok) {
				this._customFields = customFieldsResponse.value.data?.experiment_custom_section_fields || [];
				this.debug("✅ Fetched custom fields:", this._customFields.length);
			} else {
				this.debug("❌ Failed to fetch custom fields:", customFieldsResponse.status === 'rejected' ? customFieldsResponse.reason : customFieldsResponse.value.errors);
				this._customFields = [];
			}

			// Process users
			if (usersResponse.status === 'fulfilled' && usersResponse.value.ok) {
				const rawUsers = usersResponse.value.data?.users || usersResponse.value.data || [];
				this.users = rawUsers.map((user: any) => ({
					id: user.id,
					name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
					description: user.email || ''
				}));
				this.debug("✅ Fetched users:", this.users.length);
			} else {
				this.debug("❌ Failed to fetch users:", usersResponse.status === 'rejected' ? usersResponse.reason : usersResponse.value.errors);
				this.users = [];
			}

			// Process teams
			if (teamsResponse.status === 'fulfilled' && teamsResponse.value.ok) {
				const rawTeams = teamsResponse.value.data?.teams || teamsResponse.value.data || [];
				this.teams = rawTeams.map((team: any) => ({
					id: team.id,
					name: team.name,
					description: team.description || `${team.member_count || 0} members`
				}));
				this.debug("✅ Fetched teams:", this.teams.length);
			} else {
				this.debug("❌ Failed to fetch teams:", teamsResponse.status === 'rejected' ? teamsResponse.reason : teamsResponse.value.errors);
				this.teams = [];
			}

			// Process applications
			if (applicationsResponse.status === 'fulfilled' && applicationsResponse.value.ok) {
				const rawApplications = applicationsResponse.value.data?.applications || applicationsResponse.value.data || [];
				this.applications = rawApplications.map((app: any) => ({
					id: app.id,
					name: app.name,
					description: `Environment: ${app.environment || 'default'}`
				}));
				this.debug("✅ Fetched applications:", this.applications.length);
			} else {
				this.debug("❌ Failed to fetch applications:", applicationsResponse.status === 'rejected' ? applicationsResponse.reason : applicationsResponse.value.errors);
				this.applications = [];
			}

			// Process unit types
			if (unitTypesResponse.status === 'fulfilled' && unitTypesResponse.value.ok) {
				const rawUnitTypes = unitTypesResponse.value.data?.unit_types || unitTypesResponse.value.data || [];
				this.unitTypes = rawUnitTypes.map((unitType: any) => ({
					id: unitType.id,
					name: unitType.name,
					description: unitType.description || `Unit type: ${unitType.name}`
				}));
				this.debug("✅ Fetched unit types:", this.unitTypes.length);
			} else {
				this.debug("❌ Failed to fetch unit types:", unitTypesResponse.status === 'rejected' ? unitTypesResponse.reason : unitTypesResponse.value.errors);
				this.unitTypes = [];
			}

			// Process experiment tags
			if (experimentTagsResponse.status === 'fulfilled' && experimentTagsResponse.value.ok) {
				const rawExperimentTags = experimentTagsResponse.value.data?.experiment_tags || experimentTagsResponse.value.data || [];
				this.experimentTags = rawExperimentTags.map((tag: any) => ({
					id: tag.id,
					name: tag.name,
					description: tag.description || `Tag: ${tag.name}`
				}));
				this.debug("✅ Fetched experiment tags:", this.experimentTags.length);
			} else {
				this.debug("❌ Failed to fetch experiment tags:", experimentTagsResponse.status === 'rejected' ? experimentTagsResponse.reason : experimentTagsResponse.value.errors);
				this.experimentTags = [];
			}

			// Process metrics
			if (metricsResponse.status === 'fulfilled' && metricsResponse.value.ok) {
				const rawMetrics = metricsResponse.value.data?.metrics || metricsResponse.value.data || [];
				this.metrics = rawMetrics.map((metric: any) => ({
					id: metric.id,
					name: metric.name,
					description: metric.description || `Metric: ${metric.name}`
				}));
				this.debug("✅ Fetched metrics:", this.metrics.length);
			} else {
				this.debug("❌ Failed to fetch metrics:", metricsResponse.status === 'rejected' ? metricsResponse.reason : metricsResponse.value.errors);
				this.metrics = [];
			}

			// Process goals
			if (goalsResponse.status === 'fulfilled' && goalsResponse.value.ok) {
				const rawGoals = goalsResponse.value.data?.goals || goalsResponse.value.data || [];
				this.goals = rawGoals.map((goal: any) => ({
					id: goal.id,
					name: goal.name,
					description: goal.description || `Goal: ${goal.name}`
				}));
				this.debug("✅ Fetched goals:", this.goals.length);
			} else {
				this.debug("❌ Failed to fetch goals:", goalsResponse.status === 'rejected' ? goalsResponse.reason : goalsResponse.value.errors);
				this.goals = [];
			}

			this.debug("✅ All entities fetched successfully:", {
				customFields: this._customFields.length,
				users: this.users.length,
				teams: this.teams.length,
				applications: this.applications.length,
				unitTypes: this.unitTypes.length,
				experimentTags: this.experimentTags.length,
				metrics: this.metrics.length,
				goals: this.goals.length
			});
			console.log("✅ fetchAllEntities completed successfully");
		} catch (error) {
			console.error("❌ fetchAllEntities ERROR:", error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error("❌ fetchAllEntities error message:", errorMessage);
			console.error("❌ fetchAllEntities error stack:", errorStack);
			this.debug("❌ Error fetching entities:", error);
			// Set all arrays to empty on error
			this._customFields = [];
			this.users = [];
			this.teams = [];
			this.applications = [];
			this.unitTypes = [];
			this.experimentTags = [];
			this.metrics = [];
			this.goals = [];
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

			// Create experiment tool
			console.log("🔧 Setting up create experiment tool");
			this.server.tool(
				"create_experiment",
				{
					name: z.string().describe("Experiment name"),
					description: z.string().describe("Experiment description"),
					hypothesis: z.string().optional().describe("Experiment hypothesis"),
					application_id: z.number().describe("Application ID where the experiment will run"),
					owner_ids: z.array(z.number()).optional().describe("User IDs of the experiment owners"),
					team_ids: z.array(z.number()).optional().describe("Team IDs that own the experiment"),
					unit_type_id: z.number().optional().describe("Unit type ID for the experiment"),
					experiment_tag_ids: z.array(z.number()).optional().describe("Experiment tag IDs"),
					primary_metric_id: z.number().optional().describe("Primary metric ID"),
					secondary_metric_ids: z.array(z.number()).optional().describe("Secondary metric IDs"),
					traffic_split: z.number().optional().describe("Traffic percentage for the experiment (0-100, default: 50)"),
					variants: z.array(z.object({
						name: z.string().describe("Variant name"),
						description: z.string().optional().describe("Variant description"),
						config: z.any().optional().describe("Variant configuration (JSON object)")
					})).optional().describe("Experiment variants (defaults to Control and Treatment)")
				},
				async (params) => {
					this.debug("🔧 create_experiment tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						// Prepare experiment data in the correct format
						const experimentData: any = {
							state: "ready",
							name: params.name,
							display_name: params.name,
							description: params.description,
							hypothesis: params.hypothesis || "",
							iteration: 1,
							percentage_of_traffic: 100,
							nr_variants: 2,
							percentages: "50/50",
							audience: '{"filter":[{"and":[]}]}',
							audience_strict: true,
							applications: [
								{
									application_id: params.application_id,
									application_version: "0"
								}
							],
							custom_fields: {}
						};

						// Set owners in the correct format
						if (params.owner_ids && params.owner_ids.length > 0) {
							experimentData.owners = params.owner_ids.map(id => ({ user_id: id }));
						}

						// Set teams in the correct format
						if (params.team_ids && params.team_ids.length > 0) {
							experimentData.teams = params.team_ids.map(id => ({ team_id: id }));
						} else {
							experimentData.teams = [];
						}

						// Set unit type in the correct format
						if (params.unit_type_id) {
							experimentData.unit_type = { unit_type_id: params.unit_type_id };
						} else {
							// Default to the first unit type if available
							if (this.unitTypes.length > 0) {
								experimentData.unit_type = { unit_type_id: this.unitTypes[0].id };
							}
						}

						// Set experiment tags in the correct format
						if (params.experiment_tag_ids && params.experiment_tag_ids.length > 0) {
							experimentData.experiment_tags = params.experiment_tag_ids.map(id => ({ experiment_tag_id: id }));
						} else {
							experimentData.experiment_tags = [];
						}

						// Set primary metric in the correct format
						if (params.primary_metric_id) {
							experimentData.primary_metric = { metric_id: params.primary_metric_id };
						}

						// Set secondary metrics in the correct format
						if (params.secondary_metric_ids && params.secondary_metric_ids.length > 0) {
							experimentData.secondary_metrics = params.secondary_metric_ids.map((id, index) => ({
								metric_id: id,
								type: "secondary",
								order_index: index
							}));
						} else {
							experimentData.secondary_metrics = [];
						}

						// Set up variants - note: this might need adjustment based on API requirements
						if (params.variants && params.variants.length > 0) {
							experimentData.nr_variants = params.variants.length;
							// For now, keep the simple format but may need to adjust based on API
							experimentData.variants = params.variants.map((v, index) => ({
								id: index,
								name: v.name,
								description: v.description || "",
								config: v.config || {}
							}));
						}

						this.debug("📡 Creating experiment with data", experimentData);
						const response = await this.apiClient.createExperiment(experimentData);

						if (!response.ok) {
							this.debug("❌ Create experiment failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to create experiment: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const experiment = response.data;
						return {
							content: [
								{
									type: "text",
									text: `✅ Experiment created successfully!\n\n**${experiment.name}**\n- ID: ${experiment.id}\n- State: ${experiment.state}\n- Application: ${experiment.application_id}\n- Unit Type: ${experiment.unit_type}\n- Traffic Split: ${params.traffic_split || 50}% to treatment\n\nNext steps:\n1. Use 'start_experiment' tool to launch the experiment\n2. Use 'get_experiment' tool to view details\n3. Use 'update_experiment' tool to modify settings`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in createExperiment", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error creating experiment: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// Get experiment tool
			console.log("🔧 Setting up get experiment tool");
			this.server.tool(
				"get_experiment",
				{
					id: z.number().describe("Experiment ID")
				},
				async (params) => {
					this.debug("🔧 get_experiment tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						const response = await this.apiClient.getExperiment(params.id);

						if (!response.ok) {
							this.debug("❌ Get experiment failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to get experiment: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const exp = response.data;
						const variants = exp.variants?.map((v: any) => 
							`  - ${v.name} (ID: ${v.id}): ${v.description || 'No description'}`
						).join('\n') || 'No variants';

						return {
							content: [
								{
									type: "text",
									text: `**${exp.display_name || exp.name}**\n\n` +
										`- ID: ${exp.id}\n` +
										`- State: ${exp.state}\n` +
										`- Type: ${exp.type}\n` +
										`- Application ID: ${exp.application_id}\n` +
										`- Unit Type: ${exp.unit_type}\n` +
										`- Created: ${new Date(exp.created_at).toLocaleDateString()}\n` +
										`- Traffic Split: ${JSON.stringify(exp.traffic_split)}\n` +
										`\n**Description:**\n${exp.description}\n` +
										`\n**Hypothesis:**\n${exp.hypothesis || 'None'}\n` +
										`\n**Variants:**\n${variants}`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in getExperiment", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error getting experiment: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// List applications tool
			console.log("🔧 Setting up list applications tool");
			this.server.tool(
				"list_applications",
				{
					search: z.string().optional().describe("Search applications by name"),
					page: z.number().optional().describe("Page number (1-based)"),
					items: z.number().optional().describe("Number of items per page (default: 10)")
				},
				async (params) => {
					this.debug("🔧 list_applications tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						const response = await this.apiClient.listApplications({
							search: params.search,
							page: params.page,
							items: params.items || 10
						});

						if (!response.ok) {
							this.debug("❌ List applications failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to list applications: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const applications = response.data?.applications || response.data || [];
						const appList = applications.map((app: any) => 
							`• **${app.name}** (ID: ${app.id})\n  Environment: ${app.environment || 'default'}`
						).join('\n\n');

						return {
							content: [
								{
									type: "text",
									text: `Found ${applications.length} applications:\n\n${appList || 'No applications found'}\n\nUse the Application ID when creating experiments.`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in listApplications", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error listing applications: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// List users tool
			console.log("🔧 Setting up list users tool");
			this.server.tool(
				"list_users",
				{
					search: z.string().optional().describe("Search users by name or email"),
					page: z.number().optional().describe("Page number (1-based)"),
					items: z.number().optional().describe("Number of items per page (default: 10)")
				},
				async (params) => {
					this.debug("🔧 list_users tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						const response = await this.apiClient.listUsers();

						if (!response.ok) {
							this.debug("❌ List users failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to list users: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const users = response.data?.users || response.data || [];
						const userList = users.map((user: any) => 
							`• **${user.first_name} ${user.last_name}** (ID: ${user.id})\n  Email: ${user.email}\n  Role: ${user.role || 'user'}`
						).join('\n\n');

						return {
							content: [
								{
									type: "text",
									text: `Found ${users.length} users:\n\n${userList || 'No users found'}\n\nUse the User ID when assigning experiment ownership.`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in listUsers", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error listing users: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// List teams tool
			console.log("🔧 Setting up list teams tool");
			this.server.tool(
				"list_teams",
				{
					search: z.string().optional().describe("Search teams by name"),
					page: z.number().optional().describe("Page number (1-based)"),
					items: z.number().optional().describe("Number of items per page (default: 10)")
				},
				async (params) => {
					this.debug("🔧 list_teams tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						const response = await this.apiClient.listTeams();

						if (!response.ok) {
							this.debug("❌ List teams failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to list teams: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const teams = response.data?.teams || response.data || [];
						const teamList = teams.map((team: any) => 
							`• **${team.name}** (ID: ${team.id})\n  Description: ${team.description || 'No description'}\n  Members: ${team.member_count || 0}`
						).join('\n\n');

						return {
							content: [
								{
									type: "text",
									text: `Found ${teams.length} teams:\n\n${teamList || 'No teams found'}\n\nUse the Team ID when assigning experiment team ownership.`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in listTeams", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error listing teams: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// Create feature flag tool (simplified experiment)
			console.log("🔧 Setting up create feature flag tool");
			this.server.tool(
				"create_feature_flag",
				{
					name: z.string().describe("Feature flag name"),
					description: z.string().describe("Feature flag description"),
					application_id: z.number().describe("Application ID where the feature flag will be used"),
					owner_id: z.number().optional().describe("User ID of the feature flag owner"),
					team_id: z.number().optional().describe("Team ID that owns the feature flag"),
					enabled_percentage: z.number().optional().describe("Percentage of users who will see the feature (0-100, default: 0)"),
					targeting_rules: z.any().optional().describe("Optional targeting rules (JSON object)")
				},
				async (params) => {
					this.debug("🔧 create_feature_flag tool called", params);
					
					if (!this.apiClient) {
						return {
							content: [
								{
									type: "text",
									text: "❌ API client not initialized. Please check authentication status.",
								},
							],
						};
					}

					try {
						// Feature flags are experiments with type: "feature"
						const experimentData: any = {
							name: params.name,
							description: params.description,
							hypothesis: `Feature flag: ${params.name}`,
							type: "feature",
							state: "draft",
							application_id: params.application_id,
							owner_id: params.owner_id,
							team_id: params.team_id,
							unit_type: "user_id", // Feature flags typically use user_id
							traffic_split: [{
								variant_id: 0,
								percentage: 100 - (params.enabled_percentage || 0)
							}, {
								variant_id: 1,
								percentage: params.enabled_percentage || 0
							}],
							variants: [
								{ id: 0, name: "Off", description: "Feature disabled", config: { enabled: false } },
								{ id: 1, name: "On", description: "Feature enabled", config: { enabled: true } }
							]
						};

						// Add targeting rules if provided
						if (params.targeting_rules) {
							experimentData.audience_rules = params.targeting_rules;
						}

						this.debug("📡 Creating feature flag as experiment", experimentData);
						const response = await this.apiClient.createExperiment(experimentData);

						if (!response.ok) {
							this.debug("❌ Create feature flag failed", response);
							return {
								content: [
									{
										type: "text",
										text: `❌ Failed to create feature flag: ${response.errors?.join(', ') || 'Unknown error'}\n\nDebug: Use get_debug_logs tool for more details`,
									},
								],
							};
						}

						const featureFlag = response.data;
						return {
							content: [
								{
									type: "text",
									text: `✅ Feature flag created successfully!\n\n**${featureFlag.name}**\n- ID: ${featureFlag.id}\n- State: ${featureFlag.state}\n- Application: ${featureFlag.application_id}\n- Enabled for: ${params.enabled_percentage || 0}% of users\n\nNext steps:\n1. Use 'start_experiment' tool with ID ${featureFlag.id} to activate the feature flag\n2. Use 'update_experiment' tool to change the rollout percentage\n3. Use 'get_experiment' tool to monitor the feature flag`,
								},
							],
						};
					} catch (error) {
						this.debug("❌ Exception in createFeatureFlag", error);
						return {
							content: [
								{
									type: "text",
									text: `❌ Error creating feature flag: ${error}\n\nDebug: Use get_debug_logs tool for more details`,
								},
							],
						};
					}
				}
			);

			// List available entity options for experiment creation
			console.log("🔧 Setting up entity listing tools");
			
			// List available users for experiment ownership
			this.server.tool(
				"list_available_users",
				{},
				async () => {
					this.debug("🔧 list_available_users tool called");
					
					if (this.users.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No users available. Data may still be loading from the API.",
								},
							],
						};
					}

					const usersList = this.users.map((user: any) => 
						`• **${user.name}** (ID: ${user.id})\n  ${user.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available users for experiment ownership:\n\n${usersList}\n\nUse the User ID when creating experiments with the 'owner_id' parameter.`,
							},
						],
					};
				}
			);

			// List available teams for experiment ownership
			this.server.tool(
				"list_available_teams",
				{},
				async () => {
					this.debug("🔧 list_available_teams tool called");
					
					if (this.teams.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No teams available. Data may still be loading from the API.",
								},
							],
						};
					}

					const teamsList = this.teams.map((team: any) => 
						`• **${team.name}** (ID: ${team.id})\n  ${team.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available teams for experiment ownership:\n\n${teamsList}\n\nUse the Team ID when creating experiments with the 'team_id' parameter.`,
							},
						],
					};
				}
			);

			// List available applications
			this.server.tool(
				"list_available_applications",
				{},
				async () => {
					this.debug("🔧 list_available_applications tool called");
					
					if (this.applications.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No applications available. Data may still be loading from the API.",
								},
							],
						};
					}

					const appsList = this.applications.map((app: any) => 
						`• **${app.name}** (ID: ${app.id})\n  ${app.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available applications:\n\n${appsList}\n\nUse the Application ID when creating experiments with the 'application_id' parameter.`,
							},
						],
					};
				}
			);

			// List available unit types
			this.server.tool(
				"list_available_unit_types",
				{},
				async () => {
					this.debug("🔧 list_available_unit_types tool called");
					
					if (this.unitTypes.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No unit types available. Data may still be loading from the API.",
								},
							],
						};
					}

					const unitTypesList = this.unitTypes.map((unitType: any) => 
						`• **${unitType.name}** (ID: ${unitType.id})\n  ${unitType.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available unit types:\n\n${unitTypesList}\n\nUse the Unit Type ID when creating experiments with the 'unit_type' parameter.`,
							},
						],
					};
				}
			);

			// List available experiment tags
			this.server.tool(
				"list_available_experiment_tags",
				{},
				async () => {
					this.debug("🔧 list_available_experiment_tags tool called");
					
					if (this.experimentTags.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No experiment tags available. Data may still be loading from the API.",
								},
							],
						};
					}

					const tagsList = this.experimentTags.map((tag: any) => 
						`• **${tag.name}** (ID: ${tag.id})\n  ${tag.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available experiment tags:\n\n${tagsList}\n\nUse the Tag ID when creating experiments with experiment tags.`,
							},
						],
					};
				}
			);

			// List available metrics
			this.server.tool(
				"list_available_metrics",
				{},
				async () => {
					this.debug("🔧 list_available_metrics tool called");
					
					if (this.metrics.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No metrics available. Data may still be loading from the API.",
								},
							],
						};
					}

					const metricsList = this.metrics.map((metric: any) => 
						`• **${metric.name}** (ID: ${metric.id})\n  ${metric.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available metrics:\n\n${metricsList}\n\nUse the Metric ID when creating experiments with primary or secondary metrics.`,
							},
						],
					};
				}
			);

			// List available goals
			this.server.tool(
				"list_available_goals",
				{},
				async () => {
					this.debug("🔧 list_available_goals tool called");
					
					if (this.goals.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No goals available. Data may still be loading from the API.",
								},
							],
						};
					}

					const goalsList = this.goals.map((goal: any) => 
						`• **${goal.name}** (ID: ${goal.id})\n  ${goal.description}`
					).join('\n\n');

					return {
						content: [
							{
								type: "text",
								text: `Available goals:\n\n${goalsList}\n\nGoals are used as reference when creating metrics and can help define what you want to measure in your experiments.`,
							},
						],
					};
				}
			);

			console.log("✅ setupTools completed successfully");
		} catch (error) {
			console.error("❌ setupTools ERROR:", error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error("❌ setupTools error stack:", errorStack);
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
						custom_fields: this._customFields.reduce((acc, field) => {
							acc[field.name] = field.type === 'boolean' ? false : '';
							return acc;
						}, {} as any)
					};
					
					return {
						contents: [{
							uri: "absmartly://templates/experiment",
							mimeType: "application/json",
							text: JSON.stringify(template, null, 2)
						}]
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
						custom_fields: this._customFields
					};
					
					return {
						contents: [{
							uri: "absmartly://entities/available",
							mimeType: "application/json",
							text: JSON.stringify(entities, null, 2)
						}]
					};
				}
			);
			
			console.log("✅ setupResources completed successfully");
		} catch (error) {
			console.error("❌ setupResources ERROR:", error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error("❌ setupResources error stack:", errorStack);
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
				"Quick overview of all running experiments",
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
				"Step-by-step guide to create a new A/B test experiment",
				async () => {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: `I want to create a new A/B test experiment. Please guide me through:
1. Setting up the experiment name and description
2. Choosing the application where it will run
3. Selecting experiment owners and teams
4. Picking the unit type (how users are tracked)
5. Defining the control and treatment variants
6. Selecting the key metrics to track (primary and secondary)
7. Adding experiment tags for organization
8. Setting the audience targeting rules
9. Configuring any custom fields needed

Let's start with the experiment basics. First, please show me the available entities I can choose from using the list_available_* tools.`
								}
							}
						]
					};
				}
			);
			
			// Analyze experiment results
			this.server.prompt(
				"analyze-results",
				"Deep dive into experiment performance and statistical significance",
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
				"Troubleshoot API connection and authentication issues",
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
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error("❌ setupPrompts error stack:", errorStack);
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
	// Allow public client registration (PKCE-only clients)
	disallowPublicClientRegistration: false,
	// Custom client lookup to handle public clients (PKCE without client_secret)
	// NOTE: clientLookup may be handled differently in this version
	/* async clientLookup(clientId: string, env: any) {
		// First check if it's a dynamically registered client
		if (env.OAUTH_KV && clientId.startsWith("claude-mcp-")) {
			const clientData = await env.OAUTH_KV.get(`client:${clientId}`);
			if (clientData) {
				const client = JSON.parse(clientData);
				// Claude Desktop is always a public client using PKCE
				return {
					clientId: client.clientId,
					clientSecret: undefined, // Public client - no secret required
					redirectUris: client.redirectUris,
					clientName: client.clientName,
					tokenEndpointAuthMethod: 'none' // Public client authentication method
				};
			}
		}
		
		// Fall back to default universal client (public client)
		return {
			clientId: "mcp-absmartly-universal",
			clientSecret: undefined, // Public client - no secret validation
			tokenEndpointAuthMethod: 'none', // Explicitly mark as public client
			redirectUris: [
				"https://mcp.absmartly.com/oauth/callback",
				"https://mcp-oauth.absmartly.com/callback",
				"http://localhost:8787/oauth/callback",
				"https://localhost:8080/oauth/callback",
				"https://playground.ai.cloudflare.com/oauth/callback"
			],
			clientName: "ABsmartly MCP Universal Client"
		};
	} */
});

// Custom wrapper to handle OAuth discovery endpoint
export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Add debugging for token requests to see if they're completing successfully
		if (url.pathname === "/token" && request.method === "POST") {
			try {
				const clonedRequest = request.clone();
				const body = await clonedRequest.text();
				console.log(`🔍 Token request received: ${body}`);
				
				// Let OAuth provider handle it, but log the response
				const response = await oauthProvider.fetch(request, env, ctx);
				
				if (response.status !== 200) {
					const responseClone = response.clone();
					const responseText = await responseClone.text();
					console.log(`❌ Token endpoint error (${response.status}): ${responseText}`);
				} else {
					const responseClone = response.clone();
					const responseText = await responseClone.text();
					console.log(`✅ Token endpoint success (${response.status}): ${responseText}`);
				}
				
				return response;
			} catch (e) {
				console.log(`🔍 Error in token endpoint:`, e);
				throw e;
			}
		}
		
		// Let OAuth provider handle client registration
		// Remove our interception so the library can manage clients
		
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
		
		// Dump request body for POST requests and extract client info (only if we have auth)
		if (request.method === 'POST' && request.body) {
			// Only process body if we have authorization or it's not an SSE request
			const authHeader = request.headers.get("Authorization");
			if (authHeader || !url.pathname.startsWith('/sse')) {
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
						} catch (e) {
							console.log(`🔍 Could not parse request body as JSON:`, e);
						}
					}
				} catch (error) {
					console.log(`🔍 Could not read request body:`, error);
				}
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
		
		// TEMPORARY: Clean up old clients with client_secret stored
		if (url.pathname === "/cleanup-client" && request.method === "POST") {
			if (env.OAUTH_KV) {
				await env.OAUTH_KV.delete("client:claude-mcp-1752076571269");
				await env.OAUTH_KV.delete("client:claude-mcp-1752140547629"); // Current problematic client
				console.log("🔍 Deleted old clients with stored client_secret");
			}
			return new Response(JSON.stringify({ status: "deleted" }), {
				headers: { 
					"Content-Type": "application/json",
					// Clear the approved clients cookie to force re-registration
					"Set-Cookie": "mcp-approved-clients=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0"
				}
			});
		}

		// Handle Dynamic Client Registration endpoint
		if (url.pathname === "/register" && request.method === "POST") {
			try {
				const body = await request.json() as any;
				console.log(`🔍 Client registration request:`, body);
				
				// Check if this is a public client request
				const isPublicClient = body.token_endpoint_auth_method === "none";
				
				// Generate a client ID for Claude
				const clientId = `claude-mcp-${Date.now()}`;
				
				// For public clients, don't generate/store a client_secret at all
				const clientSecret = isPublicClient ? undefined : `secret-${Math.random().toString(36).substring(2)}`;
				
				// Store the client registration in KV
				if (env.OAUTH_KV) {
					const clientData: any = {
						clientId: clientId,
						redirectUris: body.redirect_uris || [],
						clientName: body.client_name || "Claude MCP Client",
						registrationDate: Date.now(),
						tokenEndpointAuthMethod: isPublicClient ? 'none' : 'client_secret_basic'
					};
					
					// Only add clientSecret for confidential clients
					if (!isPublicClient && clientSecret) {
						clientData.clientSecret = clientSecret;
					}
					
					await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(clientData));
				}
				
				// Build registration response - only include client_secret for confidential clients
				const registrationResponse: any = {
					client_id: clientId,
					client_id_issued_at: Math.floor(Date.now() / 1000),
					client_name: body.client_name || "Claude MCP Client",
					redirect_uris: body.redirect_uris || [],
					token_endpoint_auth_method: isPublicClient ? "none" : "client_secret_basic"
				};
				
				// Only include client_secret for confidential clients
				if (!isPublicClient && clientSecret) {
					registrationResponse.client_secret = clientSecret;
				}
				
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
		
		// Check for API key in query parameter
		const apiKeyFromQuery = url.searchParams.get("api_key");
		if (apiKeyFromQuery) {
			console.log(`🔍 API key found in query parameter: ${apiKeyFromQuery.substring(0, 10)}...`);
		}
		
		// Check for Authorization header first - if present, use API key auth
		const authHeader = request.headers.get("Authorization");
		
		// Track API key sessions to prevent OAuth discovery
		if ((authHeader || apiKeyFromQuery) && env.OAUTH_KV) {
			// Mark that an API key session is active for this client
			const userAgent = request.headers.get("User-Agent") || "unknown";
			const clientFingerprint = `${request.headers.get("CF-Connecting-IP") || "unknown"}-${userAgent}`;
			
			// Check if session already exists to avoid unnecessary writes and rate limiting
			const existingSession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
			if (!existingSession) {
				console.log(`🔍 Setting API key session for fingerprint: ${clientFingerprint}`);
				await env.OAUTH_KV.put(`api_key_session:${clientFingerprint}`, "active", { expirationTtl: 300 }); // 5 minutes TTL
			}
		}
		
		// For /sse endpoint, check authentication precedence:
		// 1. OAuth JWT (if available from OAuth flow)
		// 2. API key from query parameter (if provided)
		// 3. API key from headers (if provided)
		// 4. No authentication
		if (url.pathname === "/sse") {
			// First check if we have an OAuth Bearer token (not an API key)
			if (authHeader && authHeader.startsWith("Bearer ") && !authHeader.includes("Api-Key")) {
				// This is an OAuth Bearer token, let the OAuth provider handle it
				console.log("🔍 OAuth Bearer token detected, passing to OAuth provider");
				return oauthProvider.fetch(request, env, ctx);
			}
			
			// Check for API key in query parameter (takes precedence over header API key)
			const apiKeyFromQuery = url.searchParams.get("api_key");
			if (apiKeyFromQuery) {
				console.log(`🔍 Using API key from query parameter: ${apiKeyFromQuery.substring(0, 10)}...`);
				
				// Get endpoint from query param or header
				const absmartlyEndpoint = url.searchParams.get("absmartly-endpoint") || 
				                        request.headers.get("x-absmartly-endpoint") || 
				                        "https://sandbox.absmartly.com";
				
				// Create a request with the API key format that ABsmartly expects
				const authenticatedRequest = new Request(request.url, {
					method: request.method,
					headers: new Headers(request.headers),
					body: request.body
				});
				
				// Always use "Authorization: Api-Key <token>" format for ABsmartly API
				authenticatedRequest.headers.set("Authorization", `Api-Key ${apiKeyFromQuery}`);
				authenticatedRequest.headers.set("x-absmartly-endpoint", absmartlyEndpoint);
				
				// For API key auth, we bypass OAuth and use ABsmartlyMCP directly
				ctx.props = {
					email: 'api-key@example.com',
					name: 'API Key User',
					absmartly_endpoint: absmartlyEndpoint,
					absmartly_api_key: apiKeyFromQuery,
					user_id: 'api-key-user'
				};
				
				return ABsmartlyMCP.mount("/sse").fetch(authenticatedRequest, env, ctx);
			}
			
			// Check for API key in Authorization header
			if (authHeader) {
				// Parse as API key: [Bearer] [Api-Key] [subdomain|APIendpoint] <token>
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
				
				console.log(`🔍 Parsed auth from header - endpoint: ${absmartlyEndpoint}, apiKey: ${apiKey.substring(0, 10)}...`);
				
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
				ctx.props = {
					email: 'api-key@example.com',
					name: 'API Key User',
					absmartly_endpoint: absmartlyEndpoint,
					absmartly_api_key: apiKey,
					user_id: 'api-key-user'
				};
				
				return ABsmartlyMCP.mount("/sse").fetch(authenticatedRequest, env, ctx);
			}
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
		
		// Add debugging for OAuth requests to /sse
		if (url.pathname === "/sse") {
			const authHeader = request.headers.get("Authorization");
			console.log(`🔍 SSE request - Method: ${request.method}, Auth header: ${authHeader ? authHeader.substring(0, 20) + '...' : 'NONE'}`);
		}
		
		// For everything else (no Authorization header, or non-/sse paths), use OAuth
		console.log("🔄 FALLTHROUGH TO OAUTH PROVIDER - this should NOT happen for /sse without auth");
		return await oauthProvider.fetch(request, env, ctx);
	}
};