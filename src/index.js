import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

// Load environment variables
dotenv.config();

import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Determine screenshots directory
// Priority: 1. Environment variable, 2. User home directory, 3. Project directory
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || 
  join(os.homedir(), '.playwright-mcp', 'screenshots') ||
  join(__dirname, '..', 'screenshots');

// Ensure screenshots directory exists
await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
// Only log in development mode or when running directly
if (process.env.NODE_ENV !== 'test' && process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error(`Screenshots will be saved to: ${SCREENSHOTS_DIR}`);
}

// Initialize MCP server
const server = new Server(
  {
    name: 'playwright-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Store browser instances for reuse
let headlessBrowser = null;
let headedBrowser = null;

// Store persistent sessions
const persistentSessions = new Map(); // sessionId -> { browser, context, page, recordScreenshots, screenshots, consoleLogs, errors, networkRequests }

// Store test scenarios
const testScenarios = new Map(); // scenarioId -> TestScenario object

// TestScenario class for managing multi-participant tests
class TestScenario {
  constructor(id, metadata = {}) {
    this.scenarioId = id;
    this.createdAt = new Date().toISOString();
    this.metadata = {
      name: metadata.name || 'Unnamed Scenario',
      description: metadata.description || '',
      experimentName: metadata.experimentName || '',
      testParameters: metadata.testParameters || {},
      tags: metadata.tags || []
    };
    this.sessions = new Map(); // sessionId -> { role, label, status, joinedAt }
    this.state = {
      phase: 'created', // created, running, completed, failed
      customData: metadata.initialState || {}
    };
    this.events = []; // Timeline of events for debugging
  }

  // Add a session to this scenario
  addSession(sessionId, role, label) {
    this.sessions.set(sessionId, {
      role: role || 'participant',
      label: label || sessionId,
      status: 'active',
      joinedAt: new Date().toISOString()
    });
    this.logEvent('session_joined', { sessionId, role, label });
  }

  // Remove a session from this scenario
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.logEvent('session_left', { sessionId, role: session.role, label: session.label });
    }
  }

  // Update scenario state
  updateState(updates) {
    if (updates.phase) {
      this.state.phase = updates.phase;
    }
    if (updates.customData) {
      Object.assign(this.state.customData, updates.customData);
    }
    this.logEvent('state_updated', updates);
  }

  // Log an event for debugging
  logEvent(type, data) {
    this.events.push({
      timestamp: new Date().toISOString(),
      type,
      data
    });
    // Keep only last 500 events to avoid memory issues
    if (this.events.length > 500) {
      this.events.shift();
    }
  }

  // Get sessions by role
  getSessionsByRole(role) {
    const result = [];
    for (const [sessionId, info] of this.sessions.entries()) {
      if (info.role === role) {
        result.push({ sessionId, ...info });
      }
    }
    return result;
  }

  // Get session by label
  getSessionByLabel(label) {
    for (const [sessionId, info] of this.sessions.entries()) {
      if (info.label === label) {
        return { sessionId, ...info };
      }
    }
    return null;
  }

  // Get scenario summary
  getSummary() {
    return {
      scenarioId: this.scenarioId,
      createdAt: this.createdAt,
      metadata: this.metadata,
      state: this.state,
      sessionCount: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, info]) => ({
        sessionId: id,
        ...info
      })),
      eventCount: this.events.length
    };
  }
}

// Generate a unique scenario ID
function generateScenarioId() {
  return `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function getBrowser(headless = true) {
  // Use separate browser instances for headless and headed modes
  if (headless) {
    if (!headlessBrowser) {
      headlessBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return headlessBrowser;
  } else {
    if (!headedBrowser) {
      const slowMo = parseInt(process.env.SLOW_MO) || 0;
      headedBrowser = await chromium.launch({
        headless: false,
        slowMo: slowMo, // Add delay between actions for visibility
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return headedBrowser;
  }
}

// Generate a unique session ID
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Capture screenshot for session recording
async function captureSessionScreenshot(session, sessionId, action = 'action') {
  if (!session.recordScreenshots) return null;
  
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const screenshotNum = String(session.screenshots.length + 1).padStart(4, '0');
    const filename = `${screenshotNum}-${action}-${timestamp}.png`;
    const filepath = join(SCREENSHOTS_DIR, 'sessions', sessionId, filename);
    
    await session.page.screenshot({ 
      path: filepath,
      fullPage: false // Just viewport for performance
    });
    
    session.screenshots.push({
      filename,
      action,
      timestamp: new Date().toISOString(),
      url: session.page.url()
    });
    
    return filename;
  } catch (e) {
    console.error(`Failed to capture screenshot: ${e.message}`);
    return null;
  }
}

// Setup debug listeners for a session
function setupDebugListeners(session) {
  const page = session.page;
  
  // Capture console logs
  page.on('console', msg => {
    session.consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
      url: page.url(),
      args: msg.args().length
    });
    
    // Keep only last 100 logs to avoid memory issues
    if (session.consoleLogs.length > 100) {
      session.consoleLogs.shift();
    }
  });
  
  // Capture page errors
  page.on('pageerror', error => {
    session.errors.push({
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      url: page.url()
    });
  });
  
  // Capture network requests (basic info only)
  page.on('request', request => {
    if (session.debugMode) {
      session.networkRequests.push({
        type: 'request',
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString()
      });
      
      // Keep only last 200 requests
      if (session.networkRequests.length > 200) {
        session.networkRequests.shift();
      }
    }
  });
  
  page.on('response', response => {
    if (session.debugMode) {
      const request = session.networkRequests.find(r => 
        r.type === 'request' && r.url === response.url()
      );
      if (request) {
        request.status = response.status();
        request.statusText = response.statusText();
        request.responseTime = new Date().toISOString();
      }
    }
  });
  
  // Capture failed requests
  page.on('requestfailed', request => {
    const failure = request.failure();
    session.errors.push({
      type: 'network',
      message: `Request failed: ${request.url()}`,
      error: failure ? failure.errorText : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  });
}

// Get page context with interactive elements
async function getPageContext(page) {
  try {
    const context = await page.evaluate(() => {
      // Find all interactive elements
      const forms = Array.from(document.querySelectorAll('form')).map((form, idx) => ({
        index: idx,
        id: form.id || null,
        action: form.action || null,
        method: form.method || 'GET',
        inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(input => ({
          type: input.type || 'text',
          name: input.name || null,
          id: input.id || null,
          placeholder: input.placeholder || null,
          required: input.required || false,
          value: input.type === 'password' ? '(hidden)' : (input.value || null),
          selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : `${input.tagName.toLowerCase()}[type="${input.type}"]`
        }))
      }));
      
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).map(btn => ({
        text: btn.textContent?.trim() || btn.value || '',
        type: btn.type || 'button',
        selector: btn.id ? `#${btn.id}` : 
                 btn.textContent ? `button:has-text("${btn.textContent.trim()}")` : 
                 `${btn.tagName.toLowerCase()}[type="${btn.type}"]`,
        disabled: btn.disabled || false
      }));
      
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(link => ({
        text: link.textContent?.trim() || '',
        href: link.href,
        selector: link.id ? `#${link.id}` : `a:has-text("${link.textContent?.trim() || ''}")`
      }));
      
      // Get visible text headings for context
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10).map(h => ({
        level: h.tagName,
        text: h.textContent?.trim() || ''
      }));
      
      return {
        forms,
        buttons: buttons.filter(b => b.text || b.type === 'submit'),
        links: links.filter(l => l.text && !l.href.startsWith('javascript:')),
        headings
      };
    });
    
    return {
      url: page.url(),
      title: await page.title(),
      ...context
    };
  } catch (e) {
    return {
      url: page.url(),
      title: await page.title(),
      error: `Failed to analyze page: ${e.message}`
    };
  }
}

// Get or create a session
async function getOrCreateSession(sessionId, headless = true, scenarioInfo = null) {
  if (sessionId && persistentSessions.has(sessionId)) {
    return persistentSessions.get(sessionId);
  }
  
  // Create new session if not exists
  const browser = await chromium.launch({
    headless: headless,
    slowMo: headless ? 0 : (parseInt(process.env.SLOW_MO) || 0),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Playwright MCP Testing)',
  });
  
  const page = await context.newPage();
  
  const session = { 
    browser, 
    context, 
    page, 
    recordScreenshots: false, 
    screenshots: [],
    consoleLogs: [],
    errors: [],
    networkRequests: [],
    debugMode: false,
    consoleHistory: [],
    watchedExpressions: new Map(),
    // Scenario-related metadata
    scenarioId: scenarioInfo?.scenarioId || null,
    role: scenarioInfo?.role || null,
    label: scenarioInfo?.label || null
  };
  
  if (sessionId) {
    persistentSessions.set(sessionId, session);
    
    // If this session is part of a scenario, register it
    if (scenarioInfo?.scenarioId && testScenarios.has(scenarioInfo.scenarioId)) {
      const scenario = testScenarios.get(scenarioInfo.scenarioId);
      scenario.addSession(sessionId, scenarioInfo.role, scenarioInfo.label);
    }
  }
  
  return session;
}

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'screenshot',
      description: 'Take a screenshot of a webpage',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to screenshot',
          },
          fullPage: {
            type: 'boolean',
            description: 'Capture full page (default: true)',
            default: true,
          },
          selector: {
            type: 'string',
            description: 'CSS selector for specific element (optional)',
          },
          filename: {
            type: 'string',
            description: 'Output filename (optional)',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'test_login',
      description: 'Test login functionality',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the login page',
          },
          usernameSelector: {
            type: 'string',
            description: 'CSS selector for username field',
            default: '#username',
          },
          passwordSelector: {
            type: 'string',
            description: 'CSS selector for password field',
            default: '#password',
          },
          submitSelector: {
            type: 'string',
            description: 'CSS selector for submit button',
            default: 'button[type="submit"]',
          },
          username: {
            type: 'string',
            description: 'Username (uses TEST_USER env var if not provided)',
          },
          password: {
            type: 'string',
            description: 'Password (uses TEST_PASS env var if not provided)',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'fill_form',
      description: 'Fill out a form on a webpage',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page',
          },
          formData: {
            type: 'object',
            description: 'Object with selector: value pairs',
            additionalProperties: true,
          },
          submitSelector: {
            type: 'string',
            description: 'Selector for submit button (optional)',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url', 'formData'],
      },
    },
    {
      name: 'check_element',
      description: 'Check if element exists and get its text',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page',
          },
          selector: {
            type: 'string',
            description: 'CSS selector to check',
          },
          expectedText: {
            type: 'string',
            description: 'Expected text content (optional)',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url', 'selector'],
      },
    },
    {
      name: 'navigate_and_wait',
      description: 'Navigate to a URL and wait for specific conditions',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to navigate to',
          },
          waitFor: {
            type: 'string',
            description: 'Wait condition: networkidle, load, domcontentloaded, selector',
            default: 'networkidle',
          },
          waitSelector: {
            type: 'string',
            description: 'CSS selector to wait for (if waitFor=selector)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds',
            default: 30000,
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'click_and_wait',
      description: 'Click an element and wait for navigation or condition',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page',
          },
          selector: {
            type: 'string',
            description: 'CSS selector to click',
          },
          waitAfter: {
            type: 'string',
            description: 'What to wait for after click: navigation, selector, timeout',
            default: 'navigation',
          },
          waitSelector: {
            type: 'string',
            description: 'Selector to wait for after click',
          },
          waitTimeout: {
            type: 'number',
            description: 'Time to wait in ms',
            default: 3000,
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url', 'selector'],
      },
    },
    {
      name: 'extract_text',
      description: 'Extract text content from page elements',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page',
          },
          selectors: {
            type: 'array',
            description: 'Array of CSS selectors to extract text from',
            items: {
              type: 'string',
            },
          },
          extractAll: {
            type: 'boolean',
            description: 'Extract all matching elements (true) or just first (false)',
            default: false,
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url', 'selectors'],
      },
    },
    {
      name: 'run_accessibility_check',
      description: 'Run accessibility checks on a webpage',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to check',
          },
          standard: {
            type: 'string',
            description: 'Accessibility standard: WCAG2A, WCAG2AA, WCAG2AAA',
            default: 'WCAG2AA',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'generate_pdf',
      description: 'Generate PDF from a webpage',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to convert to PDF',
          },
          filename: {
            type: 'string',
            description: 'Output filename',
          },
          format: {
            type: 'string',
            description: 'Page format: A4, Letter, Legal, etc.',
            default: 'Letter',
          },
          landscape: {
            type: 'boolean',
            description: 'Use landscape orientation',
            default: false,
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'monitor_network',
      description: 'Monitor network requests while loading a page',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to monitor',
          },
          filterPattern: {
            type: 'string',
            description: 'Regex pattern to filter URLs',
          },
          captureTypes: {
            type: 'array',
            description: 'Request types to capture: xhr, fetch, document, stylesheet, script, image',
            items: {
              type: 'string',
            },
            default: ['xhr', 'fetch'],
          },
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: true)',
            default: true,
          },
          sessionId: {
            type: 'string',
            description: 'Use existing session ID (optional)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'start_session',
      description: 'Start a persistent browser session that stays open between tool calls',
      inputSchema: {
        type: 'object',
        properties: {
          headless: {
            type: 'boolean',
            description: 'Run browser in headless mode (default: false for sessions)',
            default: false,
          },
          url: {
            type: 'string',
            description: 'Initial URL to navigate to (optional)',
          },
          recordScreenshots: {
            type: 'boolean',
            description: 'Capture a screenshot after each action (default: false)',
            default: false,
          },
          debugMode: {
            type: 'boolean',
            description: 'Enable debug mode to capture console logs, errors, and network activity (default: false)',
            default: false,
          },
          scenarioId: {
            type: 'string',
            description: 'Test scenario ID to associate this session with (optional)',
          },
          role: {
            type: 'string',
            description: 'Role of this session (admin, participant, observer)',
          },
          label: {
            type: 'string',
            description: 'Label for this session (e.g., P1, P2, Admin1)',
          },
        },
        required: [],
      },
    },
    {
      name: 'end_session',
      description: 'Close a persistent browser session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to close',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'list_sessions',
      description: 'List all active browser sessions',
      inputSchema: {
        type: 'object',
        properties: {
          scenarioId: {
            type: 'string',
            description: 'Filter sessions by scenario ID (optional)',
          },
          role: {
            type: 'string',
            description: 'Filter sessions by role (optional)',
          },
        },
        required: [],
      },
    },
    {
      name: 'create_test_scenario',
      description: 'Create a new test scenario for multi-participant testing',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the test scenario',
          },
          description: {
            type: 'string',
            description: 'Description of what this scenario tests',
          },
          experimentName: {
            type: 'string',
            description: 'Name of the experiment being tested',
          },
          testParameters: {
            type: 'object',
            description: 'Parameters for this test (e.g., condition, difficulty)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorizing this scenario',
          },
          initialState: {
            type: 'object',
            description: 'Initial custom state data',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_test_scenarios',
      description: 'List all active test scenarios',
      inputSchema: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Filter by tag (optional)',
          },
        },
        required: [],
      },
    },
    {
      name: 'end_test_scenario',
      description: 'End a test scenario and close all associated sessions',
      inputSchema: {
        type: 'object',
        properties: {
          scenarioId: {
            type: 'string',
            description: 'Scenario ID to end',
          },
        },
        required: ['scenarioId'],
      },
    },
    {
      name: 'get_test_scenario',
      description: 'Get detailed information about a test scenario',
      inputSchema: {
        type: 'object',
        properties: {
          scenarioId: {
            type: 'string',
            description: 'Scenario ID to query',
          },
        },
        required: ['scenarioId'],
      },
    },
    {
      name: 'update_scenario_state',
      description: 'Update the state of a test scenario',
      inputSchema: {
        type: 'object',
        properties: {
          scenarioId: {
            type: 'string',
            description: 'Scenario ID to update',
          },
          phase: {
            type: 'string',
            description: 'New phase (created, running, completed, failed)',
          },
          customData: {
            type: 'object',
            description: 'Custom state data to merge',
          },
        },
        required: ['scenarioId'],
      },
    },
    {
      name: 'get_screenshot_history',
      description: 'Get the screenshot history for a session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to get screenshot history for',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'get_session_state',
      description: 'Get current state of a browser session (URL, title, cookies, etc)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to query',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'get_page_context',
      description: 'Get detailed context about the current page including forms, buttons, links, and other interactive elements',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to analyze',
          },
          url: {
            type: 'string',
            description: 'URL to navigate to first (optional if already on page)',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'get_debug_info',
      description: 'Get debug information including console logs, errors, and network activity',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to get debug info for',
          },
          includeNetwork: {
            type: 'boolean',
            description: 'Include network requests (default: true)',
            default: true,
          },
          includeConsole: {
            type: 'boolean',
            description: 'Include console logs (default: true)',
            default: true,
          },
          includeErrors: {
            type: 'boolean',
            description: 'Include errors (default: true)',
            default: true,
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'get_dom_snapshot',
      description: 'Get a snapshot of the DOM structure',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          selector: {
            type: 'string',
            description: 'CSS selector to get DOM for (default: body)',
            default: 'body',
          },
          includeStyles: {
            type: 'boolean',
            description: 'Include computed styles (default: false)',
            default: false,
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'execute_script',
      description: 'Execute JavaScript in the page context (useful for custom debugging)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          script: {
            type: 'string',
            description: 'JavaScript code to execute',
          },
        },
        required: ['sessionId', 'script'],
      },
    },
    {
      name: 'console',
      description: 'Interactive JavaScript console - execute commands and inspect results',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          command: {
            type: 'string',
            description: 'JavaScript command to execute in console',
          },
          mode: {
            type: 'string',
            description: 'Execution mode: eval (default), inspect, watch',
            default: 'eval',
          },
        },
        required: ['sessionId', 'command'],
      },
    },
    {
      name: 'console_history',
      description: 'Get console command history for the session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          limit: {
            type: 'number',
            description: 'Number of recent commands to return (default: 20)',
            default: 20,
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'inspect_object',
      description: 'Deep inspect a JavaScript object or variable',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          expression: {
            type: 'string',
            description: 'JavaScript expression to inspect (e.g., window.localStorage, document.cookie)',
          },
          depth: {
            type: 'number',
            description: 'Maximum depth to inspect (default: 3)',
            default: 3,
          },
        },
        required: ['sessionId', 'expression'],
      },
    },
    {
      name: 'set_breakpoint',
      description: 'Set a breakpoint in JavaScript code',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          url: {
            type: 'string',
            description: 'URL pattern to match',
          },
          lineNumber: {
            type: 'number',
            description: 'Line number to break at',
          },
          condition: {
            type: 'string',
            description: 'Optional conditional expression',
          },
        },
        required: ['sessionId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle session management tools first
    if (name === 'start_session') {
      const sessionId = generateSessionId();
      const headless = args.headless !== undefined ? args.headless : false; // Default to visible for sessions
      
      // Prepare scenario info if provided
      const scenarioInfo = args.scenarioId ? {
        scenarioId: args.scenarioId,
        role: args.role || 'participant',
        label: args.label || sessionId
      } : null;
      
      const session = await getOrCreateSession(sessionId, headless, scenarioInfo);
      
      // Set screenshot recording preference
      session.recordScreenshots = args.recordScreenshots || false;
      session.debugMode = args.debugMode || false;
      
      // Setup debug listeners
      setupDebugListeners(session);
      
      // Create session-specific screenshot directory
      if (session.recordScreenshots) {
        const sessionScreenshotDir = join(SCREENSHOTS_DIR, 'sessions', sessionId);
        await fs.mkdir(sessionScreenshotDir, { recursive: true });
      }
      
      if (args.url) {
        const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
        await session.page.goto(args.url, { waitUntil: 'networkidle', timeout });
        
        // Capture initial screenshot if recording
        if (session.recordScreenshots) {
          await captureSessionScreenshot(session, sessionId, 'initial');
        }
      }
      
      let responseText = `Started session: ${sessionId}\nBrowser is ${headless ? 'headless' : 'visible'}\nScreenshot recording: ${session.recordScreenshots ? 'ON' : 'OFF'}\nDebug mode: ${session.debugMode ? 'ON (capturing console, errors, network)' : 'OFF'}`;
      
      if (scenarioInfo) {
        responseText += `\nScenario: ${scenarioInfo.scenarioId}\nRole: ${scenarioInfo.role}\nLabel: ${scenarioInfo.label}`;
      }
      
      responseText += `\n${args.url ? `Navigated to: ${args.url}` : 'Ready for commands'}\n\nUse this sessionId with other tools to interact with this browser session.`;
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    
    if (name === 'end_session') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      // Remove from scenario if part of one
      if (session.scenarioId && testScenarios.has(session.scenarioId)) {
        const scenario = testScenarios.get(session.scenarioId);
        scenario.removeSession(args.sessionId);
      }
      
      await session.context.close();
      await session.browser.close();
      persistentSessions.delete(args.sessionId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Closed session: ${args.sessionId}`,
          },
        ],
      };
    }
    
    if (name === 'list_sessions') {
      const sessions = [];
      for (const [id, session] of persistentSessions) {
        // Apply filters if provided
        if (args.scenarioId && session.scenarioId !== args.scenarioId) continue;
        if (args.role && session.role !== args.role) continue;
        
        try {
          const url = session.page.url();
          const title = await session.page.title();
          let sessionInfo = `${id}: ${url} - "${title}"`;
          
          // Add scenario info if present
          if (session.scenarioId) {
            sessionInfo += ` [Scenario: ${session.scenarioId}, Role: ${session.role}, Label: ${session.label}]`;
          }
          
          sessions.push(sessionInfo);
        } catch (e) {
          sessions.push(`${id}: (session error)`);
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: sessions.length > 0 
              ? `Active sessions:\n${sessions.join('\n')}`
              : 'No active sessions',
          },
        ],
      };
    }
    
    if (name === 'get_session_state') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      try {
        const state = {
          url: session.page.url(),
          title: await session.page.title(),
          viewport: session.page.viewportSize(),
          cookies: await session.context.cookies(),
        };
        
        let responseText = `Session State for ${args.sessionId}:\nURL: ${state.url}\nTitle: ${state.title}\nViewport: ${state.viewport.width}x${state.viewport.height}\nCookies: ${state.cookies.length} cookies set`;
        
        // Add screenshot history if recording
        if (session.recordScreenshots) {
          responseText += `\n\nScreenshot Recording: ON`;
          responseText += `\nScreenshots captured: ${session.screenshots.length}`;
          if (session.screenshots.length > 0) {
            responseText += `\nLast 5 screenshots:`;
            session.screenshots.slice(-5).forEach(shot => {
              responseText += `\n  - ${shot.filename} (${shot.action})`;
            });
          }
        } else {
          responseText += `\n\nScreenshot Recording: OFF`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting session state: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'get_screenshot_history') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      if (!session.recordScreenshots) {
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot recording is not enabled for session: ${args.sessionId}`,
            },
          ],
        };
      }
      
      const screenshotDir = join(SCREENSHOTS_DIR, 'sessions', args.sessionId);
      let responseText = `Screenshot History for ${args.sessionId}:\n`;
      responseText += `Total screenshots: ${session.screenshots.length}\n`;
      responseText += `Screenshot directory: ${screenshotDir}\n\n`;
      
      if (session.screenshots.length > 0) {
        responseText += `Screenshots (in order):\n`;
        session.screenshots.forEach((shot, idx) => {
          responseText += `${idx + 1}. ${shot.filename}\n`;
          responseText += `   Action: ${shot.action}\n`;
          responseText += `   URL: ${shot.url}\n`;
          responseText += `   Time: ${shot.timestamp}\n\n`;
        });
      } else {
        responseText += `No screenshots captured yet.`;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    
    if (name === 'get_page_context') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      try {
        // Navigate if URL provided
        if (args.url && session.page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await session.page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const context = await getPageContext(session.page);
        
        // Format the response
        let response = `Page Context for ${args.sessionId}:\n`;
        response += `URL: ${context.url}\n`;
        response += `Title: ${context.title}\n\n`;
        
        if (context.headings && context.headings.length > 0) {
          response += `Headings:\n`;
          context.headings.forEach(h => {
            response += `  ${h.level}: ${h.text}\n`;
          });
          response += '\n';
        }
        
        if (context.forms && context.forms.length > 0) {
          response += `Forms (${context.forms.length}):\n`;
          context.forms.forEach((form, idx) => {
            response += `  Form ${idx}: ${form.method} to ${form.action || '(same page)'}\n`;
            form.inputs.forEach(input => {
              response += `    - ${input.type} ${input.name || input.id || '(unnamed)'}: selector="${input.selector}"${input.required ? ' (required)' : ''}\n`;
            });
          });
          response += '\n';
        }
        
        if (context.buttons && context.buttons.length > 0) {
          response += `Buttons (${context.buttons.length}):\n`;
          context.buttons.forEach(btn => {
            response += `  - "${btn.text}" selector="${btn.selector}"${btn.disabled ? ' (disabled)' : ''}\n`;
          });
          response += '\n';
        }
        
        if (context.links && context.links.length > 0) {
          response += `Links (showing first ${context.links.length}):\n`;
          context.links.forEach(link => {
            response += `  - "${link.text}" -> ${link.href}\n`;
          });
        }
        
        return {
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Error analyzing page: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'get_debug_info') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      let responseText = `Debug Information for ${args.sessionId}:\n`;
      responseText += `Current URL: ${session.page.url()}\n\n`;
      
      // Console logs
      if (args.includeConsole !== false && session.consoleLogs.length > 0) {
        responseText += `=== Console Logs (last ${session.consoleLogs.length}) ===\n`;
        session.consoleLogs.slice(-20).forEach(log => {
          responseText += `[${log.type}] ${log.timestamp.split('T')[1].split('.')[0]}: ${log.text}\n`;
        });
        responseText += '\n';
      }
      
      // Errors
      if (args.includeErrors !== false && session.errors.length > 0) {
        responseText += `=== Errors (${session.errors.length} total) ===\n`;
        session.errors.slice(-10).forEach(error => {
          responseText += `[${error.type || 'js'}] ${error.message}\n`;
          if (error.stack) {
            responseText += `  Stack: ${error.stack.split('\n')[0]}\n`;
          }
        });
        responseText += '\n';
      }
      
      // Network requests
      if (args.includeNetwork !== false && session.debugMode && session.networkRequests.length > 0) {
        responseText += `=== Recent Network Activity ===\n`;
        const recentRequests = session.networkRequests.slice(-20);
        const failedRequests = recentRequests.filter(r => r.status >= 400);
        
        if (failedRequests.length > 0) {
          responseText += `Failed requests:\n`;
          failedRequests.forEach(req => {
            responseText += `  ${req.status} ${req.method} ${req.url}\n`;
          });
        }
        
        responseText += `\nTotal requests: ${session.networkRequests.length}\n`;
        responseText += `Recent: ${recentRequests.filter(r => r.status < 400).length} successful, ${failedRequests.length} failed\n`;
      }
      
      if (!session.debugMode) {
        responseText += '\nNote: Debug mode is OFF. Enable it when starting session to capture network activity.\n';
      }
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    
    if (name === 'get_dom_snapshot') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      try {
        const selector = args.selector || 'body';
        const includeStyles = args.includeStyles || false;
        
        const domSnapshot = await session.page.evaluate(({sel, styles}) => {
          const element = document.querySelector(sel);
          if (!element) return null;
          
          function extractDOM(el, depth = 0, maxDepth = 5) {
            if (depth > maxDepth) return { tag: '...truncated...' };
            
            const result = {
              tag: el.tagName.toLowerCase(),
              id: el.id || undefined,
              classes: el.className ? el.className.split(' ').filter(c => c) : undefined,
              text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 
                ? el.childNodes[0].textContent.trim().substring(0, 100) 
                : undefined,
              attributes: {}
            };
            
            // Get key attributes
            ['href', 'src', 'type', 'name', 'value', 'placeholder'].forEach(attr => {
              if (el.hasAttribute(attr)) {
                result.attributes[attr] = el.getAttribute(attr);
              }
            });
            
            if (styles && depth < 3) {
              const computed = window.getComputedStyle(el);
              result.styles = {
                display: computed.display,
                position: computed.position,
                visibility: computed.visibility,
                opacity: computed.opacity
              };
            }
            
            // Get children
            if (el.children.length > 0 && depth < maxDepth) {
              result.children = Array.from(el.children)
                .slice(0, 10) // Limit children
                .map(child => extractDOM(child, depth + 1, maxDepth));
            }
            
            return result;
          }
          
          return extractDOM(element);
        }, { sel: selector, styles: includeStyles });
        
        if (!domSnapshot) {
          return {
            content: [
              {
                type: 'text',
                text: `Element not found: ${selector}`,
              },
            ],
          };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `DOM Snapshot for ${selector}:\n${JSON.stringify(domSnapshot, null, 2)}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting DOM snapshot: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'execute_script') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      try {
        const result = await session.page.evaluate(args.script);
        
        return {
          content: [
            {
              type: 'text',
              text: `Script executed successfully.\nResult: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Script execution failed: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'console') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      const command = args.command;
      const mode = args.mode || 'eval';
      
      // Add to history
      session.consoleHistory.push({
        command,
        timestamp: new Date().toISOString(),
        url: session.page.url()
      });
      
      // Keep only last 100 commands
      if (session.consoleHistory.length > 100) {
        session.consoleHistory.shift();
      }
      
      try {
        let result;
        
        if (mode === 'eval') {
          // Standard evaluation
          result = await session.page.evaluate((cmd) => {
            try {
              const result = eval(cmd);
              
              // Enhanced serialization for common objects
              if (result === undefined) return 'undefined';
              if (result === null) return 'null';
              if (typeof result === 'function') return `[Function: ${result.name || 'anonymous'}]`;
              if (result instanceof Error) return `Error: ${result.message}\n${result.stack}`;
              if (result instanceof HTMLElement) return `<${result.tagName.toLowerCase()} id="${result.id}" class="${result.className}">`;
              if (result instanceof NodeList) return `NodeList[${result.length}]`;
              if (result instanceof Window) return '[Window object]';
              if (result instanceof Document) return '[Document object]';
              
              return result;
            } catch (e) {
              return `Error: ${e.message}`;
            }
          }, command);
        } else if (mode === 'inspect') {
          // Deep inspection mode
          result = await session.page.evaluate((cmd) => {
            try {
              const obj = eval(cmd);
              
              function inspect(o, depth = 0, maxDepth = 3, seen = new Set()) {
                if (depth > maxDepth) return '...';
                if (seen.has(o)) return '[Circular]';
                
                if (o === null) return 'null';
                if (o === undefined) return 'undefined';
                if (typeof o !== 'object') return o;
                
                seen.add(o);
                
                if (Array.isArray(o)) {
                  return o.map(item => inspect(item, depth + 1, maxDepth, seen));
                }
                
                const result = {};
                for (let key in o) {
                  try {
                    result[key] = inspect(o[key], depth + 1, maxDepth, seen);
                  } catch (e) {
                    result[key] = `[Error: ${e.message}]`;
                  }
                }
                return result;
              }
              
              return inspect(obj);
            } catch (e) {
              return `Error: ${e.message}`;
            }
          }, command);
        } else if (mode === 'watch') {
          // Add to watched expressions
          session.watchedExpressions.set(command, true);
          
          result = await session.page.evaluate((cmd) => {
            try {
              return eval(cmd);
            } catch (e) {
              return `Error: ${e.message}`;
            }
          }, command);
          
          result = `Added to watch: ${command}\nCurrent value: ${JSON.stringify(result)}`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `> ${command}\n${typeof result === 'object' ? JSON.stringify(result, null, 2) : result}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Console error: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'console_history') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      const limit = args.limit || 20;
      const history = session.consoleHistory.slice(-limit);
      
      if (history.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No console history for session ${args.sessionId}`,
            },
          ],
        };
      }
      
      let responseText = `Console History (last ${history.length} commands):\n\n`;
      history.forEach((entry, idx) => {
        responseText += `${idx + 1}. [${entry.timestamp.split('T')[1].split('.')[0]}] ${entry.command}\n`;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    
    if (name === 'inspect_object') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      const depth = args.depth || 3;
      
      try {
        const result = await session.page.evaluate(({expr, maxDepth}) => {
          try {
            const obj = eval(expr);
            
            function deepInspect(o, depth = 0, seen = new WeakSet()) {
              if (depth > maxDepth) return '...depth limit...';
              
              if (o === null) return null;
              if (o === undefined) return undefined;
              
              const type = typeof o;
              
              if (type !== 'object' && type !== 'function') {
                return o;
              }
              
              if (seen.has(o)) return '[Circular Reference]';
              seen.add(o);
              
              // Special handling for common types
              if (o instanceof Date) return o.toISOString();
              if (o instanceof RegExp) return o.toString();
              if (o instanceof Error) return { name: o.name, message: o.message, stack: o.stack };
              if (o instanceof HTMLElement) {
                return {
                  tagName: o.tagName,
                  id: o.id,
                  className: o.className,
                  innerHTML: o.innerHTML.substring(0, 200),
                  attributes: Array.from(o.attributes).map(a => ({name: a.name, value: a.value}))
                };
              }
              
              if (Array.isArray(o)) {
                return o.map(item => deepInspect(item, depth + 1, seen));
              }
              
              // For objects and functions
              const result = {
                __type: type === 'function' ? `Function: ${o.name || 'anonymous'}` : o.constructor.name
              };
              
              // Get own properties
              const props = Object.getOwnPropertyNames(o);
              for (const prop of props.slice(0, 100)) { // Limit properties
                try {
                  const descriptor = Object.getOwnPropertyDescriptor(o, prop);
                  if (descriptor.get) {
                    result[prop] = '[Getter]';
                  } else if (descriptor.set) {
                    result[prop] = '[Setter]';
                  } else {
                    result[prop] = deepInspect(descriptor.value, depth + 1, seen);
                  }
                } catch (e) {
                  result[prop] = `[Error: ${e.message}]`;
                }
              }
              
              // Get prototype if interesting
              if (depth < 2 && o.constructor && o.constructor.name !== 'Object') {
                const proto = Object.getPrototypeOf(o);
                if (proto && proto !== Object.prototype) {
                  result.__proto__ = {
                    constructor: proto.constructor.name,
                    methods: Object.getOwnPropertyNames(proto).filter(p => typeof proto[p] === 'function')
                  };
                }
              }
              
              return result;
            }
            
            return deepInspect(obj);
          } catch (e) {
            return { error: e.message, stack: e.stack };
          }
        }, { expr: args.expression, maxDepth: depth });
        
        return {
          content: [
            {
              type: 'text',
              text: `Inspecting: ${args.expression}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Inspection failed: ${e.message}`,
            },
          ],
        };
      }
    }
    
    if (name === 'set_breakpoint') {
      const session = persistentSessions.get(args.sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: `Session not found: ${args.sessionId}`,
            },
          ],
        };
      }
      
      try {
        // Enable Chrome DevTools Protocol for debugging
        const client = await session.page.context().newCDPSession(session.page);
        await client.send('Debugger.enable');
        
        if (args.url && args.lineNumber) {
          // Set breakpoint by URL and line
          const response = await client.send('Debugger.setBreakpointByUrl', {
            lineNumber: args.lineNumber - 1, // CDP uses 0-based line numbers
            url: args.url,
            condition: args.condition
          });
          
          return {
            content: [
              {
                type: 'text',
                text: `Breakpoint set at ${args.url}:${args.lineNumber}\nBreakpoint ID: ${response.breakpointId}`,
              },
            ],
          };
        } else {
          // Pause execution now
          await client.send('Debugger.pause');
          
          return {
            content: [
              {
                type: 'text',
                text: `Debugger paused. Use browser DevTools to inspect.`,
              },
            ],
          };
        }
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to set breakpoint: ${e.message}`,
            },
          ],
        };
      }
    }
    
    // Handle test scenario management tools
    if (name === 'create_test_scenario') {
      const scenarioId = generateScenarioId();
      const scenario = new TestScenario(scenarioId, {
        name: args.name,
        description: args.description,
        experimentName: args.experimentName,
        testParameters: args.testParameters,
        tags: args.tags,
        initialState: args.initialState
      });
      
      testScenarios.set(scenarioId, scenario);
      
      return {
        content: [
          {
            type: 'text',
            text: `Created test scenario: ${scenarioId}\nName: ${scenario.metadata.name}\n${scenario.metadata.description ? `Description: ${scenario.metadata.description}\n` : ''}${scenario.metadata.experimentName ? `Experiment: ${scenario.metadata.experimentName}\n` : ''}${scenario.metadata.tags?.length ? `Tags: ${scenario.metadata.tags.join(', ')}\n` : ''}\nUse this scenarioId when starting sessions to group them together.`,
          },
        ],
      };
    }
    
    if (name === 'list_test_scenarios') {
      const scenarios = [];
      for (const [id, scenario] of testScenarios) {
        // Apply tag filter if provided
        if (args.tag && !scenario.metadata.tags?.includes(args.tag)) continue;
        
        scenarios.push(`${id}: ${scenario.metadata.name} (${scenario.sessions.size} sessions, phase: ${scenario.state.phase})`);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: scenarios.length > 0 
              ? `Active test scenarios:\n${scenarios.join('\n')}`
              : 'No active test scenarios',
          },
        ],
      };
    }
    
    if (name === 'get_test_scenario') {
      const scenario = testScenarios.get(args.scenarioId);
      if (!scenario) {
        return {
          content: [
            {
              type: 'text',
              text: `Scenario not found: ${args.scenarioId}`,
            },
          ],
        };
      }
      
      const summary = scenario.getSummary();
      let responseText = `Test Scenario: ${summary.scenarioId}\n`;
      responseText += `Name: ${summary.metadata.name}\n`;
      responseText += `Created: ${summary.createdAt}\n`;
      responseText += `Phase: ${summary.state.phase}\n`;
      
      if (summary.metadata.description) {
        responseText += `Description: ${summary.metadata.description}\n`;
      }
      
      if (summary.metadata.experimentName) {
        responseText += `Experiment: ${summary.metadata.experimentName}\n`;
      }
      
      if (summary.metadata.testParameters && Object.keys(summary.metadata.testParameters).length > 0) {
        responseText += `Parameters: ${JSON.stringify(summary.metadata.testParameters, null, 2)}\n`;
      }
      
      if (summary.state.customData && Object.keys(summary.state.customData).length > 0) {
        responseText += `Custom State: ${JSON.stringify(summary.state.customData, null, 2)}\n`;
      }
      
      responseText += `\nSessions (${summary.sessionCount}):\n`;
      if (summary.sessions.length > 0) {
        summary.sessions.forEach(s => {
          responseText += `  - ${s.sessionId} [${s.label}]: Role=${s.role}, Status=${s.status}, Joined=${s.joinedAt}\n`;
        });
      } else {
        responseText += `  No sessions attached\n`;
      }
      
      responseText += `\nEvent History: ${summary.eventCount} events recorded`;
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    
    if (name === 'update_scenario_state') {
      const scenario = testScenarios.get(args.scenarioId);
      if (!scenario) {
        return {
          content: [
            {
              type: 'text',
              text: `Scenario not found: ${args.scenarioId}`,
            },
          ],
        };
      }
      
      scenario.updateState({
        phase: args.phase,
        customData: args.customData
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Updated scenario ${args.scenarioId}\n${args.phase ? `Phase: ${args.phase}\n` : ''}${args.customData ? `Custom data updated: ${JSON.stringify(args.customData)}\n` : ''}`,
          },
        ],
      };
    }
    
    if (name === 'end_test_scenario') {
      const scenario = testScenarios.get(args.scenarioId);
      if (!scenario) {
        return {
          content: [
            {
              type: 'text',
              text: `Scenario not found: ${args.scenarioId}`,
            },
          ],
        };
      }
      
      // Close all sessions associated with this scenario
      const sessionIds = Array.from(scenario.sessions.keys());
      let closedCount = 0;
      
      for (const sessionId of sessionIds) {
        const session = persistentSessions.get(sessionId);
        if (session) {
          await session.context.close();
          await session.browser.close();
          persistentSessions.delete(sessionId);
          closedCount++;
        }
      }
      
      // Update scenario state
      scenario.updateState({ phase: 'completed' });
      
      // Remove scenario
      testScenarios.delete(args.scenarioId);
      
      return {
        content: [
          {
            type: 'text',
            text: `Ended test scenario: ${args.scenarioId}\nClosed ${closedCount} sessions\nScenario data has been preserved for analysis`,
          },
        ],
      };
    }
    
    // For other tools, check if sessionId is provided
    let browser, context, page;
    let shouldCloseContext = true; // Flag to determine if we should close context after operation
    
    if (args.sessionId && persistentSessions.has(args.sessionId)) {
      // Use existing session
      const session = persistentSessions.get(args.sessionId);
      browser = session.browser;
      context = session.context;
      page = session.page;
      shouldCloseContext = false; // Don't close persistent sessions
    } else {
      // Create temporary browser/context/page for this operation
      const headless = args.headless !== false;
      browser = await getBrowser(headless);
      
      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Playwright MCP Testing)',
      });
      page = await context.newPage();
    }

    switch (name) {
      case 'screenshot': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = args.filename || `screenshot-${timestamp}.png`;
        const filepath = join(SCREENSHOTS_DIR, filename);
        
        const screenshotOptions = {
          path: filepath,
          fullPage: args.fullPage !== false,
        };
        
        if (args.selector) {
          const element = await page.locator(args.selector).first();
          await element.screenshot({ path: filepath });
        } else {
          await page.screenshot(screenshotOptions);
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot saved to: ${filename}`,
            },
          ],
        };
      }

      case 'test_login': {
        const username = args.username || process.env.TEST_USER;
        const password = args.password || process.env.TEST_PASS;
        
        if (!username || !password) {
          throw new Error('Username and password required (set TEST_USER and TEST_PASS in .env)');
        }
        
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        // Try multiple selectors for better compatibility
        const usernameSelectors = args.usernameSelector.split(',').map(s => s.trim());
        const passwordSelectors = args.passwordSelector.split(',').map(s => s.trim());
        
        // Find and fill username field
        let usernameFilled = false;
        for (const selector of usernameSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            await page.fill(selector, username);
            usernameFilled = true;
            break;
          } catch (e) {
            // Try next selector
          }
        }
        if (!usernameFilled) {
          throw new Error(`Could not find username field with selectors: ${args.usernameSelector}`);
        }
        
        // Find and fill password field
        let passwordFilled = false;
        for (const selector of passwordSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            await page.fill(selector, password);
            passwordFilled = true;
            break;
          } catch (e) {
            // Try next selector
          }
        }
        if (!passwordFilled) {
          throw new Error(`Could not find password field with selectors: ${args.passwordSelector}`);
        }
        
        // Take pre-login screenshot
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, 'pre-login.png') 
        });
        
        // Try multiple submit selectors
        const submitSelectors = args.submitSelector.split(',').map(s => s.trim());
        let submitted = false;
        for (const selector of submitSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            await page.click(selector);
            submitted = true;
            break;
          } catch (e) {
            // Try next selector
          }
        }
        if (!submitted) {
          throw new Error(`Could not find submit button with selectors: ${args.submitSelector}`);
        }
        
        // Wait for navigation or login to complete
        await page.waitForLoadState('networkidle');
        
        // Take post-login screenshot
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, 'post-login.png') 
        });
        
        // Check if login was successful (basic check)
        const url = page.url();
        const title = await page.title();
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Login test completed.\nURL: ${url}\nPage Title: ${title}\nScreenshots saved: pre-login.png, post-login.png`,
            },
          ],
        };
      }

      case 'fill_form': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        // Fill each form field
        for (const [selector, value] of Object.entries(args.formData)) {
          await page.fill(selector, String(value));
        }
        
        // Submit if selector provided
        if (args.submitSelector) {
          await page.click(args.submitSelector);
          await page.waitForLoadState('networkidle');
        }
        
        // Take screenshot of filled form
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, `form-${timestamp}.png`) 
        });
        
        // Capture screenshot if recording
        if (args.sessionId) {
          const session = persistentSessions.get(args.sessionId);
          if (session && session.recordScreenshots) {
            await captureSessionScreenshot(session, args.sessionId, 'form-filled');
          }
        }
        
        // Get context after form submission for persistent sessions
        let responseText = `Form filled successfully. Screenshot saved.`;
        
        if (args.sessionId) {
          try {
            const session = persistentSessions.get(args.sessionId);
            const context = await getPageContext(page);
            responseText += `\n\nCurrent page: ${page.url()}`;
            responseText += `\nPage title: ${context.title}`;
            
            // Add summary of what's available now
            if (context.buttons && context.buttons.length > 0) {
              responseText += `\n\nAvailable buttons: ${context.buttons.slice(0, 5).map(b => `"${b.text}"`).join(', ')}`;
            }
            if (context.forms && context.forms.length > 0) {
              responseText += `\n${context.forms.length} form(s) available`;
            }
            
            // Add screenshot info if recording
            if (session && session.recordScreenshots) {
              responseText += `\n\nScreenshot captured (${session.screenshots.length} total)`;
            }
            
            responseText += '\n\nUse get_page_context to see all interactive elements.';
          } catch (e) {
            // Ignore context errors
          }
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      case 'check_element': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const element = await page.locator(args.selector).first();
        const exists = await element.count() > 0;
        
        if (!exists) {
          if (shouldCloseContext) await context.close();
          return {
            content: [
              {
                type: 'text',
                text: `Element not found: ${args.selector}`,
              },
            ],
          };
        }
        
        const text = await element.textContent();
        const isVisible = await element.isVisible();
        
        let result = `Element found: ${args.selector}\nVisible: ${isVisible}\nText: ${text}`;
        
        if (args.expectedText) {
          const matches = text?.includes(args.expectedText);
          result += `\nExpected text match: ${matches}`;
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'navigate_and_wait': {
        // Always navigate for this tool as it's its primary purpose
        const timeout = args.timeout || parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
        await page.goto(args.url, { timeout });
        
        if (args.waitFor === 'selector' && args.waitSelector) {
          await page.waitForSelector(args.waitSelector, { timeout: args.timeout || 30000 });
        } else if (args.waitFor !== 'selector') {
          await page.waitForLoadState(args.waitFor || 'networkidle');
        }
        
        const title = await page.title();
        const url = page.url();
        
        // Capture screenshot if recording
        if (args.sessionId) {
          const session = persistentSessions.get(args.sessionId);
          if (session && session.recordScreenshots) {
            await captureSessionScreenshot(session, args.sessionId, 'navigate');
          }
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Navigated to: ${url}\nPage title: ${title}`,
            },
          ],
        };
      }

      case 'click_and_wait': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const element = await page.locator(args.selector).first();
        await element.click();
        
        if (args.waitAfter === 'navigation') {
          await page.waitForLoadState('networkidle');
        } else if (args.waitAfter === 'selector' && args.waitSelector) {
          await page.waitForSelector(args.waitSelector);
        } else if (args.waitAfter === 'timeout') {
          await page.waitForTimeout(args.waitTimeout || 3000);
        }
        
        // Capture screenshot if recording
        if (args.sessionId) {
          const session = persistentSessions.get(args.sessionId);
          if (session && session.recordScreenshots) {
            await captureSessionScreenshot(session, args.sessionId, `click-${args.selector.substring(0, 20)}`);
          }
        }
        
        // Get context after click for persistent sessions
        let responseText = `Clicked: ${args.selector}\nNew URL: ${page.url()}`;
        
        if (args.sessionId) {
          try {
            const session = persistentSessions.get(args.sessionId);
            const context = await getPageContext(page);
            responseText += `\nPage title: ${context.title}`;
            
            // Add summary of available actions
            if (context.buttons && context.buttons.length > 0) {
              responseText += `\n\nAvailable buttons: ${context.buttons.slice(0, 5).map(b => `"${b.text}"`).join(', ')}`;
            }
            if (context.forms && context.forms.length > 0) {
              responseText += `\n${context.forms.length} form(s) available`;
            }
            if (context.links && context.links.length > 0) {
              responseText += `\n${context.links.length} links available`;
            }
            
            // Add screenshot info if recording
            if (session && session.recordScreenshots) {
              responseText += `\n\nScreenshot captured (${session.screenshots.length} total)`;
            }
            
            responseText += '\n\nUse get_page_context to see all interactive elements.';
          } catch (e) {
            // Ignore context errors
          }
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      case 'extract_text': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const results = {};
        
        for (const selector of args.selectors) {
          if (args.extractAll) {
            const elements = await page.locator(selector).all();
            results[selector] = [];
            for (const el of elements) {
              results[selector].push(await el.textContent());
            }
          } else {
            const element = await page.locator(selector).first();
            results[selector] = await element.textContent();
          }
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'run_accessibility_check': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        // Take screenshot for visual reference
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, `a11y-${timestamp}.png`),
          fullPage: true
        });
        
        // Basic accessibility checks
        const checks = {
          hasTitle: !!(await page.title()),
          hasLang: await page.evaluate(() => !!document.documentElement.lang),
          hasViewport: await page.evaluate(() => !!document.querySelector('meta[name="viewport"]')),
          imagesWithAlt: await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            const total = images.length;
            const withAlt = images.filter(img => img.alt).length;
            return { total, withAlt, percentage: total > 0 ? (withAlt/total*100).toFixed(2) : 100 };
          }),
          headingStructure: await page.evaluate(() => {
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
            return headings.map(h => ({ level: h.tagName, text: h.textContent.substring(0, 50) }));
          }),
        };
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Accessibility Check Results:\n${JSON.stringify(checks, null, 2)}\n\nScreenshot saved: a11y-${timestamp}.png`,
            },
          ],
        };
      }

      case 'generate_pdf': {
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = args.filename || `document-${timestamp}.pdf`;
        const pdfPath = join(SCREENSHOTS_DIR, filename);
        
        await page.pdf({
          path: pdfPath,
          format: args.format || 'Letter',
          landscape: args.landscape || false,
          printBackground: true,
        });
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `PDF generated: ${filename}`,
            },
          ],
        };
      }

      case 'monitor_network': {
        const requests = [];
        
        page.on('request', request => {
          const url = request.url();
          const type = request.resourceType();
          
          if (args.captureTypes && !args.captureTypes.includes(type)) {
            return;
          }
          
          if (args.filterPattern && !new RegExp(args.filterPattern).test(url)) {
            return;
          }
          
          requests.push({
            url,
            method: request.method(),
            type,
            timestamp: new Date().toISOString(),
          });
        });
        
        // Only navigate if URL is different from current page
        if (!args.sessionId || page.url() !== args.url) {
          const timeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 30000;
          await page.goto(args.url, { waitUntil: 'networkidle', timeout });
        }
        
        if (shouldCloseContext) await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Network Requests Captured (${requests.length} total):\n${JSON.stringify(requests, null, 2)}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  // Close all persistent sessions
  for (const [sessionId, session] of persistentSessions) {
    try {
      await session.context.close();
      await session.browser.close();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  persistentSessions.clear();
  
  if (headlessBrowser) {
    await headlessBrowser.close();
  }
  if (headedBrowser) {
    await headedBrowser.close();
  }
  process.exit(0);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Playwright MCP Server running on stdio');
