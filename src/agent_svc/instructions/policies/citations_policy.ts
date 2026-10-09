import { InstructionPolicyName, type InstructionPolicy } from '../../types/instruction_policy.types.js';
import { CitationExtractor } from '../../../citation_svc/citation_extractor.js';

export class CitationsPolicy implements InstructionPolicy {
  readonly name = InstructionPolicyName.Citations;
  readonly title = 'Citations';

  // Built from CitationExtractor so the syntax taught here cannot drift from the one it parses.
  body(): string {
    const first = CitationExtractor.buildCitationMarker('abc123');
    const second = CitationExtractor.buildCitationMarker('def456');
    return [
      `- Cite each load-bearing claim that comes from a retrieved content chunk inline with ${CitationExtractor.MARKER_SYNTAX}, using the exact chunk_id from the tool result. Example: "You chose ECS first to keep operations simple. ${first}"`,
      `- When several chunks support one claim, place the markers side by side: ${first}${second}`,
      '- Only cite chunk ids returned by a tool call made while producing the current response. Chunk ids from earlier turns are not valid citations; if you rely on earlier findings, retrieve them again.',
      '- Only results that contain chunks can be cited. Never invent markers, and never cite results from tools that return whole records rather than chunks.',
      '- Prefer paraphrase plus citation over long verbatim quotes.',
    ].join('\n');
  }
}
