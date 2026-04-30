/* Smoke test for SDK-backed Streamable HTTP MCP client using the local notes MCP server.
 * Run the server first:
 *   MCP_NOTES_AUTH_TOKEN=dev-token npm run mcp:notes:dev
 * Then run:
 *   MCP_NOTES_AUTH_TOKEN=dev-token npm run mcp:smoke
 */
import { createMcpClientFromUntrusted } from "../src/mcp/client/factory/mcp_client_factory.js";
import { logger } from "../src/common/logger.js";
import type { McpLogEvent, McpNotification, ToolDescription } from "../src/mcp/client/types/mcp.types.js";

async function main() {
  const authToken = process.env.MCP_NOTES_AUTH_TOKEN;
  if (!authToken) {
    throw new Error("MCP_NOTES_AUTH_TOKEN is required to run the notes MCP HTTP smoke test.");
  }

  const port = Number(process.env.MCP_NOTES_PORT ?? 3010) || 3010;
  const path = process.env.MCP_NOTES_PATH ?? "/mcp";
  const baseUrl = process.env.MCP_NOTES_URL ?? `http://127.0.0.1:${port}${path}`;
  const userId = process.env.MCP_NOTES_SMOKE_USER_ID ?? "897bffbf-b861-4ee4-854f-ff7bbd8e8296";

  const cfg = {
    transport: "http",
    client: { name: "cortex", version: "1.0.0" },
    http: {
      base_url: baseUrl,
      auth_token: authToken,
      startup_timeout_ms: 15000
    }
  };

  const client = createMcpClientFromUntrusted(cfg);

  logger.info({ baseUrl }, "Connecting to notes MCP server via Streamable HTTP...");
  await client.connect();
  await client.initialize();
  logger.info("Connected and initialized.");

  client.onLog((e: McpLogEvent) => {
    logger.debug({ e }, "mcp_log");
  });

  client.onNotification((n: McpNotification) => {
    logger.debug({ n }, "mcp_notification");
  });

  const tools: ToolDescription[] = await client.listTools();
  logger.info({ tool_count: tools.length, tools: tools.map(t => t.name) }, "tools_list");

  const result = await client.callTool({
    name: "notes.list",
    arguments: { user_id: userId, limit: 2, offset: 0 }
  });

  logger.info({ result }, "notes.list_result");

  await client.shutdown();
  logger.info("Client shutdown complete.");
}

main().catch((err) => {
  logger.error({ err }, "mcp_smoke_failed");
  process.exitCode = 1;
});
