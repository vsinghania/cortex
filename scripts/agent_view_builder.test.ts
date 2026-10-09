import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentViewBuilder } from '../src/agent_svc/agent_view_builder.js';
import { AgentFactory } from '../src/agent_svc/factory/agent_factory.js';
import { AgentEngine, type AgentManifest } from '../src/agent_svc/types/agent.types.js';
import { AgentLoadStatus } from '../src/agent_svc/types/agent_view.types.js';
import { InstructionPolicyName } from '../src/agent_svc/types/instruction_policy.types.js';

function manifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    agent_id: 'notes-recall',
    name: 'Notes Recall',
    instructions: 'Recall the user\'s notes.',
    model: 'gpt-test',
    engine: AgentEngine.OpenAi,
    tool_names: [],
    tool_agent_ids: [],
    handoff_agent_ids: [],
    mcp_server_ids: [],
    instruction_policy_names: [InstructionPolicyName.Grounding],
    enabled: true,
    version: 3,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function load(m: AgentManifest) {
  return AgentFactory.createAgentFromManifest({ manifest: m, tools: [] });
}

test('a loaded agent exposes the composed prompt it actually runs with', () => {
  const m = manifest();
  const view = AgentViewBuilder.buildAgentView(m, load(m));

  assert.equal(view.status, AgentLoadStatus.Loaded);
  assert.equal(view.manifest.instructions, 'Recall the user\'s notes.');
  assert.ok(view.runtime?.instructions.startsWith('Recall the user\'s notes.'));
  assert.ok(view.runtime?.instructions.includes('## Grounding'));
  assert.equal(view.runtime?.model, 'gpt-test');
  assert.equal(view.runtime?.manifest_version, 3);
  assert.deepEqual(view.runtime?.mcp_servers, []);
});

test('the runtime model falls back to the engine default when the manifest has none', () => {
  const m = manifest({ model: undefined });
  const view = AgentViewBuilder.buildAgentView(m, load(m));
  assert.equal(view.runtime?.model, process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-5.4-nano');
});

test('an enabled agent missing from the registry is not_loaded, with no runtime', () => {
  const view = AgentViewBuilder.buildAgentView(manifest(), undefined);
  assert.equal(view.status, AgentLoadStatus.NotLoaded);
  assert.equal(view.runtime, null);
});

test('a disabled agent missing from the registry is disabled', () => {
  const view = AgentViewBuilder.buildAgentView(manifest({ enabled: false }), undefined);
  assert.equal(view.status, AgentLoadStatus.Disabled);
});

test('an agent still in the registry reports loaded even if its row was just disabled', () => {
  const served = load(manifest());
  const view = AgentViewBuilder.buildAgentView(manifest({ enabled: false, version: 4 }), served);
  assert.equal(view.status, AgentLoadStatus.Loaded);
  assert.equal(view.runtime?.manifest_version, 3);
});
