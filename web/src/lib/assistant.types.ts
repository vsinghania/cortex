import type { Citation } from './agent.types';

export type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  created_at: string;
};

export type VoiceLine = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** True while the assistant's line is still streaming in. */
  streaming: boolean;
};

/** The voice orb's states; `speaking` is inferred from the assistant's live transcript. */
export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
