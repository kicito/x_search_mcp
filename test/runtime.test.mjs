import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { callXaiApi, createServer, loadConfig } from '../build/server.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const secret = 'fake-secret-that-must-not-appear-in-errors';
const answer = (text = 'Answer') => ({
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
});
const json = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const config = (fetch, timeoutMs = 1000) => ({ apiKey: secret, model: 'test-model', timeoutMs, fetch });

async function session(t, fetch, timeoutMs) {
  const server = createServer(config(fetch, timeoutMs));
  const client = new Client({ name: 'offline-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const responses = [];
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message, options) => {
    responses.push(message);
    return send(message, options);
  };
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, responses };
}

const textOf = (result) => result.content.map((part) => part.text ?? '').join('\n');

test('initialization, tool schemas and manifest version cross the MCP boundary', async (t) => {
  const { client } = await session(t, async () => { throw new Error('No network expected'); });
  assert.deepEqual(client.getServerVersion(), { name: 'xai-search', version: manifest.version });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['web_search', 'x_search']);
  const arraySchema = (schema) => schema.type === 'array' ? schema : schema.anyOf.find((part) => part.type === 'array');
  assert.equal(arraySchema(tools[0].inputSchema.properties.allowed_domains).maxItems, 5);
  assert.equal(arraySchema(tools[1].inputSchema.properties.allowed_x_handles).maxItems, 10);
  assert.match(tools[1].inputSchema.properties.to_date.description, /exclusive/i);
});

test('web wire payload normalizes query/domains, uses nested filters and bearer auth', async (t) => {
  const calls = [];
  const { client } = await session(t, async (url, options) => {
    calls.push({ url, options });
    return json(answer());
  });
  const result = await client.callTool({ name: 'web_search', arguments: {
    query: '  useful query  ', allowed_domains: [' Example.COM ', 'news.example.org'], excluded_domains: [],
  } });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.x.ai/v1/responses');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'test-model', input: [{ role: 'user', content: 'useful query' }],
    tools: [{ type: 'web_search', filters: { allowed_domains: ['example.com', 'news.example.org'] } }],
  });
});

test('X wire payload uses top-level normalized handles and exact dates', async (t) => {
  let body;
  const { client } = await session(t, async (_url, options) => {
    body = JSON.parse(options.body);
    return json(answer());
  });
  await client.callTool({ name: 'x_search', arguments: {
    query: ' q ', allowed_x_handles: [], excluded_x_handles: [' @Example_1 '],
    from_date: '2024-02-29', to_date: '2024-03-01',
  } });
  assert.deepEqual(body.tools, [{ type: 'x_search', excluded_x_handles: ['Example_1'],
    from_date: '2024-02-29', to_date: '2024-03-01' }]);
  assert.equal(body.input[0].content, 'q');
});

test('empty and null filters/dates are absent and do not conflict', async (t) => {
  const bodies = [];
  const { client } = await session(t, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return json(answer());
  });
  await client.callTool({ name: 'web_search', arguments: {
    query: 'q', allowed_domains: [], excluded_domains: [],
  } });
  await client.callTool({ name: 'web_search', arguments: {
    query: 'q', allowed_domains: [], excluded_domains: [' example.com '],
  } });
  await client.callTool({ name: 'x_search', arguments: {
    query: 'q', allowed_x_handles: [], excluded_x_handles: null, from_date: null, to_date: null,
  } });
  assert.deepEqual(bodies.map((body) => body.tools[0]), [
    { type: 'web_search' }, { type: 'web_search', filters: { excluded_domains: ['example.com'] } },
    { type: 'x_search' },
  ]);
});

test('only assistant output_text is used and URL citations remain deduplicated', async (t) => {
  const data = answer('First');
  data.output.unshift({ type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] });
  data.output.unshift({ type: 'message', role: 'user', content: [{ type: 'output_text', text: 'untrusted' }] });
  data.output.at(-1).content.push({ type: 'output_text', text: ' second', annotations: [
    { type: 'url_citation', url: 'https://example.com/a' },
    { type: 'url_citation', url: 'https://example.com/a' },
    { type: 'url_citation', url: 'https://example.org/b' },
  ] });
  const { client } = await session(t, async () => json(data));
  const result = await client.callTool({ name: 'web_search', arguments: { query: 'q' } });
  assert.equal(textOf(result), 'First second\n\n---\nSources:\n[1] https://example.com/a\n[2] https://example.org/b');
});

test('invalid inputs fail before upstream work', async (t) => {
  let calls = 0;
  const { client } = await session(t, async () => { calls++; return json(answer()); });
  const cases = [
    ['web_search', { query: '   ' }],
    ['x_search', { query: '\n\t' }],
    ['web_search', { query: null }],
    ['x_search', {}],
    ...['https://example.com', 'example.com/path', '*.example.com', 'foo..com', '-bad.com', 'a b.com', 'example.com:443', ''].map((domain) =>
      ['web_search', { query: 'q', allowed_domains: [domain] }]),
    ...['@@user', 'bad-name', 'user/name', '', 'a'.repeat(16)].map((handle) =>
      ['x_search', { query: 'q', allowed_x_handles: [handle] }]),
    ['web_search', { query: 'q', allowed_domains: ['a.com'], excluded_domains: ['b.com'] }],
    ['x_search', { query: 'q', allowed_x_handles: ['a'], excluded_x_handles: ['b'] }],
    ['web_search', { query: 'q', allowed_domains: Array(6).fill('a.com') }],
    ['x_search', { query: 'q', allowed_x_handles: Array(11).fill('a') }],
    ...['2023-02-29', '1900-02-29', '2024-04-31', '2024-00-10', '2024-13-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', ' 2024-01-01 ', ''].map((date) =>
      ['x_search', { query: 'q', from_date: date }]),
    ['x_search', { query: 'q', from_date: '2024-03-02', to_date: '2024-03-01' }],
  ];
  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, JSON.stringify({ name, args, result }));
  }
  assert.equal(calls, 0);
});

test('calendar leap centuries and equal date bounds are accepted; long queries are not arbitrarily capped', async (t) => {
  let calls = 0;
  const { client } = await session(t, async () => { calls++; return json(answer()); });
  const result = await client.callTool({ name: 'x_search', arguments: {
    query: 'q'.repeat(20000), from_date: '2000-02-29', to_date: '2000-02-29',
  } });
  assert.equal(result.isError, undefined);
  assert.equal(calls, 1);
});

test('upstream failure, refusal, malformed and empty results are safe MCP errors', async (t) => {
  const cases = [
    ['HTTP error', () => new Response(secret, { status: 401 }), /HTTP 401/],
    ['HTTP server error', () => new Response(JSON.stringify({ error: secret }), { status: 503 }), /HTTP 503/],
    ['invalid JSON', () => new Response(`not JSON ${secret}`), /invalid JSON/],
    ['empty body', () => new Response(''), /empty|invalid JSON/],
    ['null', () => json(null), /malformed/],
    ['array', () => json([]), /malformed/],
    ['error', () => json({ ...answer(), error: { message: secret, code: secret } }), /reported an error/],
    ['false error is non-null', () => json({ ...answer(), error: false }), /reported an error/],
    ['in progress', () => json({ ...answer(), status: 'in_progress' }), /not completed/],
    ['incomplete', () => json({ ...answer(), status: 'incomplete', incomplete_details: { reason: secret } }), /incomplete/],
    ['unexpected status', () => json({ ...answer(), status: secret }), /not completed/],
    ['no status', () => json({ output: answer().output }), /not completed/],
    ['no output', () => json({ status: 'completed' }), /malformed/],
    ['output object', () => json({ status: 'completed', output: {} }), /malformed/],
    ['bad item', () => json({ status: 'completed', output: [null] }), /malformed/],
    ['bad content', () => json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: {} }] }), /malformed/],
    ['bad text', () => json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: {} }] }] }), /malformed/],
    ['bad annotations', () => json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a', annotations: {} }] }] }), /malformed/],
    ['bad citation', () => json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a', annotations: [{ type: 'url_citation', url: 'javascript:untrusted' }] }] }] }), /malformed/],
    ['body stream exception', () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } })), /could not be completed/],
    ['refusal', () => json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: secret }] }] }), /refused/],
    ['no text', () => json({ status: 'completed', output: [] }), /empty/],
    ['whitespace text', () => json(answer(' \n ')), /empty/],
    ['only user', () => json({ status: 'completed', output: [{ type: 'message', role: 'user', content: [{ type: 'output_text', text: secret }] }] }), /empty/],
    ['unexpected exception', () => { throw new Error(secret); }, /could not be completed/],
    ['unexpected thrown value', () => { throw secret; }, /could not be completed/],
  ];
  for (const [label, fetch, expected] of cases) {
    await t.test(label, async (t) => {
      let calls = 0;
      const { client } = await session(t, async () => { calls++; return fetch(); });
      const result = await client.callTool({ name: 'web_search', arguments: { query: 'q' } });
      assert.equal(result.isError, true);
      assert.match(textOf(result), expected);
      assert.equal(textOf(result).includes(secret), false);
      assert.equal(calls, 1, 'no retries');
    });
  }
});

test('total deadline aborts pending fetch and returns a safe timeout', { timeout: 5000 }, async (t) => {
  let signal;
  let calls = 0;
  const { client } = await session(t, async (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {}); // Deadline must work even with an uncooperative fetch.
  }, 30);
  const result = await client.callTool({ name: 'x_search', arguments: { query: 'q' } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /timed out/);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('deadline covers response-body consumption and cancels the reader', { timeout: 5000 }, async (t) => {
  let cancelled = false;
  const { client } = await session(t, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"status":')); },
    cancel() { cancelled = true; },
  })), 30);
  const result = await client.callTool({ name: 'web_search', arguments: { query: 'q' } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /timed out/);
  assert.equal(cancelled, true);
});

test('elapsed deadline is enforced even if synchronous work delays the timer callback', async () => {
  let signal;
  await assert.rejects(callXaiApi(config(async (_url, options) => {
    signal = options.signal;
    const until = performance.now() + 20;
    while (performance.now() < until) { /* Simulate synchronous upstream/response work. */ }
    return json(answer());
  }, 5), 'q', [], new AbortController().signal), /timed out/);
  assert.equal(signal.aborted, true);
});

test('MCP cancellation aborts the network without a tool response or retry', { timeout: 5000 }, async (t) => {
  const started = Promise.withResolvers();
  const aborted = Promise.withResolvers();
  let calls = 0;
  const { client, responses } = await session(t, async (_url, options) => {
    calls++;
    options.signal.addEventListener('abort', () => aborted.resolve());
    started.resolve();
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const pending = client.callTool({ name: 'web_search', arguments: { query: 'q' } }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await started.promise;
  responses.length = 0;
  controller.abort('client cancellation is a string, not an AbortError');
  await rejected;
  await aborted.promise;
  await nextTurn();
  assert.deepEqual(responses.filter((message) => 'result' in message || 'error' in message), []);
  assert.equal(calls, 1);
});

test('already-aborted signals skip fetch; successful requests clean listeners and timers', async () => {
  const stopped = new AbortController();
  stopped.abort(secret);
  let calls = 0;
  const fetch = async () => { calls++; return json(answer()); };
  await assert.rejects(callXaiApi(config(fetch), 'q', [], stopped.signal), /cancelled/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  let requestSignal;
  await callXaiApi(config(async (_url, options) => {
    requestSignal = options.signal;
    return json(answer());
  }, 20), 'q', [], controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(requestSignal.aborted, false, 'successful request deadline was cleared');
});

test('MCP cancellation during response reading cancels the body', { timeout: 5000 }, async (t) => {
  const reading = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const { client, responses } = await session(t, async () => new Response(new ReadableStream({
    pull() { reading.resolve(); },
    cancel() { cancelled.resolve(); },
  })));
  const controller = new AbortController();
  const pending = client.callTool({ name: 'x_search', arguments: { query: 'q' } }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await reading.promise;
  responses.length = 0;
  controller.abort('stop');
  await rejected;
  await cancelled.promise;
  await nextTurn();
  assert.deepEqual(responses.filter((message) => 'result' in message || 'error' in message), []);
});

test('startup config parses timeout safely and preserves model selection', () => {
  assert.equal(loadConfig({ XAI_API_KEY: secret }).timeoutMs, 120000);
  assert.equal(loadConfig({ XAI_API_KEY: secret }).model, 'grok-4-1-fast-reasoning');
  assert.equal(loadConfig({ XAI_API_KEY: secret, XAI_MODEL: 'chosen', XAI_TIMEOUT_MS: '2147483647' }).timeoutMs, 2147483647);
  assert.equal(loadConfig({ XAI_API_KEY: secret, XAI_MODEL: 'chosen' }).model, 'chosen');
  for (const timeout of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '1e3']) {
    assert.throws(() => loadConfig({ XAI_API_KEY: secret, XAI_TIMEOUT_MS: timeout }), /XAI_TIMEOUT_MS.*positive integer.*2147483647/);
  }
  assert.throws(() => loadConfig({}), /XAI_API_KEY.*required/);
});
