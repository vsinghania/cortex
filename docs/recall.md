# recall — notes, chunking, embeddings, retrieval

The capture-and-recall pipeline: everything the user remembers lands in `notes_svc`, gets chunked and embedded on write, and comes back through `retrieval_svc` as ranked chunks an agent can cite.

Source: [src/notes_svc/](../src/notes_svc/), [src/embeddings_svc/](../src/embeddings_svc/), [src/retrieval_svc/](../src/retrieval_svc/). Callers: the [notes controller](../src/web-server/notes/notes.controller.ts) (REST) and the [notes MCP module](../src/mcp/server/notes/notes_mcp_module.ts) (tools) — both go through `NotesSvc`, so the two entry points cannot drift.

```
NotesSvc ─┬─► NoteRepository ─────────────────► Mongo (notes)
          ├─► NotesVectorizationSvc ─► chunk → embed → Mongo (chunks) + Qdrant (vectors)
          └─► RetrievalSvc ─► NotesCorpusRetriever ─► embed query → Qdrant → chunk text
```

---

## 1. Notes

`NotesSvc`: `listNotes`, `getNote`, `createNote`, `updateNote`, `deleteNote`, `searchNotes` (lexical), `retrieveChunks` (semantic), `revectorizeNote`.

A note is markdown plus provenance — `body` is canonical markdown, `body_raw` keeps the original artifact (imported HTML, a voice transcript). Notes come in two flavours, which is what `NoteLocator` encodes:

| | Native | Source-keyed |
| --- | --- | --- |
| Identity | `id` (UUIDv7) we generate | the `(source, external_id)` pair |
| Create | always inserts | **upserts** — re-importing a provider note updates it |
| Locator | `{ id }` | `{ id }` or `{ source, external_id }` |

**Every method is user-scoped at the repository level**, not by an application-layer check — these operations are exposed to an LLM over MCP, where `user_id` comes from a request header. Never add a repository method that omits it.

## 2. Chunking and vectorization

Writes persist first, then reconcile vectors best-effort: a dead provider or unreachable Qdrant leaves `vectorization.status = 'error'` and **never fails the note write**. Updates re-index only when `title` or `body` changed.

- **Chunking is heading-aware** — `MarkdownChunker` splits on markdown headings and packs blocks to `CHUNK_TARGET_TOKENS` with `CHUNK_OVERLAP_TOKENS` of carry-over, counting tokens with tiktoken so counts match what the model sees.
- **Re-indexing is incremental by content hash.** A chunk whose sha256 is unchanged and already embedded is reused; only changed chunks are re-embedded and chunks past the new count are pruned from both stores. This is why editing one paragraph of a long note is cheap.
- **An empty body is not an error** — it removes existing vectors and records `status: 'none'`.

## 3. Embeddings

Contract: `EmbeddingsSvcInterface` — `model`, `dimensions`, `embedTexts` (batch, for indexing), `embedQuery` (single, for search).

Why it is a service and not a helper: indexing and querying must use the same model or similarity is meaningless. Both sides read `model`/`dimensions` off the same singleton, and Qdrant sizes its collection from it at startup. Results carry the `model` that produced them so a chunk record can be checked later.

## 4. Retrieval

`RetrievalSvc` routes `retrieve(corpus, params)` to a registered `CorpusRetriever`, and `retrieveAcross` merges several by score. `Corpus` already declares `Notes`, `Chats` and `Voice`; only notes has a retriever today.

The module's central idea is **two chunk shapes**: `RawRetrievedChunk` is what retrieval returns (chunk and vector stores only — `document_id` and `source` are opaque strings), and `RetrievedChunk` adds `document_title`, supplied by the owning domain service. Retrieval deliberately stops at the chunk level; resolving a document id into a title or a permission check is the domain's job. That seam is what makes a second corpus cheap.

[citation_svc](citation_svc.md) mirrors that seam for display: it keeps its own `Map<Corpus, DocumentResolver>` so a cited chunk can be turned back into a current title without retrieval knowing anything about documents. A new corpus needs a retriever here and a resolver there.

**Qdrant ranks, Mongo supplies text.** The vector store holds only `{user_id, note_id, source}` payload, so a hit is joined back to its chunk row for content; a hit whose row is missing is skipped rather than returned empty. `top_k` is clamped to `[1, 20]`.

## 5. Gotchas

- **`ensureCollection` returns early when the collection exists** and does not check vector size. Changing `OPENAI_EMBEDDING_MODEL` across dimensions means dropping `note_chunks_vec` and re-vectorizing every note — nothing detects the mismatch.
- **A note with `vectorization.status = 'error'` saved fine but is not semantically searchable.** `revectorizeNote` is the repair.
- **Vectorization is inline with the write**, so note writes wait on OpenAI.
- **Deletes snapshot to trash first** — the note is copied to a TTL'd trash collection (30 days) before removal, but there is no restore path in the service, and chunks and vectors are dropped immediately.
- **`retrieveAcross` merges by score alone**, which assumes every corpus shares an embedding model and distance metric.
- **`NotesSvc.create()` is per request**, unlike the singletons around it.

## 6. Extending

- **New note field** → `Note` + the Mongoose schema + `NoteCreateInput`/`NotePatch`, then *both* boundary schemas (REST controller and MCP module) — they validate independently.
- **New importer** → add a `NoteSource` value and call `createNote` with `{ source, external_id }`; the upsert path makes re-imports idempotent.
- **New corpus** → implement `CorpusRetriever`, register it in `RetrievalSvc.loadInstance()`, and decorate raw chunks in the owning service.
- **New vector store** → implement `ChunkVectorRepository`; only `NotesVectorizationSvc` and `NotesCorpusRetriever` construct one.
