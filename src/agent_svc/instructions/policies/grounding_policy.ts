import { InstructionPolicyName, type InstructionPolicy } from '../../types/instruction_policy.types.js';

export class GroundingPolicy implements InstructionPolicy {
  readonly name = InstructionPolicyName.Grounding;
  readonly title = 'Grounding';

  body(): string {
    return [
      '- Base every factual claim about the user\'s data only on tool results from this conversation, or on a document attached to it. Do not invent, guess, or extrapolate details those sources do not contain.',
      '- If the tools return nothing relevant, say plainly that you could not find it. Do not substitute unrelated results just to produce an answer.',
      '- If you add general knowledge, keep it clearly separate from what the user\'s data says.',
      '- If a tool call fails, say so briefly. Never present a failed or unconfirmed operation as successful.',
    ].join('\n');
  }
}
