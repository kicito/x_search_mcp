import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const entrypoint = fileURLToPath(new URL(`../${manifest.bin['xai-search-mcp']}`, import.meta.url));

test('CLI stdio initializes and lists tools using the manifest bin and version, without network', { timeout: 10000 }, async (t) => {
  const client = new Client({ name: 'stdio-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint],
    env: { XAI_API_KEY: 'fake-offline-key', XAI_MODEL: 'offline-model', XAI_TIMEOUT_MS: '100' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => { await client.close(); await transport.close(); });
  await client.connect(transport);
  assert.deepEqual(client.getServerVersion(), { name: 'xai-search', version: manifest.version });
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ['web_search', 'x_search']);
  assert.doesNotMatch(stderr, /fake-offline-key/);
});

test('CLI rejects invalid startup configuration without protocol output', { timeout: 10000 }, async () => {
  for (const env of [{ XAI_API_KEY: 'fake-offline-key', XAI_TIMEOUT_MS: '0' }, {}]) {
    const child = spawn(process.execPath, [entrypoint], { env: { ...getDefaultEnvironment(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, env.XAI_API_KEY ? /XAI_TIMEOUT_MS/ : /XAI_API_KEY/);
    assert.doesNotMatch(stderr, /fake-offline-key/);
  }
});
