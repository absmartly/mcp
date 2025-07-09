# ABsmartly MCP Server

A Model Context Protocol (MCP) server that provides seamless access to the ABsmartly experimentation platform. This server enables AI assistants and other MCP clients to interact with ABsmartly's experiment management, feature flags, and analytics APIs.

The server supports both OAuth2 authentication for enterprise users and direct API key authentication with flexible authorization header formats. It intelligently routes requests through the appropriate authentication flow and provides session-based OAuth discovery blocking to prevent conflicts.

## Features

- **Complete ABsmartly API Coverage**: Access all ABsmartly functionality through MCP tools
- **Dynamic Custom Fields**: Automatically discovers and exposes custom fields as tool parameters
- **Dual Authentication**: OAuth2 flow for enterprise users + Direct API key authentication
- **Flexible Authorization**: Support for multiple Authorization header formats
- **Client-Configured Credentials**: API key and endpoint provided by MCP client (no server-side secrets)
- **Experiment Management**: Create, start, stop, and monitor A/B tests
- **Feature Flag Operations**: Quick feature flag creation and management  
- **Analytics & Results**: Retrieve experiment results and insights
- **User & Team Management**: Manage users, teams, goals, and metrics
- **Real-time Communication**: WebSocket and Server-Sent Events support
- **Session-Based OAuth Discovery**: Intelligent OAuth endpoint blocking for API key users
- **Auto-Endpoint Configuration**: Automatic /v1 suffix handling for ABsmartly API endpoints
- **Custom Domain**: Deployed at `mcp.absmartly.com` for easy access

## Quick Start

### Prerequisites

- Node.js 18+ 
- NPM or Yarn
- ABsmartly account and API key
- Cloudflare account (for deployment)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd absmartly-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

### Environment Setup

1. Copy the environment template:
```bash
cp .env.local.example .env.local
```

2. Edit `.env.local` with your ABsmartly credentials:
```bash
ABSMARTLY_API_KEY=your_api_key_here
ABSMARTLY_API_ENDPOINT=https://sandbox.absmartly.com/v1/
```

### Local Development

Run the standalone MCP server locally:

```bash
npm run mcp
```

Or start the Cloudflare Workers dev server:

```bash
npm run dev
```

### Deployment

Deploy to Cloudflare Workers with custom domain:

```bash
npm run deploy
```

The server will be available at: `https://mcp.absmartly.com`

## Usage

### Quick Setup for Claude Desktop

Add the ABsmartly MCP server to Claude Desktop:

1. Go to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the respective config file on your OS
   - You can also reach it via Claude > Settings > Developer > Edit Config

2. If you already have MCP servers configured, add the `absmartly` entry to your `mcpServers` object:

```json
    "absmartly": {
      "command": "npx",
      "args": [
        "mcp-remote", "https://mcp.absmartly.com/sse",
        "--header", "x-absmartly-endpoint:https://sandbox.absmartly.com"
      ]
    }
```

3. If your config file is empty, add the complete configuration:

```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": [
        "mcp-remote", "https://mcp.absmartly.com/sse",
        "--header", "x-absmartly-endpoint:https://sandbox.absmartly.com"
      ]
    }
  }
}
```

**Important**: Replace `https://sandbox.absmartly.com` with your ABsmartly endpoint (e.g., `https://dev-1.absmartly.com/` or your custom endpoint).

### Quick Setup for Claude Code

To use ABsmartly MCP with Claude Code, follow the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp):

1. Create a project-specific `.claude_mcp_config.json` file in your project root
2. Add the ABsmartly MCP configuration to this file

For more detailed instructions on setting up MCP servers with Claude Code, see the [official documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Quick Setup with DXT Extension (Easiest)

For the easiest installation, use the DXT (Desktop Extension) file:

1. Download the `absmartly-mcp.dxt` file from [https://mcp.absmartly.com/absmartly-mcp.dxt](https://mcp.absmartly.com/absmartly-mcp.dxt)
2. Double-click the `.dxt` file to open it in Claude Desktop
3. Click "Install" when prompted
4. Enter your ABsmartly endpoint when asked (e.g., `https://sandbox.absmartly.com`)
5. The extension will be automatically configured and ready to use

**Benefits of DXT installation:**
- No need to install Node.js or manage dependencies
- One-click installation process
- Automatic configuration
- Secure credential storage in OS keychain

### Two Access Methods

#### 1. Local Bridge Mode (All Users)
Use the local MCP bridge for connection - works with all Claude versions.

#### 2. Remote MCP Mode (Claude Pro Only)
Direct connection via Cloudflare Access - requires Claude Pro and proper authentication. See the [Claude Desktop Remote MCP documentation](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers) for setup details.

**Remote MCP Configuration**: For Claude Pro/Teams Remote MCP, use:
```
https://mcp.absmartly.com/sse?absmartly-endpoint=https://sandbox.absmartly.com
```

**Note**: Remote MCP requires OAuth authentication. Claude will first redirect you through the OAuth flow to authenticate with your ABsmartly account before connecting to the MCP server.

Replace `https://sandbox.absmartly.com` with your ABsmartly endpoint.

### Configuration

#### For Local Bridge Users

**Important**: You must configure the API credentials before using any ABsmartly tools.

First, call the configuration tool:

```typescript
// Configure ABsmartly credentials
await client.callTool({
    name: 'configure_absmartly',
    arguments: {
        api_key: 'your-absmartly-api-key',
        api_endpoint: 'https://your-instance.absmartly.com/v1' // optional, defaults to sandbox
    }
});
```

#### For Remote MCP Users (Claude Pro)

If you're using Claude Pro with remote MCP access through Cloudflare Access, use the simplified configuration tool that uses pre-configured credentials:

```typescript
// Configure ABsmartly for remote access (uses default sandbox environment)
await client.callTool({
    name: 'configure_absmartly_remote',
    arguments: {}
});
```

### Available MCP Tools

#### Configuration Tools
- `configure_absmartly` - **Required first**: Set API key and endpoint (local bridge mode)
- `configure_absmartly_remote` - **Required first**: Auto-configure for remote access (Claude Pro mode)
- `get_configuration` - Check current configuration status

#### Core Experiment Management
- `list_experiments` - List experiments with filtering options
- `get_experiment` - Get detailed experiment information  
- `create_experiment` - Create comprehensive experiments
- `create_feature_flag` - Quick feature flag creation
- `start_experiment` / `stop_experiment` - Control experiment lifecycle
- `update_experiment` - Modify existing experiments

#### Analytics & Results  
- `restart_experiment` - Restart stopped experiments
- `set_experiment_full_on` - Set experiments to 100% traffic
- `set_experiment_to_development` - Switch to development mode

#### Resource Management
- `list_goals` / `list_metrics` - Get available goals and metrics
- `list_users` / `list_teams` - User and team management
- `get_goal`, `get_metric`, `get_user`, `get_team` - Get specific resources
- `create_goal`, `create_metric`, `create_user`, `create_team` - Create new resources
- `update_goal`, `update_metric`, `update_user`, `update_team` - Update resources

#### Advanced Operations
- `custom_request` - Make direct API calls to any ABsmartly endpoint

### Example MCP Client Usage

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Connect to the MCP server
const client = new Client({
    name: "absmartly-client",
    version: "1.0.0"
}, {
    capabilities: {}
});

const transport = new SSEClientTransport(
    new URL('https://mcp.absmartly.com/agents/absmartly-mcp/default')
);

await client.connect(transport);

// Step 1: Configure API credentials (required)
await client.callTool({
    name: 'configure_absmartly',
    arguments: {
        api_key: 'your-api-key-here',
        api_endpoint: 'https://sandbox.absmartly.com/v1'
    }
});

// Step 2: Use ABsmartly tools
const experiments = await client.callTool({
    name: 'list_experiments',
    arguments: {
        state: 'running',
        page: 1,
        items: 10
    }
});

// Create a feature flag
const featureFlag = await client.callTool({
    name: 'create_feature_flag',
    arguments: {
        name: 'new-checkout-flow',
        unit_type_id: 1,
        application_id: 1,
        feature_enabled_percentage: 50
    }
});
```

## Configuration

### No Server-Side Secrets Required

This MCP server doesn't require any server-side API keys or secrets. All credentials are provided by the MCP client using the `configure_absmartly` tool.

### Cloudflare Workers Configuration

The server is configured in `wrangler.toml` with custom domain support:

```toml
name = "absmartly-mcp"
main = "src/index.ts"
compatibility_date = "2024-10-31"
compatibility_flags = ["nodejs_compat"]

# Custom domain configuration
routes = [
  { pattern = "mcp.absmartly.com/*", custom_domain = true }
]

[durable_objects]
bindings = [
  { name = "ABsmartlyMCP", class_name = "ABsmartlyMCP" }
]
```

## Remote MCP Setup (Claude Pro)

For Claude Pro users, you can connect directly to the ABsmartly MCP server without running a local bridge. This requires setting up Cloudflare Access for authentication.

### Prerequisites

- Claude Pro subscription (required for remote MCP access)
- Cloudflare account with Access enabled
- Admin access to configure Cloudflare Access policies

### Setting Up Cloudflare Access

1. **Create an Access Application** in your Cloudflare dashboard:
   - Go to Zero Trust → Access → Applications → Add an application
   - Choose "Self-hosted" 
   - Set Application domain: `mcp.absmartly.com`
   - Path: `/remote-mcp`

2. **Configure Authentication**:
   - Set up your preferred identity provider (Google Workspace, GitHub, etc.)
   - Create policies to allow specific email addresses

3. **Configure Environment Variables**:
   ```bash
   # Copy and edit the environment template
   cp env.vars.example .dev.vars
   
   # Set your Cloudflare Access configuration
   ACCESS_CLIENT_ID=your_access_client_id_here
   ACCESS_CLIENT_SECRET=your_access_client_secret_here
   ALLOWED_EMAILS=user1@example.com,user2@example.com
   
   # Set default ABsmartly credentials for authenticated users
   DEFAULT_ABSMARTLY_API_KEY=your_default_api_key_here
   DEFAULT_ABSMARTLY_ENDPOINT=https://sandbox.absmartly.com/v1
   ```

4. **Deploy with OAuth Support**:
   ```bash
   npm run deploy
   ```

### Using mcp-remote with Header Authentication

Instead of using Claude Pro's remote MCP (which requires Cloudflare Access), you can use the `mcp-remote` proxy with header-based authentication. This works with any Claude version and provides more flexibility.

#### Four Authentication Formats Supported:

**Format 1: Subdomain Convenience**
```json
{
  "absmartly": {
    "command": "npx",
    "args": [
      "mcp-remote", 
      "https://mcp.absmartly.com/sse",
      "--header", "Authorization:demo-1 BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi"
    ]
  }
}
```
- Auto-constructs endpoint: `https://demo-1.absmartly.com/v1`
- Perfect for standard subdomain setups
- Automatically adds `/v1` suffix if missing

**Format 2: Explicit Api-Key with Custom Endpoint**
```json
{
  "absmartly": {
    "command": "npx", 
    "args": [
      "mcp-remote",
      "https://mcp.absmartly.com/sse",
      "--header", "Authorization:Api-Key BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi",
      "--header", "X-ABSMARTLY-API-ENDPOINT:https://custom-domain.absmartly.com"
    ]
  }
}
```
- Backwards compatible with existing setups
- Supports custom domain endpoints
- Automatically adds `/v1` suffix if missing

**Format 3: OAuth Bearer Token**
```json
{
  "absmartly": {
    "command": "npx",
    "args": [
      "mcp-remote",
      "https://mcp.absmartly.com/sse", 
      "--header", "Authorization:Bearer your_oauth_token_here",
      "--header", "X-ABSMARTLY-API-ENDPOINT:https://demo-1.absmartly.com"
    ]
  }
}
```
- For OAuth-authenticated users
- Requires explicit endpoint specification
- Automatically adds `/v1` suffix if missing

**Format 4: Simple API Key**
```json
{
  "absmartly": {
    "command": "npx",
    "args": [
      "mcp-remote",
      "https://mcp.absmartly.com/sse",
      "--header", "Authorization:BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi",
      "--header", "X-ABSMARTLY-API-ENDPOINT:https://dev-1.absmartly.com"
    ]
  }
}
```
- Simplest format for testing
- Requires explicit endpoint specification
- Automatically adds `/v1` suffix if missing

### Using Remote MCP in Claude Pro (Alternative)

For Claude Pro users who prefer the direct connection method:

1. **Add the MCP Server** in your Claude Pro settings:
   - Server URL: `https://mcp.absmartly.com/remote-mcp`
   - This will require authentication through your configured Cloudflare Access

2. **Configure the Connection**:
   ```typescript
   // After Claude Pro connects, configure ABsmartly
   await client.callTool({
       name: 'configure_absmartly_remote',
       arguments: {}
   });
   ```

### Security Features

- **Cloudflare Access Protection**: Only authenticated users can access the remote MCP endpoint
- **Email Allowlist**: Restrict access to specific email addresses
- **Default Credentials**: Server administrators can provide default ABsmartly credentials for authenticated users
- **Backwards Compatibility**: Local bridge mode continues to work for all users

### Environment Variables

Copy `env.vars.example` to `.dev.vars` for local development or set as Cloudflare Worker environment variables for production:

```bash
# Cloudflare Access OAuth Settings
ACCESS_CLIENT_ID=your_access_client_id_here
ACCESS_CLIENT_SECRET=your_access_client_secret_here

# Allowed email addresses for remote MCP access (comma-separated)
ALLOWED_EMAILS=user1@example.com,user2@example.com

# ABsmartly API Configuration (for users without local setup)
DEFAULT_ABSMARTLY_API_KEY=your_default_api_key_here
DEFAULT_ABSMARTLY_ENDPOINT=https://sandbox.absmartly.com/v1
```

## API Endpoints

The server provides these endpoints at `https://mcp.absmartly.com`:

- **Health Check**: `/health`
- **MCP Local Bridge**: `/mcp` (WebSocket), `/sse` (Server-Sent Events)
- **MCP Remote Access**: `/remote-mcp` (Cloudflare Access protected)
- **Health with Status**: Shows whether Cloudflare Access is enabled

## Architecture

This MCP server is built using:

- **Cloudflare Agents**: Native MCP integration framework
- **Durable Objects**: Persistent state and credential management per session
- **TypeScript**: Type-safe development
- **ABsmartly REST API**: Direct integration with ABsmartly platform
- **Custom Domain**: Professional `mcp.absmartly.com` endpoint

## Security

- **No Server-Side Secrets**: API keys are never stored on the server
- **Session-Based**: Each MCP session maintains its own isolated credentials
- **HTTPS Only**: All communication encrypted via HTTPS
- **Credential Validation**: API keys validated on first use
- **OAuth Discovery Protection**: Intelligent blocking of OAuth endpoints for API key users
- **Session Fingerprinting**: Secure session tracking using IP and User-Agent

## Development

### Project Structure

```
src/
├── index.ts                        # Main worker entry point with OAuth and API key routing
├── simple-mcp.ts                   # Main MCP server implementation with dynamic custom fields
├── api-client.ts                   # ABsmartly API client with auto /v1 suffix handling
├── absmartly-oauth-handler.ts      # OAuth authorization handler
├── workers-oauth-utils.ts          # OAuth utility functions
├── types.ts                        # TypeScript type definitions
└── standalone.ts                   # Local development server
```

### Building

```bash
npm run build          # Compile TypeScript
npm run typecheck      # Type checking only
```

### Building DXT Extension

To create a DXT extension file for easy installation:

```bash
# Install DXT CLI (one-time setup)
npm run install:dxt

# Build the .dxt extension file
npm run build:dxt

# Build and prepare DXT file for deployment
npm run upload:dxt
```

This creates `absmartly-mcp.dxt` that users can double-click to install. The `upload:dxt` script builds the DXT file and copies it to the `public` directory, making it available at `https://mcp.absmartly.com/absmartly-mcp.dxt` when deployed.

### Testing

```bash
npm run dev            # Start development server
npm run mcp            # Run standalone MCP server
```

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Open an issue in this repository
- Contact ABsmartly support for API-related questions