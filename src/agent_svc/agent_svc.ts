import type {
  AgentManifest,
  AgentRunRequest,
  AgentRunResponse,
  AgentUpdatePatch,
} from './types/agent.types.js';
import { AgentEngine } from './types/agent.types.js';
import type { Message } from './types/message.types.js';
import type {
  AgentSvcInterface,
  ConversationWithMessages,
  CreateAgentInput,
  GetConversationInput,
  ListConversationsInput,
  RunAdHocInput,
  RunByAgentIdInput,
  UpdateAgentInput,
} from './agent_svc_interface.js';
import type { Conversation } from './types/conversation.types.js';
import { BadRequestError, ConflictError, NotFoundError } from '../common/errors.js';
import { AgentRegistry } from './registry/agent_registry.js';
import { ToolRegistry } from './tools/tool_registry.js';
import { ConversationStore } from './conversation/conversation_store.js';
import { ConversationTitleGenerator } from './conversation/conversation_title_generator.js';
import { AgentFactory } from './factory/agent_factory.js';
import { MongooseAgentRepository } from './repositories/mongoose_agent_repository.js';
import { AgentIdGenerator } from './agent_id_generator.js';
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

  async createAgent(input: CreateAgentInput): Promise<AgentManifest> {
    const repo = await MongooseAgentRepository.create();
    const agent_id = await AgentSvc.resolveCreateAgentId(input, repo);
    const manifest = AgentSvc.buildCreateManifest(agent_id, input);
    const created = await repo.create(manifest);
    await this.refreshAgentRegistry();

    logger.info(
      {
        agent_id: created.agent_id,
        enabled: created.enabled,
        tool_count: created.tool_names.length,
        tool_agent_count: created.tool_agent_ids.length,
        handoff_agent_count: created.handoff_agent_ids.length,
        mcp_server_count: created.mcp_server_ids.length,
      },
      'agent created'
    );

    return created;
  }

  async updateAgent(input: UpdateAgentInput): Promise<AgentManifest> {
    const patch = AgentSvc.compactUpdatePatch(input.patch);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestError('At least one agent field is required');
    }

    const repo = await MongooseAgentRepository.create();
    const updated = await repo.updateByAgentId(input.agent_id, patch);
    if (!updated) {
      throw new NotFoundError(`Agent not found: ${input.agent_id}`);
    }

    await this.refreshAgentRegistry();

    logger.info(
      {
        agent_id: updated.agent_id,
        enabled: updated.enabled,
        updated_field_count: Object.keys(patch).length,
      },
      'agent updated'
    );

    return updated;
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

    const { conversation, created } = await conversation_store.ensureConversation({
      conversation_id: input.conversation_id,
      user_id: input.user_id,
      agent_id: agent.manifest.agent_id,
    });

    const title_promise = created
      ? this.generateAndPersistTitle(conversation.conversation_id, input.input)
      : Promise.resolve();

    const message_history = await conversation_store.loadHistory(conversation.conversation_id);

    logger.debug(
      {
        agent_id: input.agent_id,
        conversation_id: conversation.conversation_id,
        history_len: message_history.length,
        previous_response_id: conversation.last_provider_response_id,
      },
      'agent run context loaded'
    );

    const req: AgentRunRequest = {
      input: input.input,
      message_history,
      conversation_id: conversation.conversation_id,
      user_id: input.user_id,
      previous_response_id: conversation.last_provider_response_id,
      options: input.options,
    };

    const start_ms = performance.now();
    const response = await agent.run(req);
    const duration_ms = Number((performance.now() - start_ms).toFixed(1));

    await this.persistTurn(agent, req, response);
    await title_promise;

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

  private async generateAndPersistTitle(
    conversation_id: string,
    input: string | Message[]
  ): Promise<void> {
    try {
      const query = ConversationTitleGenerator.extractQuery(input);
      if (!query) return;
      const title = await ConversationTitleGenerator.generate(query);
      const conversation_store = await ConversationStore.getInstance();
      await conversation_store.setTitle(conversation_id, title);
      logger.info({ conversation_id, title }, 'conversation title generated');
    } catch (err) {
      logger.warn({ err, conversation_id }, 'conversation title generation failed');
    }
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

  private static async resolveCreateAgentId(
    input: CreateAgentInput,
    repo: MongooseAgentRepository
  ): Promise<string> {
    if (input.agent_id) {
      const existing = await repo.getById(input.agent_id);
      if (existing) {
        throw new ConflictError(`Agent already exists: ${input.agent_id}`, {
          details: { agent_id: input.agent_id },
        });
      }
      return input.agent_id;
    }

    return AgentIdGenerator.generateAvailable(input.name, async (agent_id) => {
      const existing = await repo.getById(agent_id);
      return existing !== null;
    });
  }

  private static buildCreateManifest(
    agent_id: string,
    input: CreateAgentInput
  ): Omit<AgentManifest, 'created_at' | 'updated_at'> {
    return {
      agent_id,
      name: input.name,
      instructions: input.instructions,
      model: input.model,
      engine: input.engine ?? AgentEngine.OpenAi,
      tool_names: input.tool_names ?? [],
      tool_agent_ids: input.tool_agent_ids ?? [],
      handoff_agent_ids: input.handoff_agent_ids ?? [],
      mcp_server_ids: input.mcp_server_ids ?? [],
      output_schema: input.output_schema,
      enabled: input.enabled ?? true,
      version: 1,
    };
  }

  private static compactUpdatePatch(patch: AgentUpdatePatch): AgentUpdatePatch {
    const out: AgentUpdatePatch = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      Object.assign(out, { [key]: value });
    }
    return out;
  }


  private async refreshAgentRegistry(): Promise<void> {
    const agent_registry = await AgentRegistry.getInstance();
    await agent_registry.refresh();
  }

}
