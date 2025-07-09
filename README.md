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

### Setup Options Overview

The ABsmartly MCP server can be connected to Claude in several ways:

1. **DXT Extension (Easiest)** - One-click installation for Claude Desktop
2. **Remote MCP (Claude Pro/Teams)** - Direct connection with OAuth authentication
3. **Local Bridge (All Users)** - Uses mcp-remote proxy for any Claude version
4. **Claude Code** - Project-specific MCP configuration

### Method 1: DXT Extension (Recommended for Most Users)

The easiest installation method using the DXT (Desktop Extension) file:

1. **Download the DXT file** from [https://mcp.absmartly.com/absmartly-mcp.dxt](https://mcp.absmartly.com/absmartly-mcp.dxt)
2. **Double-click the `.dxt` file** to open it in Claude Desktop
3. **Click "Install"** when prompted
4. **Enter your ABsmartly endpoint** when asked (e.g., `https://sandbox.absmartly.com`)
5. **The extension will be automatically configured** and ready to use

**Benefits of DXT installation:**
- No need to install Node.js or manage dependencies
- One-click installation process
- Automatic configuration
- Secure credential storage in OS keychain

### Method 2: Remote MCP (Claude Pro/Teams Only)

Direct connection with OAuth authentication for Claude Pro and Teams users:

1. **Open Claude Desktop Settings**
2. **Navigate to Remote MCP Servers**
3. **Add a new server** with these details:
   - **Name**: ABsmartly MCP
   - **URL**: `https://mcp.absmartly.com/sse`
   - **Authorization**: OAuth (will redirect to ABsmartly for authentication)

4. **Configure endpoint** by adding query parameter:
   ```
   https://mcp.absmartly.com/sse?absmartly-endpoint=https://sandbox.absmartly.com
   ```

5. **Complete OAuth flow** when prompted - you'll be redirected to ABsmartly to authenticate

**Note**: Remote MCP requires OAuth authentication through ABsmartly. Replace `https://sandbox.absmartly.com` with your ABsmartly endpoint.

### Method 3: Local Bridge (All Claude Versions)

Uses mcp-remote proxy to work with any Claude version:

#### Step 1: Locate your Claude Desktop config file
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Or access via Claude > Settings > Developer > Edit Config

#### Step 2: Add ABsmartly MCP configuration

If you already have MCP servers configured, add the `absmartly` entry:

```json
{
  "mcpServers": {
    "your-existing-server": {
      "command": "...",
      "args": ["..."]
    },
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

If your config file is empty, use this complete configuration:

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

You can also add an API Key, in that case it will bypass the OAuth flow.

```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": [
        "mcp-remote", "https://mcp.absmartly.com/sse",
        "--header", "x-absmartly-endpoint:https://sandbox.absmartly.com"
        "--header", "Authorization:YOUR_API_KEY_HERE",
      ]
    }
  }
}
```

#### Step 3: Configure your credentials

Replace the placeholders:
- `YOUR_API_KEY_HERE` with your ABsmartly API key
- `https://sandbox.absmartly.com` with your ABsmartly endpoint

#### Advanced Authorization Formats

The server supports multiple authorization formats:

**Format 1: Simple API Key**
```json
"--header", "Authorization:BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi"
```

**Format 2: Explicit Api-Key**
```json
"--header", "Authorization:Api-Key BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi"
```

**Format 3: Subdomain Shorthand**
```json
"--header", "Authorization:demo-1 BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi"
```
- Auto-constructs the ABsmartly endpoint as: `https://demo-1.absmartly.com/v1`

**Format 4: Full domain as ABsmartly endpoint**
```json
"--header", "Authorization:demo-1.absmartly.com BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi"
```
- Auto-constructs the ABsmartly endpoint as: `https://demo-1.absmartly.com/v1`

All formats automatically add `/v1` suffix to endpoints if missing.
All formats automatically remove the `Bearer` prefix if present. Some clients add it automatically.

### Method 4: Claude Code

For Claude Code users, create a project-specific MCP configuration:

#### Step 1: Create MCP config file

Create `.claude_mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "absmartly": {
      "command": "npx",
      "args": [
        "mcp-remote", 
        "https://mcp.absmartly.com/sse",
        "--header", "Authorization:YOUR_API_KEY_HERE",
        "--header", "x-absmartly-endpoint:https://sandbox.absmartly.com"
      ]
    }
  }
}
```

#### Step 2: Configure credentials

Replace the placeholders with your actual ABsmartly credentials.

#### Step 3: Restart Claude Code

Restart Claude Code to load the new MCP configuration.

For more detailed instructions, see the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Troubleshooting

**Connection Issues:**
- Ensure your ABsmartly endpoint is correct and includes the proper protocol (https://)
- Verify your API key has the necessary permissions
- Check that your network allows connections to `mcp.absmartly.com`

**Authentication Problems:**
- For OAuth (Remote MCP): Complete the authentication flow in your browser
- For API keys: Ensure the key is valid and hasn't expired
- Check that your endpoint URL is correct

**Performance Issues:**
- DXT extension generally provides the best performance
- Remote MCP (OAuth) offers good performance for Pro/Teams users
- Local bridge (mcp-remote) may have slightly higher latency but works universally


### Getting Started After Setup

Once you've connected the ABsmartly MCP server using any of the methods above, you can start using ABsmartly tools in Claude:



Your credentials are automatically configured from the setup. You can start using ABsmartly tools immediately:

```
Show me all running experiments
```

```
Create a new feature flag called "dark-mode" for the main app
```

#### For OAuth Authentication (Method 2)

After completing the OAuth flow, you can use ABsmartly tools directly:

```
List all my experiments
```

```
Get analytics for experiment ID 123
```

#### Verifying Your Connection

Test your connection with:

```
Check my ABsmartly configuration status
```

This will show you:
- Whether you're connected
- Which endpoint you're using
- Authentication method
- Available tools

### Available MCP Tools

#### Configuration Tools
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

### Example Usage

Once connected, you can use ABsmartly tools directly in Claude:

**List running experiments:**
```
Show me all running experiments
```

**Create a feature flag:**
```
Create a feature flag called "new-checkout-flow" with 50% traffic
```

**Get experiment details:**
```
Get details for experiment ID 123
```

**Check experiment metrics:**
```
What are the current metrics for experiment "homepage-redesign"?
```

**Manage experiment lifecycle:**
```
Start experiment ID 456
```

**Create a new experiment:**
```
Create a new A/B test for the checkout page with two variants
```

## Configuration

### No Server-Side Secrets Required

This MCP server doesn't require any server-side API keys or secrets. All credentials are provided through the connection setup:

- **DXT Extension**: Credentials stored securely in OS keychain
- **Remote MCP**: OAuth authentication with ABsmartly
- **Local Bridge**: API keys provided via headers in configuration
- **Claude Code**: API keys provided via headers in project config

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

## Advanced Configuration

### Remote MCP with OAuth (Claude Pro/Teams)

For Claude Pro and Teams users, the server supports OAuth authentication through ABsmartly:

1. **OAuth Flow**: When using Remote MCP, Claude will redirect you to ABsmartly for authentication
2. **Session Management**: OAuth sessions are managed securely with proper token handling
3. **Automatic Configuration**: Once authenticated, the server automatically configures your ABsmartly connection

### Local Development Setup

For developers who want to run the server locally:

1. **Clone and Install**:
   ```bash
   git clone <repository-url>
   cd absmartly-mcp
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your ABsmartly credentials
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```


### Environment Variables

For deployment, configure these environment variables in your Cloudflare Worker:

```bash
# OAuth Configuration (for Remote MCP)
OAUTH_CLIENT_ID=your_oauth_client_id_here
OAUTH_CLIENT_SECRET=your_oauth_client_secret_here

# Default ABsmartly Configuration (optional)
DEFAULT_ABSMARTLY_ENDPOINT=https://sandbox.absmartly.com/v1
```

## API Endpoints

The server provides these endpoints at `https://mcp.absmartly.com`:

- **Health Check**: `/health`
- **MCP Local Bridge**: `/mcp` (WebSocket), `/sse` (Server-Sent Events)
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