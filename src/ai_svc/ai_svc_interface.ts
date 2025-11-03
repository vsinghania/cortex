import { PromptMessage } from './types/ai_prompt.types.js';

export interface AiSvcInterface {
  sendBasicPrompt(prompt: string): Promise<PromptMessage[]>;
}