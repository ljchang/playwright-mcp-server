# Playwright MCP Server

A Model Context Protocol (MCP) server that provides Playwright browser automation tools for testing web applications, capturing screenshots, generating documentation, and running accessibility checks.

## Features

### Core Tools

- **screenshot** - Capture full page or element screenshots
- **test_login** - Test login flows with credentials
- **fill_form** - Fill and submit forms automatically
- **check_element** - Verify element existence and content
- **navigate_and_wait** - Navigate to URLs with custom wait conditions
- **click_and_wait** - Click elements and wait for results
- **extract_text** - Extract text content from page elements
- **run_accessibility_check** - Run WCAG accessibility audits
- **generate_pdf** - Convert webpages to PDF documents
- **monitor_network** - Monitor and capture network requests

### Session Management Tools

- **start_session** - Start a persistent browser session that stays open
- **end_session** - Close a specific browser session
- **list_sessions** - List all active browser sessions
- **get_session_state** - Get current state of a browser session
- **get_page_context** - Get detailed page context including forms, buttons, and links
- **get_screenshot_history** - Get screenshot history for a session

### Debugging & Console Tools (NEW!)

- **console** - Interactive JavaScript console - execute commands in page context
- **console_history** - Get console command history for the session
- **inspect_object** - Deep inspect any JavaScript object or variable
- **execute_script** - Execute JavaScript code in the page
- **get_debug_info** - Get console logs, errors, and network activity
- **get_dom_snapshot** - Get structured DOM representation
- **set_breakpoint** - Set debugging breakpoints in JavaScript code

All tools now support both one-off operations and persistent sessions!

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Docker (optional, for containerized deployment)

### Local Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/playwright-mcp-server.git
cd playwright-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install chromium
```

4. Create environment file:
```bash
cp .env.example .env
```

5. Edit `.env` with your configuration:
```env
TEST_USER=testuser@example.com
TEST_PASS=testpassword123
HEADLESS=true
APP_BASE_URL=http://localhost:3000
```

## Usage

### Using with Claude Code (Recommended)

Claude Code automatically manages the MCP server lifecycle - no need to manually start the server!

#### Quick Setup (Global Installation)

1. First, ensure you have the server installed:
```bash
git clone https://github.com/ljchang/playwright-mcp-server.git
cd playwright-mcp-server
npm install
npx playwright install chromium
```

2. Add the server to Claude Code globally (available in all sessions):
```bash
claude mcp add playwright-mcp "node" "/absolute/path/to/playwright-mcp-server/src/index.js" --scope user
```

3. Verify the server is connected:
```bash
claude mcp list
```

That's it! The server will automatically start when Claude Code needs it.

#### Usage Examples in Claude Code

##### One-off Operations

- **Headless mode (default - fast, no UI):**
  ```
  "Use playwright to screenshot https://example.com"
  ```

- **Visible mode (see the browser in action):**
  ```
  "Use playwright to screenshot https://example.com with headless=false"
  ```

##### Persistent Browser Sessions

Keep a browser open for multiple operations - perfect for debugging and interactive testing:

1. **Start a session with debugging and screenshots:**
   ```
   "Start a playwright session with debugMode=true and recordScreenshots=true"
   ```
   Response will include a sessionId like: `session-1234567890-abc123`

2. **Use the session for multiple operations:**
   ```
   "Use playwright session-1234567890-abc123 to click the login button"
   "Use playwright session-1234567890-abc123 to fill the form with test data"
   "Use playwright session-1234567890-abc123 to take a screenshot"
   ```

3. **Interactive JavaScript console:**
   ```
   "Use playwright console for session-1234567890-abc123 to execute: document.title"
   "Use playwright to inspect window.localStorage in session-1234567890-abc123"
   "Use playwright to check console logs for session-1234567890-abc123"
   ```

4. **Debug and inspect:**
   ```
   "Get debug info for playwright session-1234567890-abc123"
   "Get DOM snapshot for #app in session-1234567890-abc123"
   "Get page context for session-1234567890-abc123"
   ```

5. **List active sessions:**
   ```
   "List all playwright sessions"
   ```

6. **End a session when done:**
   ```
   "End playwright session-1234567890-abc123"
   ```

The browser window stays open between commands, maintaining state, cookies, and login sessions!

#### Optional: Add Environment Variables

To add credentials or customize behavior:
```bash
claude mcp add playwright-mcp "node" "/path/to/playwright-mcp-server/src/index.js" \
  --scope user \
  -e TEST_USER=your_email@example.com \
  -e TEST_PASS=your_password \
  -e HEADLESS=false \
  -e SLOW_MO=500
```

### Using with Claude Desktop

Add the server to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["/path/to/playwright-mcp-server/src/index.js"],
      "env": {
        "TEST_USER": "testuser@example.com",
        "TEST_PASS": "testpassword123",
        "HEADLESS": "true"
      }
    }
  }
}
```

### Manual Server Mode

For development or testing without Claude:

#### Standard Mode
```bash
npm start
```

#### Development Mode (with auto-reload)
```bash
npm run dev
```

#### Docker Mode
```bash
docker-compose up
```

### Tool Examples

All tools now support:
- `headless` parameter (default: `true`) - Set to `false` to see the browser in action
- `sessionId` parameter (optional) - Use an existing browser session for the operation

#### Take a Screenshot
```javascript
{
  "tool": "screenshot",
  "arguments": {
    "url": "https://example.com",
    "fullPage": true,
    "filename": "homepage.png",
    "headless": false  // Optional: see the browser window
  }
}
```

#### Test Login Flow
```javascript
{
  "tool": "test_login",
  "arguments": {
    "url": "https://app.example.com/login",
    "usernameSelector": "#email",
    "passwordSelector": "#password",
    "submitSelector": "button[type='submit']",
    "headless": false  // Optional: watch the login process
  }
}
```

#### Fill a Form
```javascript
{
  "tool": "fill_form",
  "arguments": {
    "url": "https://example.com/contact",
    "formData": {
      "#name": "John Doe",
      "#email": "john@example.com",
      "#message": "Test message"
    },
    "submitSelector": "#submit-button"
  }
}
```

#### Check Element Content
```javascript
{
  "tool": "check_element",
  "arguments": {
    "url": "https://example.com",
    "selector": "h1",
    "expectedText": "Welcome"
  }
}
```

#### Extract Text Content
```javascript
{
  "tool": "extract_text",
  "arguments": {
    "url": "https://example.com/blog",
    "selectors": ["h1", ".article-title", ".author"],
    "extractAll": true
  }
}
```

#### Run Accessibility Check
```javascript
{
  "tool": "run_accessibility_check",
  "arguments": {
    "url": "https://example.com",
    "standard": "WCAG2AA"
  }
}
```

#### Generate PDF
```javascript
{
  "tool": "generate_pdf",
  "arguments": {
    "url": "https://example.com/report",
    "filename": "report.pdf",
    "format": "A4",
    "landscape": false
  }
}
```

#### Monitor Network Requests
```javascript
{
  "tool": "monitor_network",
  "arguments": {
    "url": "https://example.com",
    "captureTypes": ["xhr", "fetch"],
    "filterPattern": "api.*"
  }
}
```

#### Session Management

##### Start a Persistent Session with Debugging
```javascript
{
  "tool": "start_session",
  "arguments": {
    "headless": false,  // Default false for sessions
    "url": "https://example.com",  // Optional initial URL
    "debugMode": true,  // Capture console logs, errors, network
    "recordScreenshots": true  // Auto-capture screenshots after each action
  }
}
// Returns: sessionId to use with other tools
```

##### Use Session with Other Tools
```javascript
{
  "tool": "screenshot",
  "arguments": {
    "url": "https://example.com/page2",
    "sessionId": "session-1234567890-abc123"  // Use existing session
  }
}
```

##### List Active Sessions
```javascript
{
  "tool": "list_sessions",
  "arguments": {}
}
```

##### End a Session
```javascript
{
  "tool": "end_session",
  "arguments": {
    "sessionId": "session-1234567890-abc123"
  }
}
```

#### Debugging Tools

##### Interactive JavaScript Console
```javascript
{
  "tool": "console",
  "arguments": {
    "sessionId": "session-1234567890-abc123",
    "command": "document.querySelector('#app').innerText",
    "mode": "eval"  // Options: eval, inspect, watch
  }
}
```

##### Deep Object Inspection
```javascript
{
  "tool": "inspect_object",
  "arguments": {
    "sessionId": "session-1234567890-abc123",
    "expression": "window.localStorage",
    "depth": 3
  }
}
```

##### Get Debug Information
```javascript
{
  "tool": "get_debug_info",
  "arguments": {
    "sessionId": "session-1234567890-abc123",
    "includeConsole": true,
    "includeErrors": true,
    "includeNetwork": true
  }
}
```

##### Get DOM Snapshot
```javascript
{
  "tool": "get_dom_snapshot",
  "arguments": {
    "sessionId": "session-1234567890-abc123",
    "selector": "#app",
    "includeStyles": true
  }
}
```

##### Get Page Context (Forms, Buttons, Links)
```javascript
{
  "tool": "get_page_context",
  "arguments": {
    "sessionId": "session-1234567890-abc123"
  }
}
// Returns all interactive elements on the page
```

## Docker Deployment

### Build and Run with Docker Compose

```bash
# Build the image
docker-compose build

# Run the server
docker-compose up

# Run with test app (optional)
docker-compose --profile with-test-app up
```

### Docker Environment Variables

Configure via `docker-compose.yml` or `.env`:

- `NODE_ENV` - Environment (development/production)
- `HEADLESS` - Run browser in headless mode
- `TEST_USER` - Default test username
- `TEST_PASS` - Default test password
- `MCP_AUTH_TOKEN` - Authentication token for MCP

## Environment Configuration

### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `HEADLESS` | Run browser in headless mode | `true` |
| `TEST_USER` | Default username for login tests | - |
| `TEST_PASS` | Default password for login tests | - |
| `MCP_AUTH_TOKEN` | MCP authentication token | - |

### Application URLs

| Variable | Description | Example |
|----------|-------------|---------|
| `APP_BASE_URL` | Local development URL | `http://localhost:3000` |
| `APP_STAGING_URL` | Staging environment URL | `https://staging.example.com` |
| `APP_PRODUCTION_URL` | Production environment URL | `https://example.com` |

### Browser Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSER_TIMEOUT` | Browser operation timeout (ms) | `30000` |
| `NAVIGATION_TIMEOUT` | Page navigation timeout (ms) | `30000` |
| `SLOW_MO` | Delay between actions (ms) | `0` |

### Screenshot Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `SCREENSHOT_QUALITY` | JPEG quality (1-100) | `80` |
| `SCREENSHOT_TYPE` | Image format (png/jpeg) | `png` |

## File Structure

```
playwright-mcp-server/
├── src/
│   └── index.js          # Main MCP server implementation
├── docker/
│   └── Dockerfile        # Docker container configuration
├── screenshots/          # Screenshot output directory
├── tests/               # Test files
├── docker-compose.yml   # Docker Compose configuration
├── package.json         # Node.js dependencies
├── .env.example        # Environment template
├── .gitignore          # Git ignore rules
└── README.md           # Documentation
```

## Development

### Running Tests
```bash
npm test
```

### Adding New Tools

1. Add tool definition in `tools/list` handler
2. Implement tool logic in `tools/call` switch statement
3. Update README with usage example

### Debugging

Set `HEADLESS=false` in `.env` to see browser actions:
```env
HEADLESS=false
SLOW_MO=500  # Add 500ms delay between actions
```

## Security Considerations

- Never commit `.env` files with real credentials
- Use environment-specific credentials
- Rotate `MCP_AUTH_TOKEN` regularly
- Run in containers for isolation
- Limit network access in production

## Troubleshooting

### Browser Installation Issues
```bash
# Reinstall Playwright browsers
npx playwright install --with-deps chromium
```

### Permission Errors in Docker
```bash
# Run with proper permissions
docker-compose run --user root playwright-mcp npm install
```

### Screenshot Directory Issues
```bash
# Create screenshots directory
mkdir -p screenshots
chmod 755 screenshots
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - See LICENSE file for details

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review environment configuration

## Acknowledgments

- Built with [Playwright](https://playwright.dev/) for browser automation
- Implements [Model Context Protocol](https://github.com/modelcontextprotocol) (MCP) specification
- Uses official Playwright Docker images for containerization