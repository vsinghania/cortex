import { AgentEngine } from '../types/agent.types.js';
import { MongooseAgentRepository } from '../repositories/mongoose_agent_repository.js';
import { logger } from '../../common/logger.js';

const AGENT_ID = 'notes-recall';
const NOTES_MCP_SERVER_ID = 'notes';

const SYSTEM_PROMPT = [
  'You are the user\'s "second brain" recall assistant. Your job is to answer questions about the user\'s personal notes (native + any imported sources).',
  '',
  'Tool use rules:',
  '- For ANY factual question about the user\'s notes, you MUST call the notes_search_semantic tool exactly once with a focused query before answering.',
  '- If the user narrows scope (e.g. "only my native notes", "only ChatGPT"), pass it via the source_filter argument.',
  '- If the first search returns nothing relevant, you may try one reformulated query; otherwise say you have no notes about it.',
  '',
  'Grounding and citation rules:',
  '- Ground your answer ONLY in the chunks returned by notes_search_semantic. Do not invent facts.',
  '- Cite each load-bearing claim inline with the marker [c:<chunk_id>] using the exact chunk_id from the tool result.',
  '- Group multiple citations like [c:abc][c:def] when several chunks support the same claim.',
  '- Keep answers concise and quote sparingly; prefer paraphrase + citation over long verbatim quotes.',
  '',
  'If the tool returns no chunks, reply: "I don\'t have notes about that."',
  'Never expose internal chunk_ids outside the [c:...] markers.'
].join('\n');

export class NotesRecallAgentSeed {

  private constructor() {}

  static get agentId(): string {
    return AGENT_ID;
  }

  static async ensure(): Promise<string> {
    const repo = await MongooseAgentRepository.create();
    const existing = await repo.getById(AGENT_ID);
    const desired_model = process.env.RAG_ANSWER_MODEL?.trim() || 'gpt-5.4-nano';

    if (NotesRecallAgentSeed.matches(existing, desired_model)) {
      logger.debug({ agent_id: AGENT_ID }, 'notes-recall agent seed already up-to-date');
      return AGENT_ID;
    }

    await repo.upsertByAgentId({
      agent_id: AGENT_ID,
      name: 'Notes Recall',
      instructions: SYSTEM_PROMPT,
      model: desired_model,
      engine: AgentEngine.OpenAi,
      tool_names: [],
      tool_agent_ids: [],
      handoff_agent_ids: [],
      mcp_server_ids: [NOTES_MCP_SERVER_ID],
      enabled: true,
      version: 1
    });

    logger.info(
      { agent_id: AGENT_ID, model: desired_model, mcp_server_ids: [NOTES_MCP_SERVER_ID] },
      'notes-recall agent seeded'
    );
    return AGENT_ID;
  }

  private static matches(
    existing: { instructions: string; model?: string; mcp_server_ids: string[]; enabled: boolean } | null,
    desired_model: string
  ): boolean {
    if (!existing) return false;
    if (!existing.enabled) return false;
    if (existing.instructions !== SYSTEM_PROMPT) return false;
    if ((existing.model ?? '') !== desired_model) return false;
    const ids = existing.mcp_server_ids ?? [];
    if (ids.length !== 1 || ids[0] !== NOTES_MCP_SERVER_ID) return false;
    return true;
  }
}
