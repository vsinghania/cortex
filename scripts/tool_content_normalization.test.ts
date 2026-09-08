import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiSdkUtils } from '../src/agent_svc/agents/openai/openai_sdk_utils.js';
import { MessageContent } from '../src/agent_svc/types/message.types.js';

const PAYLOAD = { chunks: [{ chunk_id: 'c1', document_id: 'n1' }] };

test('an MCP text content item becomes a JSON part', () => {
  // What the agents SDK hands back for a single-item MCP result.
  const output = { type: 'text', text: JSON.stringify(PAYLOAD, null, 2) };

  const content = OpenAiSdkUtils.toToolContent(output);
  assert.deepEqual(content, [{ type: 'json', data: PAYLOAD }]);
});

test('a multi-item content array is joined before parsing', () => {
  // The SDK returns the raw array when a tool emits several content items; the halves
  // concatenate back into one JSON document rather than changing the message shape.
  const json = JSON.stringify(PAYLOAD);
  const split = Math.floor(json.length / 2);
  const output = [
    { type: 'text', text: json.slice(0, split) },
    { type: 'text', text: json.slice(split) },
  ];

  assert.deepEqual(OpenAiSdkUtils.toToolContent(output), [{ type: 'json', data: PAYLOAD }]);
});

test('non-JSON tool output stays a text part', () => {
  assert.deepEqual(
    OpenAiSdkUtils.toToolContent({ type: 'text', text: 'Missing X-User-Id on MCP request' }),
    MessageContent.text('Missing X-User-Id on MCP request')
  );
});

test('a bare string payload is parsed too', () => {
  assert.deepEqual(OpenAiSdkUtils.toToolContent(JSON.stringify(PAYLOAD)), [
    { type: 'json', data: PAYLOAD },
  ]);
});

test('malformed JSON degrades to text rather than throwing', () => {
  const broken = '{"chunks": [';
  assert.deepEqual(
    OpenAiSdkUtils.toToolContent({ type: 'text', text: broken }),
    MessageContent.text(broken)
  );
});

test('empty output produces empty text, not a JSON part', () => {
  assert.deepEqual(OpenAiSdkUtils.toToolContent(null), MessageContent.text(''));
});

test('a JSON part round-trips back to text for model replay', () => {
  const content = OpenAiSdkUtils.toToolContent({ type: 'text', text: JSON.stringify(PAYLOAD) });
  assert.deepEqual(JSON.parse(MessageContent.toText(content)), PAYLOAD);
});
