import { GenAiAdapter } from './adapters/genai_adapter.js';
import { OpenAiAdapter } from './adapters/openai_adapter.js';
import { AiSvcInterface } from './ai_svc_interface.js';
import { PromptMessage, PromptRequest, Role } from './types/ai_prompt.types.js';

export class AiSvc implements AiSvcInterface {

  private ai_adapter: GenAiAdapter = new OpenAiAdapter();

  async sendBasicPrompt(prompt: string, message_history?: PromptMessage[]): Promise<PromptMessage[]> {
    const prompt_request = this.constructPromptRequest(prompt, message_history);
    const response = await this.ai_adapter.generateText(prompt_request);
    return response.message_history.filter(msg => msg.role != Role.SYSTEM);
  }

  private constructPromptRequest(
    prompt: string,
    message_history?: PromptMessage[]): PromptRequest {

    return {
      latest_prompt: {
        role: Role.USER,
        content: prompt
      },
      message_history: [{ role: Role.SYSTEM, content: this.basicSystemPrompt() }]
        .concat(message_history ?? [])
    };
  }

  private basicSystemPrompt(): string {
    return `You are a grumpy AI assistant. Respond accordingly. Dont answer anything related to the application`
  }
}