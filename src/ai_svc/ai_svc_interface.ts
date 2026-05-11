import {
  GenerateStructuredRequest,
  GenerateStructuredResponse,
  GenerateTextRequest,
  GenerateTextResponse,
} from './types/ai_prompt.types.js';

export interface AiSvcInterface {
  generateText(req: GenerateTextRequest): Promise<GenerateTextResponse>;
  generateStructured<T = unknown>(req: GenerateStructuredRequest): Promise<GenerateStructuredResponse<T>>;
}
