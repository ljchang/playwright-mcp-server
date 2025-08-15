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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');

// Ensure screenshots directory exists
await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

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
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Use headless parameter from args, defaulting to true if not specified
    const headless = args.headless !== false;
    const browser = await getBrowser(headless);
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Playwright MCP Testing)',
    });
    const page = await context.newPage();

    switch (name) {
      case 'screenshot': {
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
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
        
        await context.close();
        
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
        
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
        // Fill login form
        await page.fill(args.usernameSelector, username);
        await page.fill(args.passwordSelector, password);
        
        // Take pre-login screenshot
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, 'pre-login.png') 
        });
        
        // Submit form
        await page.click(args.submitSelector);
        
        // Wait for navigation or login to complete
        await page.waitForLoadState('networkidle');
        
        // Take post-login screenshot
        await page.screenshot({ 
          path: join(SCREENSHOTS_DIR, 'post-login.png') 
        });
        
        // Check if login was successful (basic check)
        const url = page.url();
        const title = await page.title();
        
        await context.close();
        
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
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
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
        
        await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Form filled successfully. Screenshot saved.`,
            },
          ],
        };
      }

      case 'check_element': {
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
        const element = await page.locator(args.selector).first();
        const exists = await element.count() > 0;
        
        if (!exists) {
          await context.close();
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
        
        await context.close();
        
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
        await page.goto(args.url, { timeout: args.timeout || 30000 });
        
        if (args.waitFor === 'selector' && args.waitSelector) {
          await page.waitForSelector(args.waitSelector, { timeout: args.timeout || 30000 });
        } else if (args.waitFor !== 'selector') {
          await page.waitForLoadState(args.waitFor || 'networkidle');
        }
        
        const title = await page.title();
        const url = page.url();
        
        await context.close();
        
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
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
        const element = await page.locator(args.selector).first();
        await element.click();
        
        if (args.waitAfter === 'navigation') {
          await page.waitForLoadState('networkidle');
        } else if (args.waitAfter === 'selector' && args.waitSelector) {
          await page.waitForSelector(args.waitSelector);
        } else if (args.waitAfter === 'timeout') {
          await page.waitForTimeout(args.waitTimeout || 3000);
        }
        
        const newUrl = page.url();
        
        await context.close();
        
        return {
          content: [
            {
              type: 'text',
              text: `Clicked: ${args.selector}\nNew URL: ${newUrl}`,
            },
          ],
        };
      }

      case 'extract_text': {
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
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
        
        await context.close();
        
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
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
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
        
        await context.close();
        
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
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = args.filename || `document-${timestamp}.pdf`;
        const pdfPath = join(SCREENSHOTS_DIR, filename);
        
        await page.pdf({
          path: pdfPath,
          format: args.format || 'Letter',
          landscape: args.landscape || false,
          printBackground: true,
        });
        
        await context.close();
        
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
        
        await page.goto(args.url, { waitUntil: 'networkidle' });
        
        await context.close();
        
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
