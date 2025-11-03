import type { SessionMessage } from './types/session_message.types.js';

export const ORCHESTRATOR_AGENT_NAME = 'orchestrator';

/**
 * Stub orchestrator step.
 * Returns a simple acknowledgement message from the orchestrator agent.
 * Replace this with a real agent invocation later (agent_factory/registry).
 */
export async function runOrchestratorStep(_params: {
  user_id: string;
  session_id: string;
  agent_name?: string;
}): Promise<SessionMessage[]> {
  const agent_name = _params.agent_name ?? ORCHESTRATOR_AGENT_NAME;

  const ack: Omit<SessionMessage, 'message_id' | 'timestamp'> = {
    sender: { name: agent_name, role: 'model' },
    agent_context: {
      agent_name,
      provider: 'other',
      model: 'stub'
    },
    model_response_type: 'output',
    content: {
      data_type: 'string',
      data: 'Acknowledged.'
    }
  };

  // The repository will add message_id and timestamp if missing
  return [ack as SessionMessage];
}
