import assert from 'node:assert/strict';
import test from 'node:test';
import { CitationExtractor } from '../src/citation_svc/citation_extractor.js';
import { Corpus } from '../src/retrieval_svc/types/retrieval.types.js';

// Payloads carry title/snippet/heading fields; the extractor must ignore them, since
// those are joined from live data at response time rather than stored.
const CHUNK_A = {
  chunk_id: 'chunk-a',
  document_id: 'note-1',
  corpus: Corpus.Notes,
  document_title: 'Caching decisions',
  chunk_index: 0,
  heading_path: ['Caching'],
  snippet: 'We dropped Redis.',
};

const CHUNK_B = {
  chunk_id: 'chunk-b',
  document_id: 'note-2',
  corpus: Corpus.Notes,
  document_title: 'Sprint 12',
  chunk_index: 3,
  snippet: 'Revisit once read volume triples.',
};

test('stores identity only, dropping presentation fields from the payload', () => {
  const citations = CitationExtractor.extract({
    tool_payloads: [{ chunks: [CHUNK_A] }],
    answer_text: 'We dropped Redis [c:chunk-a].',
  });

  assert.equal(citations.length, 1);
  assert.deepEqual(citations[0], {
    index: 1,
    chunk_id: 'chunk-a',
    document_id: 'note-1',
    corpus: Corpus.Notes,
  });
});

test('carries the corpus through from the retrieval payload', () => {
  const [citation] = CitationExtractor.extract({
    tool_payloads: [{ chunks: [{ chunk_id: 'c', document_id: 'd', corpus: Corpus.Chats }] }],
    answer_text: 'From a chat [c:c].',
  });

  assert.equal(citation.corpus, Corpus.Chats);
});

test('defaults to notes when a payload predates the corpus field', () => {
  const [citation] = CitationExtractor.extract({
    tool_payloads: [{ chunks: [{ chunk_id: 'c', document_id: 'd' }] }],
    answer_text: 'Legacy payload [c:c].',
  });

  assert.equal(citation.corpus, Corpus.Notes);
});

test('resolves several markers in order', () => {
  const citations = CitationExtractor.extract({
    tool_payloads: [{ chunks: [CHUNK_A, CHUNK_B] }],
    answer_text: 'We dropped Redis [c:chunk-a] and will revisit later [c:chunk-b].',
  });

  assert.deepEqual(
    citations.map((c) => [c.index, c.chunk_id, c.document_id]),
    [
      [1, 'chunk-a', 'note-1'],
      [2, 'chunk-b', 'note-2'],
    ]
  );
});

test('numbers by first appearance and dedupes repeats', () => {
  const citations = CitationExtractor.extract({
    tool_payloads: [{ chunks: [CHUNK_A, CHUNK_B] }],
    answer_text: 'Later point [c:chunk-b]. Earlier point [c:chunk-a]. Again [c:chunk-b].',
  });

  assert.deepEqual(
    citations.map((c) => [c.index, c.chunk_id]),
    [
      [1, 'chunk-b'],
      [2, 'chunk-a'],
    ]
  );
});

test('drops markers with no matching retrieved chunk', () => {
  const citations = CitationExtractor.extract({
    tool_payloads: [{ chunks: [CHUNK_A] }],
    answer_text: 'Known [c:chunk-a] and hallucinated [c:chunk-zzz].',
  });

  assert.deepEqual(citations.map((c) => c.chunk_id), ['chunk-a']);
});

test('returns nothing when the answer cites nothing', () => {
  assert.deepEqual(
    CitationExtractor.extract({
      tool_payloads: [{ chunks: [CHUNK_A] }],
      answer_text: 'A plain answer with no markers.',
    }),
    []
  );
});

test('tolerates unrelated and malformed tool payloads', () => {
  const citations = CitationExtractor.extract({
    tool_payloads: [
      undefined,
      'not an object',
      { total: 4, items: [] },
      { chunks: [{ missing: 'fields' }] },
      { chunks: [CHUNK_A] },
    ],
    answer_text: 'Cited [c:chunk-a].',
  });

  assert.deepEqual(citations.map((c) => c.chunk_id), ['chunk-a']);
});
