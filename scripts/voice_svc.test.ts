import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceSvc } from '../src/voice_svc/voice_svc.js';
import { OAuthSvc } from '../src/oauth_svc/oauth_svc.js';

test('voice initialization stays asynchronous, retries a failed configuration, and shares one instance', async (t) => {
  const keys = ['OPENAI_API_KEY', 'VOICE_PROVIDER', 'VOICE_MCP_PUBLIC_URL'] as const;
  const original = keys.map((key) => process.env[key]);
  t.after(() => {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  });
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.VOICE_PROVIDER = 'invalid-test-provider';
  process.env.VOICE_MCP_PUBLIC_URL = 'https://mcp.test/notes';
  t.mock.method(OAuthSvc, 'isConfigured', () => false);
  const failed = VoiceSvc.getInstance();
  assert.ok(failed instanceof Promise);
  await assert.rejects(failed, /Unsupported VOICE_PROVIDER/);
  process.env.VOICE_PROVIDER = 'openai';
  const instances = await Promise.all([VoiceSvc.getInstance(), VoiceSvc.getInstance(), VoiceSvc.getInstance()]);
  assert.equal(instances[0], instances[1]);
  assert.equal(instances[1], instances[2]);
  assert.equal(await VoiceSvc.getInstance(), instances[0]);
});
