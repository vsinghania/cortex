import 'dotenv/config';
import { z } from 'zod';
import { AiSvc } from '../src/ai_svc/ai_svc.js';
import { GenAiProvider, GenAiProviderSchema, Role } from '../src/ai_svc/types/ai_prompt.types.js';

class AiSmoke {
  private static readonly provider: GenAiProvider | undefined = process.env.AI_SMOKE_PROVIDER
    ? GenAiProviderSchema.parse(process.env.AI_SMOKE_PROVIDER)
    : undefined;

  static async main(): Promise<void> {
    const ai_svc = await AiSvc.getInstance();
    await AiSmoke.runGenerateText(ai_svc);
    await AiSmoke.runRegisteredSchema(ai_svc);
    await AiSmoke.runInlineZodSchema(ai_svc);
    await AiSmoke.runInlineJsonSchema(ai_svc);
    process.exit(0);
  }

  private static async runGenerateText(ai_svc: AiSvc): Promise<void> {
    console.log('\n▶ generateText');
    const resp = await ai_svc.generateText({
      provider: AiSmoke.provider,
      messages: [
        { role: Role.SYSTEM, content: 'You answer in one short sentence.' },
        { role: Role.USER, content: 'What is the capital of Japan?' },
      ],
    });
    console.log(JSON.stringify(resp, null, 2));
  }

  private static async runRegisteredSchema(ai_svc: AiSvc): Promise<void> {
    console.log('\n▶ generateStructured (registered: recipe_v1)');
    const resp = await ai_svc.generateStructured({
      provider: AiSmoke.provider,
      messages: [
        { role: Role.USER, content: 'Give me a 2-serving recipe for scrambled eggs.' },
      ],
      schema: { kind: 'registered', name: 'recipe_v1' },
    });
    console.log(JSON.stringify(resp, null, 2));
  }

  private static async runInlineZodSchema(ai_svc: AiSvc): Promise<void> {
    console.log('\n▶ generateStructured (inline zod)');
    const JokeSchema = z.object({
      setup: z.string(),
      punchline: z.string(),
    });
    type Joke = z.infer<typeof JokeSchema>;
    const resp = await ai_svc.generateStructured<Joke>({
      provider: AiSmoke.provider,
      messages: [
        { role: Role.USER, content: 'Tell me one short clean joke.' },
      ],
      schema: { kind: 'zod', name: 'joke_v1', schema: JokeSchema },
    });
    console.log(JSON.stringify(resp, null, 2));
  }

  private static async runInlineJsonSchema(ai_svc: AiSvc): Promise<void> {
    console.log('\n▶ generateStructured (inline json_schema)');
    const json_schema: Record<string, unknown> = {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string' },
        country: { type: 'string' },
        population_millions: { type: 'number' },
      },
      required: ['city', 'country', 'population_millions'],
    };
    type CityFact = { city: string; country: string; population_millions: number };
    const resp = await ai_svc.generateStructured<CityFact>({
      provider: AiSmoke.provider,
      messages: [
        { role: Role.USER, content: 'Give a single fact about Tokyo.' },
      ],
      schema: { kind: 'json_schema', name: 'city_fact_v1', schema: json_schema },
    });
    console.log(JSON.stringify(resp, null, 2));
  }
}

AiSmoke.main().catch((err) => {
  console.error('ai_smoke failed', err);
  process.exit(1);
});
