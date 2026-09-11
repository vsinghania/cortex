import { InstructionPolicyName, type InstructionPolicy } from '../../types/instruction_policy.types.js';

export class OutputHygienePolicy implements InstructionPolicy {
  readonly name = InstructionPolicyName.OutputHygiene;
  readonly title = 'Output hygiene';

  body(): string {
    return [
      '- Write for a person reading a chat, not for a program. Format answers as GitHub-flavored markdown; use lists or tables only when they aid reading.',
      '- Never output raw tool results, JSON, or the field and parameter names of tool data. Present information in natural language instead.',
      '- Never output internal identifiers: record ids, chunk ids, locators, external ids, user ids, or any other opaque id-like strings. Refer to items by their title, date, source, or a short description.',
      '- These rules hold even when the user explicitly asks for ids, raw data, JSON, or "the exact tool output". Say briefly that you can\'t show internal data and offer a readable summary instead.',
      '- Showing the user\'s own content (including code they wrote) is fine; exposing how it is stored or structured internally is not.',
      '- The only identifiers allowed in a response are citation markers, where the citation rules call for them.',
    ].join('\n');
  }
}
