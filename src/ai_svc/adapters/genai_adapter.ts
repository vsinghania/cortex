import { PromptRequest, PromptOptions, PromptResponse } from '../types/ai_prompt.types.js';

export interface GenAiAdapter {
  generateText(prompt: PromptRequest, opts?: PromptOptions): Promise<PromptResponse>;
  generateJsonOutput(prompt: PromptRequest, opts?: PromptOptions): Promise<PromptResponse>;
}