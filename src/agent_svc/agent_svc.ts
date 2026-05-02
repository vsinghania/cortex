import type {
  AgentRunRequest,
  AgentRunResponse,
} from './types/agent.types.js';
import type { PromptMessage } from '../ai_svc/types/ai_prompt.types.js';
import { Role } from '../ai_svc/types/ai_prompt.types.js';
import type {
  AgentSvcInterface,
  ConversationWithMessages,
  GetConversationInput,
  ListConversationsInput,
  RunAdHocInput,
  RunByAgentIdInput,
} from './agent_svc_interface.js';
import type { Conversation } from './types/conversation.types.js';
import { NotFoundError } from '../common/errors.js';
import { AgentRegistry } from './registry/agent_registry.js';
import { ToolRegistry } from './tools/tool_registry.js';
import { ConversationStore } from './conversation/conversation_store.js';
import { AgentFactory } from './factory/agent_factory.js';
import type { BaseAgent } from './agents/base_agent.js';
import { logger } from '../common/logger.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';

export class AgentSvc implements AgentSvcInterface {

  private constructor() {}

  /**
   * Async factory that eagerly initializes the process-wide agent singletons
   * (tool registry, agent registry, conversation store) and returns a ready-
   * to-use AgentSvc.
   *
   * The registries are global singletons accessed via getInstance() at call
   * sites; AgentSvc does not hold them as instance fields.
   */
  static async create(): Promise<AgentSvc> {
    ToolRegistry.getInstance();
    await AgentRegistry.getInstance();
    await ConversationStore.getInstance();
    return new AgentSvc();
  }

  @logExecTime({ threshold_in_ms: 5000 })
  async runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse> {
    const agent_registry = await AgentRegistry.getInstance();
    const conversation_store = await ConversationStore.getInstance();

    const agent = agent_registry.resolve(input.agent_id);

    const conversation = await conversation_store.ensureConversation({
      conversation_id: input.conversation_id,
      user_id: input.user_id,
      agent_id: agent.manifest.agent_id,
    });

    const message_history = await conversation_store.loadHistory(conversation.conversation_id);

    const req: AgentRunRequest = {
      input: input.input,
      message_history,
      conversation_id: conversation.conversation_id,
      user_id: input.user_id,
      previous_response_id: conversation.last_response_id,
      options: input.options,
    };

    const response = await agent.run(req);

    await this.persistTurn(agent, req, response);

    return response;
  }

  /**
   * Run an ad-hoc agent built from a manifest + tools that doesn't live in
   * the registry. Used by tests/scripts. Does NOT persist conversation.
   */
  async runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse> {
    const agent = AgentFactory.forManifest({ manifest: input.manifest, tools: input.tools });
    agent.compile();
    return agent.run(input.request);
  }

  async listConversations(input: ListConversationsInput): Promise<Conversation[]> {
    const conversation_store = await ConversationStore.getInstance();
    return conversation_store.listForUser({
      user_id: input.user_id,
      limit: input.limit,
      before_updated_at: input.before_updated_at,
    });
  }

  async getConversation(input: GetConversationInput): Promise<ConversationWithMessages> {
    const conversation_store = await ConversationStore.getInstance();
    const conversation = await conversation_store.getForUser({
      conversation_id: input.conversation_id,
      user_id: input.user_id,
    });
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${input.conversation_id}`);
    }
    const messages = await conversation_store.listMessages(conversation.conversation_id);
    return { conversation, messages };
  }

  private async persistTurn(
    agent: BaseAgent,
    req: AgentRunRequest,
    response: AgentRunResponse
  ): Promise<void> {
    if (!response.conversation_id) return;

    const user_message = AgentSvc.extractUserMessage(req);
    const assistant_message: PromptMessage = {
      role: Role.ASSISTANT,
      content: response.final_output_text ?? '',
    };

    try {
      const conversation_store = await ConversationStore.getInstance();
      await conversation_store.appendTurn({
        conversation_id: response.conversation_id,
        user_id: req.user_id,
        agent_id: agent.manifest.agent_id,
        user_message,
        assistant_message,
        tool_calls: response.tool_calls,
        usage: response.usage,
        model: response.model,
        response_id: response.response_id,
      });
    } catch (err) {
      logger.error(
        { err, conversation_id: response.conversation_id },
        'Failed to persist agent turn'
      );
    }
  }

  private static extractUserMessage(req: AgentRunRequest): PromptMessage {
    if (typeof req.input === 'string') {
      return { role: Role.USER, content: req.input };
    }
    const last_user = [...req.input].reverse().find((m) => m.role === Role.USER);
    return last_user ?? { role: Role.USER, content: '' };
  }
}
