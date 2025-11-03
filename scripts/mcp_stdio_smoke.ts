/* Smoke test for SDK-backed Stdio MCP client using the local notes MCP server.
 * Run with: npm run mcp:smoke
 */
import { createMcpClientFromUntrusted } from "../src/mcp/client/factory/mcp_client_factory.js";
import { logger } from "../src/common/logger.js";
import type { McpLogEvent, McpNotification, ToolDescription } from "../src/mcp/client/types/mcp.types.js";

async function main() {
  const cfg = {
    transport: "stdio",
    client: { name: "cortex", version: "1.0.0" },
    stdio: {
      // Use tsx to execute the TS server directly
      command: "tsx",
      args: ["src/mcp/server/notes/server.ts"],
      cwd: process.cwd(),
      startup_timeout_ms: 15000
    }
  };

  const client = createMcpClientFromUntrusted(cfg);

  logger.info("Connecting to notes MCP server via stdio...");
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

  // Call notes.list (limit 2)
  const result = await client.callTool({
    name: "notes.list",
    arguments: { user_id: "test_user", limit: 2, offset: 0 }
  });

  logger.info({ result }, "notes.list_result");

  await client.shutdown();
  logger.info("Client shutdown complete.");
}

main().catch((err) => {
  logger.error({ err }, "mcp_smoke_failed");
  process.exitCode = 1;
});
