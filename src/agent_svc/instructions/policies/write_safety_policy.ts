import { InstructionPolicyName, type InstructionPolicy } from '../../types/instruction_policy.types.js';

export class WriteSafetyPolicy implements InstructionPolicy {
  readonly name = InstructionPolicyName.WriteSafety;
  readonly title = 'Changing data';

  body(): string {
    return [
      '- Create, update, or delete only when the user\'s request calls for it. Never make changes proactively or as a side effect of answering a question.',
      '- Before changing anything, resolve exactly which item is meant. If more than one item could match, ask the user which one.',
      '- Before deleting anything, or before any change that affects more than one item, state what will be affected and wait for the user\'s explicit confirmation.',
      '- After a change, report what actually happened according to the tool result.',
      '- If a change fails, tell the user briefly and wait for direction instead of silently retrying.',
    ].join('\n');
  }
}
