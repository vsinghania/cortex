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

`NotesSvc`: `listNotes`, `getNote`, `createNote`, `updateNote`, `deleteNote`, `deleteNotes` (batched), `bulkUpdate`, `deleteTag`, `searchNotes` (lexical), `retrieveChunks` (semantic), `revectorizeNote`. `NoteFoldersSvc` owns the folder tree.

A note is markdown plus provenance — `body` is canonical markdown, `body_raw` keeps the original artifact (imported HTML, a voice transcript). Notes come in two flavours, which is what `NoteLocator` encodes:

| | Native | Source-keyed |
| --- | --- | --- |
| Identity | `id` (UUIDv7) we generate | the `(source, external_id)` pair |
| Create | always inserts | **upserts** — re-importing a provider note updates it |
| Locator | `{ id }` | `{ id }` or `{ source, external_id }` |

### Organisation

- **Folders** live in `note_folders`, nested up to 8 levels. Each folder stores `ancestor_ids` (root first), so a subtree is one indexed match and a move rewrites descendants with a single pipeline update. Sibling names are unique ignoring case. A note points at one folder via `folder_id`; absent means unfiled. **Deleting a folder cascades** to every subfolder and every note beneath it, through the same trash-snapshotting delete as a single note.
- **Pinned, archived and filed are not edits.** Patches that touch only `is_pinned`, `is_archived` or `folder_id` skip Mongo timestamps (`NotePatchKind.isOrganizationalOnly`), as do bulk organise actions and `deleteTag`. Otherwise the default newest-updated list would reshuffle on every pin.
- **Lists hide archived notes by default** (`archived: exclude | only | include`), lead with pinned notes in every explicit sort (`updated_at`, `created_at`, `title` — title uses the case-insensitive collation), and keep relevance-first ordering for a text query with no explicit sort.

**Every method is user-scoped at the repository level**, not by an application-layer check — these operations are exposed to an LLM over MCP, where `user_id` comes from a request header. Never add a repository method that omits it.

## 2. Chunking and vectorization

Writes persist first, then reconcile vectors best-effort: a dead provider or unreachable Qdrant leaves `vectorization.status = 'error'` and **never fails the note write**. Updates re-index only when `title` or `body` changed.

- **Chunking is heading-aware** — `MarkdownChunker` splits on markdown headings and packs blocks to `CHUNK_TARGET_TOKENS` with `CHUNK_OVERLAP_TOKENS` of carry-over, counting tokens with tiktoken so counts match what the model sees.
- **Re-indexing is incremental by content hash.** A chunk whose sha256 is unchanged and already embedded is reused; only changed chunks are re-embedded and chunks past the new count are pruned from both stores. This is why editing one paragraph of a long note is cheap.
- **An empty body is not an error** — it removes existing vectors and records `status: 'none'`.
- **Archive state is mirrored onto vectors.** Points carry `is_archived`, written on embed and pushed with Qdrant `setPayload` whenever a note is archived or unarchived (reused chunks are never re-upserted, so the payload update is the only path).

## 3. Embeddings

Contract: `EmbeddingsSvcInterface` — `model`, `dimensions`, `embedTexts` (batch, for indexing), `embedQuery` (single, for search).

Why it is a service and not a helper: indexing and querying must use the same model or similarity is meaningless. Both sides read `model`/`dimensions` off the same singleton, and Qdrant sizes its collection from it at startup. Results carry the `model` that produced them so a chunk record can be checked later.

## 4. Retrieval

`RetrievalSvc` routes `retrieve(corpus, params)` to a registered `CorpusRetriever`, and `retrieveAcross` merges several by score. `Corpus` already declares `Notes`, `Chats` and `Voice`; only notes has a retriever today.

The module's central idea is **two chunk shapes**: `RawRetrievedChunk` is what retrieval returns (chunk and vector stores only — `document_id` and `source` are opaque strings), and `RetrievedChunk` adds `document_title`, supplied by the owning domain service. Retrieval deliberately stops at the chunk level; resolving a document id into a title or a permission check is the domain's job. That seam is what makes a second corpus cheap.

[citation_svc](citation_svc.md) mirrors that seam for display: it keeps its own `Map<Corpus, DocumentResolver>` so a cited chunk can be turned back into a current title without retrieval knowing anything about documents. A new corpus needs a retriever here and a resolver there.

**Archived notes are excluded** with a `must_not is_archived = true` filter unless `include_archived` is set; points written before the flag existed have no key and still match.

**Qdrant ranks, Mongo supplies text.** The vector store holds only `{user_id, note_id, source, is_archived}` payload, so a hit is joined back to its chunk row for content; a hit whose row is missing is skipped rather than returned empty. `top_k` is clamped to `[1, 20]`.

## 5. Gotchas

- **`ensureCollection` returns early when the collection exists** and does not check vector size. Changing `OPENAI_EMBEDDING_MODEL` across dimensions means dropping `note_chunks_vec` and re-vectorizing every note — nothing detects the mismatch.
- **A note with `vectorization.status = 'error'` saved fine but is not semantically searchable.** `revectorizeNote` is the repair.
- **Chunk ids are stable across re-indexing, and must stay that way.** `vectorizeNote` reuses the id at each chunk index rather than minting a new one, because stored citations reference chunk ids ([citation_svc.md](citation_svc.md)). `revectorizeNote` forces a full re-embed via `force_embed` instead of deleting the chunks first — deleting would regenerate every id and orphan the citations pointing at them.
- **Vectorization is inline with the write**, so note writes wait on OpenAI.
- **Deletes snapshot to trash first** — the note is copied to a TTL'd trash collection (30 days) before removal, but there is no restore path in the service, and chunks and vectors are dropped immediately.
- **Run `npm run notes:backfill-organization` once per environment after deploying folders/pins.** Notes written before `is_pinned` existed have no field, and Mongo sorts missing below `false`, so the pinned-first sort would split old and new notes. It also syncs `is_archived` onto vectors of notes archived before the flag reached Qdrant.
- **Folder moves are two writes, not a transaction** — the folder, then its descendants' `ancestor_ids`. A crash between them leaves descendants with a stale chain (wrong subtree listings and depth checks) that nothing repairs automatically.
- **`retrieveAcross` merges by score alone**, which assumes every corpus shares an embedding model and distance metric.
- **`NotesSvc.create()` is per request**, unlike the singletons around it.

## 6. Extending

- **New note field** → `Note` + the Mongoose schema + `NoteCreateInput`/`NotePatch`, then *both* boundary schemas (REST controller and MCP module) — they validate independently.
- **New importer** → add a `NoteSource` value and call `createNote` with `{ source, external_id }`; the upsert path makes re-imports idempotent.
- **New corpus** → implement `CorpusRetriever`, register it in `RetrievalSvc.loadInstance()`, and decorate raw chunks in the owning service.
- **New vector store** → implement `ChunkVectorRepository`; only `NotesVectorizationSvc` and `NotesCorpusRetriever` construct one.
