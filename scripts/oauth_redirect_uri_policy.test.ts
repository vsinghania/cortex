import assert from 'node:assert/strict';
import test from 'node:test';
import { OAuthRedirectUriPolicy } from '../src/oauth_svc/oauth_redirect_uri_policy.js';

test('allows https, loopback http and private-use schemes', () => {
  for (const uri of [
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost:53682/callback',
    'http://127.0.0.1:8080/cb',
    'http://[::1]:9000/cb',
    'cursor://anysphere.cursor-retrieval/oauth/callback'
  ]) {
    assert.equal(OAuthRedirectUriPolicy.isAllowed(uri), true, uri);
  }
});

test('rejects plain http off loopback, script-like schemes, fragments and junk', () => {
  for (const uri of [
    'http://example.com/callback',
    'http://localhost.evil.test/cb',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'https://claude.ai/cb#frag',
    'not a url'
  ]) {
    assert.equal(OAuthRedirectUriPolicy.isAllowed(uri), false, uri);
  }
});
