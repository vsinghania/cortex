import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY, type McpServer } from '@modelcontextprotocol/server';
import { get } from 'node:http';
import { BaseMcpHttpServer } from '../src/mcp/server/base_mcp_http_server.js';
import { McpModule } from '../src/mcp/server/mcp_module.js';
import { McpCallerAssertion } from '../src/mcp/server/mcp_caller_assertion.js';
import type { McpCaller, McpHttpConfig, McpHttpServerHandle } from '../src/mcp/server/types/mcp_server.types.js';

class TestModule extends McpModule {
  public cleanup_count = 0;
  protected override async registerTools(server: McpServer, caller: McpCaller) {
    this.registerTool(server, caller, {
      name: 'echo', required_scope: 'notes:read',
      config: { title: 'Echo', description: 'Echo', inputSchema: z.object({ text: z.string().default('hello') }), annotations: { readOnlyHint: true } },
      handler: async ({ text }) => ({ text, kind: caller.kind, user: caller.user_id ?? null })
    });
  }
  public override async cleanup() { this.cleanup_count++; }
}

class TestHttpServer extends BaseMcpHttpServer {
  public cleanup_count = 0;
  public modules: TestModule[] = [];
  public constructor(private readonly overrides: Partial<McpHttpConfig> = {}) { super(); }
  protected getServerInfo() { return { name: 'test-mcp', version: '1', log_name: 'test_mcp' }; }
  protected getHttpConfig(): McpHttpConfig {
    return { host: '127.0.0.1', port: 0, path: '/mcp', auth_token: 'service-test-token', assertion_secret: 'test-assertion-secret', assertion_audience: 'notes-test', ...this.overrides };
  }
  protected async createMcpModules() {
    const module = new TestModule();
    this.modules.push(module);
    return [module];
  }
  protected override async cleanup() { this.cleanup_count++; }
  public static url(handle: McpHttpServerHandle) {
    const address = handle.server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}/mcp`;
  }
  public static async request(url: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: 'Bearer service-test-token', 'x-user-id': 'internal-user', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
  }
  public static async result(response: Response) {
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.text();
    const data = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : body;
    return JSON.parse(data) as { result: { structuredContent: Record<string, unknown>; tools: { name: string }[]; serverInfo: { name: string } } };
  }
}

test('HTTP runtime starts fully initialized, shuts down once, releases signals, and restarts', async (t) => {
  const server = new TestHttpServer();
  t.after(async () => { await server.stop(); });
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const counts = signals.map((signal) => process.listenerCount(signal));
  const handle = await server.start();
  assert.equal(handle.server.listening, true);
  signals.forEach((signal, index) => assert.equal(process.listenerCount(signal), counts[index] + 1));
  const initialized = await TestHttpServer.result(await TestHttpServer.request(TestHttpServer.url(handle), 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' }
  }));
  assert.equal(initialized.result.serverInfo.name, 'test-mcp');
  await assert.rejects(server.start(), /already started/);
  await Promise.all([handle.shutdown(), server.stop()]);
  await server.stop();
  assert.equal(server.modules[0].cleanup_count, 1);
  assert.equal(server.cleanup_count, 1);
  signals.forEach((signal, index) => assert.equal(process.listenerCount(signal), counts[index]));
  const restarted = await server.start();
  const result = await TestHttpServer.result(await TestHttpServer.request(TestHttpServer.url(restarted) + '/', 'tools/call', { name: 'echo', arguments: {} }));
  assert.deepEqual(result.result.structuredContent, { text: 'hello', kind: 'internal', user: 'internal-user' });
  await restarted.shutdown();
  assert.equal(server.modules[1].cleanup_count, 1);
  assert.equal(server.cleanup_count, 2);
});

test('HTTP runtime preserves authentication, host validation, caller isolation, and legacy method responses', async (t) => {
  const server = new TestHttpServer();
  t.after(async () => { await server.stop(); });
  const url = TestHttpServer.url(await server.start());
  const unauthorized = await TestHttpServer.request(url, 'tools/list', {}, { Authorization: 'Bearer invalid' });
  assert.equal(unauthorized.status, 401);
  const denied_host = await new Promise<number | undefined>((resolve, reject) => {
    const req = get(url, { headers: { Host: 'evil.test', Authorization: 'Bearer service-test-token' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  assert.equal(denied_host, 403);
  for (const method of ['GET', 'DELETE']) {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer service-test-token', 'MCP-Protocol-Version': '2025-11-25' } });
    assert.equal(response.status, 405);
    await response.text();
  }
  const assertion = McpCallerAssertion.signGatewayCallerAssertion({ secret: 'test-assertion-secret', audience: 'notes-test', caller: {
    kind: 'external', user_id: 'external-user', client_id: 'client-test', scopes: new Set(['notes:read'])
  } });
  const results = await Promise.all([
    TestHttpServer.request(url, 'tools/call', { name: 'echo', arguments: { text: 'external' } }, { Authorization: `Bearer ${assertion}`, 'x-user-id': 'spoofed-user' }),
    TestHttpServer.request(url, 'tools/call', { name: 'echo', arguments: { text: 'internal' } })
  ]);
  assert.deepEqual((await TestHttpServer.result(results[0])).result.structuredContent, { text: 'external', kind: 'external', user: 'external-user' });
  assert.deepEqual((await TestHttpServer.result(results[1])).result.structuredContent, { text: 'internal', kind: 'internal', user: 'internal-user' });
});

test('HTTP runtime serves modern MCP requests from the same tool factory', async (t) => {
  const server = new TestHttpServer();
  t.after(async () => { await server.stop(); });
  const url = TestHttpServer.url(await server.start());
  const meta = { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {} };
  const listed = await TestHttpServer.result(await TestHttpServer.request(url, 'tools/list', { _meta: meta }, {
    'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': 'tools/list'
  }));
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['echo']);
  const called = await TestHttpServer.result(await TestHttpServer.request(url, 'tools/call', {
    name: 'echo', arguments: {}, _meta: meta
  }, { 'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': 'tools/call', 'MCP-Name': 'echo' }));
  assert.deepEqual(called.result.structuredContent, { text: 'hello', kind: 'internal', user: 'internal-user' });
});

test('a failed HTTP listen releases module resources and can be retried', async (t) => {
  const occupied = new TestHttpServer();
  t.after(async () => { await occupied.stop(); });
  const handle = await occupied.start();
  const address = handle.server.address();
  assert.ok(address && typeof address === 'object');
  const server = new TestHttpServer({ port: address.port });
  t.after(async () => { await server.stop(); });
  await assert.rejects(server.start(), /EADDRINUSE/);
  assert.equal(server.modules[0].cleanup_count, 1);
  assert.equal(server.cleanup_count, 1);
  await occupied.stop();
  const retried = await server.start();
  assert.equal(retried.server.listening, true);
});
