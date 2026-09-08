import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownChunker } from '../src/lib/text/markdown_chunker.js';

const OPTS = { target_tokens: 64, overlap_tokens: 8 };

test('chunk offsets point at the chunk material in the source body', () => {
  const body = [
    '# Caching',
    '',
    'We dropped Redis because the hit rate never justified the extra hop.',
    '',
    '## Follow-ups',
    '',
    'Revisit once the read volume triples.'
  ].join('\n');

  const specs = MarkdownChunker.chunk(body, OPTS);
  assert.ok(specs.length >= 2, 'heading change should split the body');

  for (const spec of specs) {
    assert.ok(Number.isInteger(spec.start_offset), 'start_offset is an integer');
    assert.ok(Number.isInteger(spec.end_offset), 'end_offset is an integer');
    assert.ok(spec.start_offset >= 0 && spec.end_offset <= body.length, 'offsets stay in range');
    assert.ok(spec.end_offset > spec.start_offset, 'range is non-empty');
    // A chunk may prepend an overlap tail borrowed from its predecessor; the offsets
    // describe only its own material, which is always the trailing part of the content.
    assert.ok(
      spec.content.endsWith(body.slice(spec.start_offset, spec.end_offset)),
      `content should end with its own offset range: ${spec.content}`
    );
  }

  assert.equal(
    body.slice(specs[0].start_offset, specs[0].end_offset),
    specs[0].content,
    'the first chunk borrows no tail, so its range covers all of it'
  );
});

test('offsets advance monotonically across chunks', () => {
  const paragraph = 'The migration ran clean on staging and the rollback path was exercised twice. ';
  const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${paragraph}`).join('\n\n');

  const specs = MarkdownChunker.chunk(body, OPTS);
  assert.ok(specs.length > 1, 'body should span several chunks');

  for (let i = 1; i < specs.length; i++) {
    assert.ok(
      specs[i].start_offset >= specs[i - 1].start_offset,
      `chunk ${i} starts at or after chunk ${i - 1}`
    );
    assert.ok(specs[i].end_offset > specs[i - 1].end_offset, `chunk ${i} extends past chunk ${i - 1}`);
  }
});

test('an oversized block is split into ranges inside the block', () => {
  const long_line = Array.from({ length: 300 }, (_, i) => `token${i}`).join(' ');
  const body = `# Notes\n\n${long_line}`;

  const specs = MarkdownChunker.chunk(body, OPTS);
  assert.ok(specs.length > 1, 'a single oversized block should split');

  const block_start = body.indexOf(long_line);
  const block_end = block_start + long_line.length;
  for (const spec of specs) {
    assert.ok(spec.start_offset >= block_start, 'piece starts inside the block');
    assert.ok(spec.end_offset <= block_end, 'piece ends inside the block');
  }
});

test('CRLF bodies keep offsets aligned to the source', () => {
  const body = '# Title\r\n\r\nFirst paragraph here.\r\n\r\n## Second\r\n\r\nSecond paragraph here.';

  const specs = MarkdownChunker.chunk(body, OPTS);
  assert.ok(specs.length >= 2);

  for (const spec of specs) {
    // Rejoined content normalizes CRLF to LF, so compare on the normalized slice.
    const sliced = body.slice(spec.start_offset, spec.end_offset).replace(/\r\n/g, '\n');
    assert.ok(spec.content.endsWith(sliced), `content should end with ${sliced}`);
  }
});

test('the overlap tail does not drag a chunk range backwards', () => {
  const body = Array.from(
    { length: 8 },
    (_, i) => `Section ${i} covers a distinct topic with enough words to fill out the budget nicely.`
  ).join('\n\n');

  const specs = MarkdownChunker.chunk(body, OPTS);
  assert.ok(specs.length > 1);

  for (let i = 1; i < specs.length; i++) {
    assert.ok(
      specs[i].start_offset >= specs[i - 1].end_offset,
      'chunk ranges do not overlap even when the text does'
    );
  }
});
