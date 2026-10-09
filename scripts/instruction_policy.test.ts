import assert from 'node:assert/strict';
import test from 'node:test';
import { InstructionComposer } from '../src/agent_svc/instructions/instruction_composer.js';
import { InstructionPolicyRegistry } from '../src/agent_svc/instructions/instruction_policy_registry.js';
import { InstructionPolicyName } from '../src/agent_svc/types/instruction_policy.types.js';
import { CitationExtractor } from '../src/citation_svc/citation_extractor.js';
import { Corpus } from '../src/retrieval_svc/types/retrieval.types.js';
import { NotFoundError } from '../src/common/errors.js';

const registry = InstructionPolicyRegistry.getInstance();

test('every policy name in the enum is registered', () => {
  const registered = registry.listInstructionPolicies().map((p) => p.name).sort();
  assert.deepEqual(registered, Object.values(InstructionPolicyName).sort());
});

test('compose with no policies returns the instructions unchanged', () => {
  const composed = InstructionComposer.composeInstructions({ instructions: 'Be helpful.\n', policies: [] });
  assert.equal(composed, 'Be helpful.\n');
});

test('resolves policies in canonical order regardless of manifest order, deduped', () => {
  const policies = registry.resolveInstructionPolicies([
    InstructionPolicyName.WriteSafety,
    InstructionPolicyName.OutputHygiene,
    InstructionPolicyName.WriteSafety,
  ]);
  assert.deepEqual(
    policies.map((p) => p.name),
    [InstructionPolicyName.OutputHygiene, InstructionPolicyName.WriteSafety]
  );
});

test('an unknown policy name throws so the agent is skipped, not built ungated', () => {
  assert.throws(
    () => registry.resolveInstructionPolicies([InstructionPolicyName.Grounding, 'output_hygeine']),
    (err: unknown) => err instanceof NotFoundError && /output_hygeine/.test(err.message)
  );
});

test('appends policies after the agent instructions under one rules heading', () => {
  const composed = InstructionComposer.composeInstructions({
    instructions: 'You are a recall assistant.',
    policies: registry.resolveInstructionPolicies([InstructionPolicyName.Grounding, InstructionPolicyName.Confidentiality]),
  });
  assert.ok(composed.startsWith('You are a recall assistant.\n\n---\n# Response rules'));
  assert.equal(composed.match(/# Response rules/g)?.length, 1);
  assert.ok(composed.indexOf('## Confidentiality') < composed.indexOf('## Grounding'));
});

test('the citations policy teaches a marker the extractor can parse', () => {
  const [citations] = registry.resolveInstructionPolicies([InstructionPolicyName.Citations]);
  assert.ok(citations.body().includes(CitationExtractor.MARKER_SYNTAX));

  const extracted = CitationExtractor.extractCitations({
    tool_payloads: [{ chunks: [{ chunk_id: 'chunk-a', document_id: 'note-1', corpus: Corpus.Notes }] }],
    answer_text: `We dropped Redis. ${CitationExtractor.buildCitationMarker('chunk-a')}`,
  });
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].chunk_id, 'chunk-a');
});
