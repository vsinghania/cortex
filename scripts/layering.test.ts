/*
 * Enforces the module dependency directions the citation design rests on.
 *
 *   agent_svc ──→ citation_svc ──→ notes_svc
 *
 * agent_svc stays domain-agnostic, and citation_svc must never import agent_svc or the
 * chain becomes a cycle. These are conventions that are easy to breach one import at a
 * time, so they are asserted rather than documented.
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
  { module: 'notes_svc', forbidden: ['agent_svc', 'citation_svc'] },
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
