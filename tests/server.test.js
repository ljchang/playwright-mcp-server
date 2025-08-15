import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'index.js');

test('MCP server starts successfully', async (t) => {
  const server = spawn('node', [serverPath], {
    env: { ...process.env, HEADLESS: 'true' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await new Promise((resolve) => {
    server.stderr.once('data', (data) => {
      const output = data.toString();
      assert(output.includes('Playwright MCP Server running'), 'Server should start');
      resolve();
    });
  });

  server.kill();
});

test('Server handles tools/list request', async (t) => {
  const server = spawn('node', [serverPath], {
    env: { ...process.env, HEADLESS: 'true' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await new Promise((resolve) => {
    server.stderr.once('data', resolve);
  });

  // Send tools/list request
  const request = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 1
  });

  server.stdin.write(request + '\n');

  await new Promise((resolve, reject) => {
    let buffer = '';
    
    const onData = (data) => {
      buffer += data.toString();
      
      // Try to parse the buffer as complete JSON
      try {
        const response = JSON.parse(buffer);
        
        // Clean up listener
        server.stdout.removeListener('data', onData);
        
        assert(response.result, 'Should have result');
        assert(Array.isArray(response.result.tools), 'Should return tools array');
        assert(response.result.tools.length > 0, 'Should have tools');
        
        // Check for specific tools
        const toolNames = response.result.tools.map(t => t.name);
        assert(toolNames.includes('screenshot'), 'Should have screenshot tool');
        assert(toolNames.includes('test_login'), 'Should have test_login tool');
        assert(toolNames.includes('run_accessibility_check'), 'Should have accessibility check tool');
        
        resolve();
      } catch (e) {
        // Not complete JSON yet, wait for more data
        if (!e.message.includes('JSON')) {
          reject(e);
        }
      }
    };
    
    server.stdout.on('data', onData);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      server.stdout.removeListener('data', onData);
      reject(new Error('Timeout waiting for response'));
    }, 5000);
  });

  server.kill();
});