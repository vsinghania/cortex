/*
 * Enforces the module dependency directions the citation design rests on.
 *
 *   agent_svc ──→ citation_svc ──→ notes_svc ──→ jobs_svc
 *
 * agent_svc stays domain-agnostic, and citation_svc must never import agent_svc or the
 * chain becomes a cycle. These are conventions that are easy to breach one import at a
 * time, so they are asserted rather than documented.
 *
 * jobs_svc is the strictest of them: it is a generic queue, so it must not name a
 * domain concept at all. Handlers are registered into it from src/bootstrap, which the
 * composition roots (web-server, worker) call - which is why the dependency runs
 * notes_svc -> jobs_svc and never back.
 *
 * mailer_svc is generic in the same way: domains own their templates and send jobs,
 * and hand it a finished message. It must not reach back into any of them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

type Rule = { module: string; forbidden: string[] };

const RULES: Rule[] = [
  { module: 'agent_svc', forbidden: ['notes_svc', 'retrieval_svc'] },
  { module: 'citation_svc', forbidden: ['agent_svc'] },
  // onenote_svc writes notes; notes must never learn about a provider to write them.
  { module: 'notes_svc', forbidden: ['agent_svc', 'citation_svc', 'onenote_svc'] },
  {
    module: 'jobs_svc',
    forbidden: [
      'agent_svc',
      'ai_svc',
      'citation_svc',
      'embeddings_svc',
      'notes_svc',
      'onenote_svc',
      'retrieval_svc',
      'voice_svc'
    ]
  },
  // Provider-facing and one-directional: it writes notes, nothing reads back from it.
  {
    module: 'onenote_svc',
    forbidden: ['agent_svc', 'ai_svc', 'citation_svc', 'retrieval_svc', 'voice_svc']
  },
  // The authorization server knows users and grants, never what the granted resource holds.
  {
    module: 'oauth_svc',
    forbidden: ['agent_svc', 'ai_svc', 'citation_svc', 'jobs_svc', 'notes_svc', 'onenote_svc', 'retrieval_svc', 'voice_svc', 'web-server']
  },
  // The resource-server contract is the only thing the /mcp gateway and the authorization
  // server share; it must not lean on either side of it.
  { module: 'mcp/resource', forbidden: ['oauth_svc', 'web-server'] },
  {
    module: 'mailer_svc',
    forbidden: [
      'agent_svc',
      'ai_svc',
      'auth_svc',
      'citation_svc',
      'embeddings_svc',
      'jobs_svc',
      'notes_svc',
      'retrieval_svc',
      'user',
      'voice_svc'
    ]
  },
];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Matches both `import ... from '...'` and bare `import '...'`, type-only included. */
function importedPaths(source: string): string[] {
  const pattern = /(?:^|\n)\s*import\s[^;]*?['"]([^'"]+)['"]/g;
  return Array.from(source.matchAll(pattern), (m) => m[1]);
}

for (const rule of RULES) {
  test(`${rule.module} does not import ${rule.forbidden.join(' or ')}`, () => {
    const violations: string[] = [];
    for (const file of tsFilesUnder(join(SRC, rule.module))) {
      for (const specifier of importedPaths(readFileSync(file, 'utf8'))) {
        const target = rule.forbidden.find((f) => specifier.includes(`/${f}/`));
        if (target) violations.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
    assert.deepEqual(violations, [], `forbidden imports:\n  ${violations.join('\n  ')}`);
  });
}

/*
 * admin_svc is a read model over the domains, composed only by the web-server. A domain
 * importing it back would make every domain depend on every other one through it.
 */
const ADMIN_READ_MODEL = 'admin_svc';
const ADMIN_READ_MODEL_CALLERS = new Set([ADMIN_READ_MODEL, 'web-server']);

test(`only web-server imports ${ADMIN_READ_MODEL}`, () => {
  const violations: string[] = [];
  for (const module of readdirSync(SRC)) {
    if (ADMIN_READ_MODEL_CALLERS.has(module) || !statSync(join(SRC, module)).isDirectory()) continue;
    for (const file of tsFilesUnder(join(SRC, module))) {
      for (const specifier of importedPaths(readFileSync(file, 'utf8'))) {
        if (specifier.includes(`/${ADMIN_READ_MODEL}/`)) violations.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], `forbidden imports:\n  ${violations.join('\n  ')}`);
});

/*
 * Each OAuth repository has one owner: the class that keeps its collection's rules
 * (hashing, expiry, rotation, reuse detection). Everyone else goes through the owner, so
 * those rules cannot be skipped by reaching for the repository. Only the stores loader,
 * which hands each repository to its owner, may name them all.
 */
const OAUTH_REPOSITORY_OWNERS: Record<string, string> = {
  oauth_authorization_request_repository: 'oauth_svc/oauth_authorization_requests.ts',
  oauth_authorization_code_repository: 'oauth_svc/oauth_authorization_codes.ts',
  oauth_grant_repository: 'oauth_svc/oauth_grants.ts',
  oauth_token_repository: 'oauth_svc/oauth_token_families.ts'
};
const OAUTH_REPOSITORY_WIRING = 'oauth_svc/oauth_stores.ts';

test('each OAuth repository is used only by its owner', () => {
  const violations: string[] = [];
  for (const file of tsFilesUnder(SRC)) {
    const path = relative(SRC, file);
    if (path === OAUTH_REPOSITORY_WIRING || path.startsWith('oauth_svc/repositories/')) continue;
    for (const specifier of importedPaths(readFileSync(file, 'utf8'))) {
      for (const [repository, owner] of Object.entries(OAUTH_REPOSITORY_OWNERS)) {
        if (specifier.includes(repository) && path !== owner) violations.push(`${path} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], `only a repository's owner may use it:\n  ${violations.join('\n  ')}`);
});
