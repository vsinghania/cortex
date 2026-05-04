/* End-to-end smoke for notes MCP integration with the agent service.
 *
 * Idempotent on every run: upserts both the MCP server manifest and the
 * agent manifest. Run prerequisites:
 *   1) Set MCP_NOTES_AUTH_TOKEN in your .env (random hex; see .env.example).
 *   2) Start the notes MCP server in another terminal:
 *        npm run mcp:notes:dev
 *   3) Then run:
 *        npx tsx scripts/notes_mcp_agent_smoke.ts
 */
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { MongooseAgentRepository } from '../src/agent_svc/repositories/mongoose_agent_repository.js';
import { MongooseMcpServerRepository } from '../src/agent_svc/repositories/mongoose_mcp_server_repository.js';
import { AgentSvc } from '../src/agent_svc/agent_svc.js';
import { AgentEngine } from '../src/agent_svc/types/agent.types.js';
import {
  McpServerMode,
  McpTransport,
} from '../src/agent_svc/types/mcp_server.types.js';

class NotesMcpAgentSmoke {
  private static readonly MCP_SERVER_ID =
    process.env.SMOKE_NOTES_MCP_ID ?? 'notes';
  private static readonly AGENT_ID =
    process.env.SMOKE_NOTES_AGENT_ID ?? 'smoke-notes-agent';
  private static readonly USER_ID =
    process.env.SMOKE_NOTES_USER_ID ?? '897bffbf-b861-4ee4-854f-ff7bbd8e8296';

  static async main(): Promise<void> {
    NotesMcpAgentSmoke.assertEnv();

    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    await MongooseConnectionManager.getInstance({ host, port });

    await NotesMcpAgentSmoke.upsertNotesMcpServer();
    await NotesMcpAgentSmoke.upsertAgent();

    const agent_svc = await AgentSvc.create();
    const conversation_id = uuidv4();
    console.log('▶ running notes-mcp agent', {
      agent_id: NotesMcpAgentSmoke.AGENT_ID,
      mcp_server_id: NotesMcpAgentSmoke.MCP_SERVER_ID,
      conversation_id,
      user_id: NotesMcpAgentSmoke.USER_ID,
    });

    const response = await agent_svc.runByAgentId({
      agent_id: NotesMcpAgentSmoke.AGENT_ID,
      conversation_id,
      user_id: NotesMcpAgentSmoke.USER_ID,
      input:
        'List up to 3 of my notes using the notes.list tool, ' +
        'then briefly summarize what you got.',
      options: { max_turns: 5 },
    });

    console.log('=== Response ===');
    console.log(JSON.stringify(response, null, 2));

    await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    process.exit(0);
  }

  private static assertEnv(): void {
    if (!process.env.MCP_NOTES_AUTH_TOKEN) {
      throw new Error(
        'MCP_NOTES_AUTH_TOKEN is required (set in .env). The notes MCP server and this script must share the same value.'
      );
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required to run the agent.');
    }
  }

  private static async upsertNotesMcpServer(): Promise<void> {
    const repo = await MongooseMcpServerRepository.create();
    const mcp_port = Number(process.env.MCP_NOTES_PORT ?? 3010) || 3010;
    const mcp_path = process.env.MCP_NOTES_PATH ?? '/mcp';
    const base_url =
      process.env.MCP_NOTES_URL ?? `http://127.0.0.1:${mcp_port}${mcp_path}`;

    await repo.upsertByMcpServerId({
      mcp_server_id: NotesMcpAgentSmoke.MCP_SERVER_ID,
      name: 'Notes MCP (local)',
      mode: McpServerMode.SelfHosted,
      transport: McpTransport.Http,
      http: {
        base_url,
        auth_token_env: 'MCP_NOTES_AUTH_TOKEN',
      },
      enabled: true,
      version: 1,
    });
    console.log('✓ upserted MCP server manifest', {
      mcp_server_id: NotesMcpAgentSmoke.MCP_SERVER_ID,
      base_url,
    });
  }

  private static async upsertAgent(): Promise<void> {
    const repo = await MongooseAgentRepository.create();
    await repo.upsertByAgentId({
      agent_id: NotesMcpAgentSmoke.AGENT_ID,
      name: 'Smoke Notes Agent',
      instructions:
        'You are a terse assistant for end-to-end testing of the notes MCP. ' +
        'When asked, call the appropriate notes.* tool exposed by the MCP server, ' +
        'then summarize the result in one or two short sentences.',
      engine: AgentEngine.OpenAi,
      tool_names: [],
      tool_agent_ids: [],
      handoff_agent_ids: [],
      mcp_server_ids: [NotesMcpAgentSmoke.MCP_SERVER_ID],
      enabled: true,
      version: 1,
    });
    console.log('✓ upserted agent manifest', {
      agent_id: NotesMcpAgentSmoke.AGENT_ID,
      mcp_server_ids: [NotesMcpAgentSmoke.MCP_SERVER_ID],
    });
  }
}

NotesMcpAgentSmoke.main().catch((err) => {
  console.error('notes_mcp_agent_smoke failed', err);
  process.exit(1);
});
