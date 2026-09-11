import 'dotenv/config';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { MongooseAgentRepository } from '../src/agent_svc/repositories/mongoose_agent_repository.js';
import { AgentSvc } from '../src/agent_svc/agent_svc.js';
import { AgentEngine } from '../src/agent_svc/types/agent.types.js';
import { Id } from '../src/lib/id.js';

class AgentSmoke {
  static async main(): Promise<void> {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = Number(process.env.MONGO_PORT ?? 27017);
    await MongooseConnectionManager.getInstance({ host, port });

    const agent_id = await AgentSmoke.upsertSmokeAgent();
    const agent_svc = await AgentSvc.create();

    const conversation_id = Id.generateUuidV7();
    console.log('▶ running agent', { agent_id, conversation_id });

    const response = await agent_svc.runByAgentId({
      agent_id,
      conversation_id,
      input: 'Use the ping tool with the message "smoke", then briefly summarize what the tool returned.',
      options: { max_turns: 5 },
    });

    console.log('=== Response ===');
    console.log(JSON.stringify(response, null, 2));

    await MongooseConnectionManager.getExistingInstance()?.disconnectAll();
    process.exit(0);
  }

  private static async upsertSmokeAgent(): Promise<string> {
    const repo = await MongooseAgentRepository.create();
    const agent_id = process.env.SMOKE_AGENT_ID ?? 'smoke-echo-agent';
    await repo.upsertByAgentId({
      agent_id,
      name: 'Smoke Echo Agent',
      instructions:
        'You are a terse assistant for end-to-end testing. When asked, call the `ping` tool, then summarize its result in one sentence.',
      engine: AgentEngine.OpenAi,
      tool_names: ['ping'],
      tool_agent_ids: [],
      handoff_agent_ids: [],
      mcp_server_ids: [],
      instruction_policy_names: [],
      enabled: true,
      version: 1,
    });
    return agent_id;
  }
}

AgentSmoke.main().catch((err) => {
  console.error('agent_smoke failed', err);
  process.exit(1);
});
