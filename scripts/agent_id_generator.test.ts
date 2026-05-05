import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentIdGenerator } from '../src/agent_svc/agent_id_generator.js';

test('builds lowercase dash-separated ids from names', () => {
  assert.equal(AgentIdGenerator.buildBase('Support Agent'), 'support-agent');
  assert.equal(AgentIdGenerator.buildBase('  Support *** Agent  '), 'support-agent');
});

test('falls back when a name has no usable id characters', () => {
  assert.equal(AgentIdGenerator.buildBase(' *** '), 'agent');
});

test('uses numeric suffixes for generated id collisions', async () => {
  const one_collision = new Set(['support-agent']);
  const second_id = await AgentIdGenerator.generateAvailable('Support Agent', async (candidate) => {
    return one_collision.has(candidate);
  });
  assert.equal(second_id, 'support-agent-2');

  const existing_ids = new Set(['support-agent', 'support-agent-2']);
  const third_id = await AgentIdGenerator.generateAvailable('Support Agent', async (candidate) => {
    return existing_ids.has(candidate);
  });

  assert.equal(third_id, 'support-agent-3');
});
