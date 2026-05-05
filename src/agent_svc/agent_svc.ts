import type {
  AgentRunRequest,
  AgentRunResponse,
} from './types/agent.types.js';
import type { Message } from './types/message.types.js';
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
import { performance } from 'node:perf_hooks';

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

    logger.info(
      {
        agent_id: input.agent_id,
        agent_name: agent.manifest.name,
        conversation_id: input.conversation_id,
      },
      'agent run started'
    );

    const conversation = await conversation_store.ensureConversation({
      conversation_id: input.conversation_id,
      user_id: input.user_id,
      agent_id: agent.manifest.agent_id,
    });

    const message_history = await conversation_store.loadHistory(conversation.conversation_id);

    logger.debug(
      {
        agent_id: input.agent_id,
        conversation_id: conversation.conversation_id,
        history_len: message_history.length,
        previous_response_id: conversation.last_response_id,
      },
      'agent run context loaded'
    );

    const req: AgentRunRequest = {
      input: input.input,
      message_history,
      conversation_id: conversation.conversation_id,
      user_id: input.user_id,
      previous_response_id: conversation.last_response_id,
      options: input.options,
    };

    const start_ms = performance.now();
    const response = await agent.run(req);
    const duration_ms = Number((performance.now() - start_ms).toFixed(1));

    await this.persistTurn(agent, req, response);

    logger.info(
      {
        agent_id: input.agent_id,
        conversation_id: response.conversation_id,
        model: response.model,
        message_count: response.message_history.length,
        usage: response.usage,
        stop_reason: response.stop_reason,
        duration_ms,
      },
      'agent run completed'
    );

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
    const result = await conversation_store.listForUser({
      user_id: input.user_id,
      limit: input.limit,
      before_updated_at: input.before_updated_at,
    });
    logger.info(
      { user_id: input.user_id, count: result.length, limit: input.limit },
      'listed conversations'
    );
    return result;
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
    logger.info(
      {
        user_id: input.user_id,
        conversation_id: conversation.conversation_id,
        message_count: messages.length,
      },
      'fetched conversation'
    );
    return { conversation, messages };
  }

  private async persistTurn(
    agent: BaseAgent,
    req: AgentRunRequest,
    response: AgentRunResponse
  ): Promise<void> {
    if (!response.conversation_id) return;

    const new_messages = AgentSvc.diffNewMessages(req, response);
    if (!new_messages.length) return;

    try {
      const conversation_store = await ConversationStore.getInstance();
      await conversation_store.appendTurn({
        conversation_id: response.conversation_id,
        user_id: req.user_id,
        agent_id: agent.manifest.agent_id,
        messages: new_messages,
        usage: response.usage,
        model: response.model,
        response_id: response.response_id,
      });
      logger.debug({ conversation_id: response.conversation_id }, 'Turn persisted');
    } catch (err) {
      logger.error(
        { err, conversation_id: response.conversation_id },
        'Failed to persist agent turn'
      );
    }
  }

  /**
   * Returns messages produced by this run that aren't already in history.
   * The agent returns the full transcript; persistence only writes the new
   * tail to avoid duplicating prior turns.
   */
  private static diffNewMessages(
    req: AgentRunRequest,
    response: AgentRunResponse
  ): Message[] {
    const prior_count = req.message_history?.length ?? 0;
    return response.message_history.slice(prior_count);
  }

}
