# citation_svc — grounding answers in sources

Turns the `[c:<chunk_id>]` markers an agent emits into verified, clickable references, and resolves them against live documents on every read.

Source: [src/citation_svc/](../src/citation_svc/). Callers: [agent_svc](agent_svc.md), which extracts on write and resolves on read. Consumed by the SPA's chat view ([web.md](web.md)).

```
answer text ──┐
              ├─► CitationExtractor ─► Citation[]  ──► persisted on the assistant message
tool payloads ┘        (markers ∩ retrieved chunks)

Citation[] ─► CitationSvc.resolve ─► DocumentResolver(corpus) ─► CitationView[]
                                          └─ NotesDocumentResolver ─► NotesSvc
```

---

## 1. The central idea: immutable past, mutable present

A citation points *from* permanent history (a conversation turn, which never changes) *into* mutable storage (documents that get renamed, edited, deleted). Everything here follows from deciding which side of that line each fact sits on.

**Stored** — only what cannot change:

```ts
type Citation = { index: number; chunk_id: string; document_id: string; corpus: Corpus };
```

**Never stored** — anything mutable, resolved fresh on every read:

```ts
type CitationView = Citation & {
  document_title: string; heading_path?: string[];
  document_available: boolean; chunk_available: boolean;
};
```

Why each stored field earns its place:

- `index` is a property of the answer text, which never changes — so chip numbers stay stable forever, rather than drifting as documents come and go.
- `document_id` looks redundant with `chunk_id`, but re-indexing prunes chunks. Without it, a re-indexed document leaves a dead reference with no way to know what it pointed at. Unlike a title, it is immutable.
- `corpus` is what makes resolution routable. `RetrievedChunk` already carries it; the extractor just reads it through.

The payoff is that **renaming a note updates every past answer that cited it**, because the old name was never written down anywhere.

## 2. Extraction — citations are verified, not claimed

`CitationExtractor.extract({ tool_payloads, answer_text })` intersects the markers in the answer with the chunks retrieval actually returned *that turn*. A marker matching nothing is dropped and the marker stripped, so **the model cannot fabricate a reference to a document it never saw**. Markers are numbered by first appearance and deduped.

`MARKER_SYNTAX` lives here and is interpolated into the [notes-recall seed prompt](../src/agent_svc/seeds/notes_recall_agent_seed.ts), so the regex and the prompt cannot drift. The MCP tool description deliberately does **not** prescribe the format — it says only that `chunk_id` is stable and safe to reference. A tool describes its data; the agent decides what referencing means.

**The input is plain data, not `Message[]`.** That is load-bearing: it is what stops `citation_svc` importing `agent_svc` and closing the dependency loop. `AgentSvc.toolPayloads` does the message-shape work on its side of the boundary.

## 3. Resolution — one registry per corpus

`CitationSvc` keeps a `Map<Corpus, DocumentResolver>`, keyed off each resolver's own `corpus` field and self-bootstrapped in `loadInstance()` — the same shape as `RetrievalSvc`'s corpus map ([patterns.md](patterns.md)). Self-bootstrap rather than external wiring means there is no registration step a caller can forget.

```ts
interface DocumentResolver {
  readonly corpus: Corpus;
  resolve(params: { user_id, document_ids, chunk_ids }): Promise<ResolvedDocuments>;
}
```

`resolveGroups` batches across a whole transcript: citations are grouped by corpus, each resolver is called **once** with the deduped ids, and results are mapped back. A conversation with fifty cited messages costs the same query budget as one.

**A missing resolver warns and degrades**, it does not throw — one unregistered corpus must not fail an entire conversation read. Note this differs from `RetrievalSvc.retrieve`, which throws on an unknown corpus; retrieval failing loudly is right for a search, but a citation is decoration on history.

## 4. Layering

```
agent_svc ──► citation_svc ──► notes_svc
                    └────────► retrieval_svc (type-only: Corpus)
```

`agent_svc` is a generic agent runtime and stays free of any domain module. `citation_svc` must never import `agent_svc`, or the chain becomes a cycle. Corpus implementations live under `corpora/` and are the only files that touch a domain service.

These are asserted, not just documented — [scripts/layering.test.ts](../scripts/layering.test.ts) scans imports and fails on a breach. Add a corpus implementation there when you add one here.

## 5. Degradation is a design state

A permanent reference into mutable storage dangles as a matter of course, so all three states are designed rather than treated as errors:

| State | `document_available` | `chunk_available` | UI |
| --- | --- | --- | --- |
| Both live | true | true | links to the passage, highlighted |
| Chunk pruned by re-indexing | true | false | links to the document, no highlight |
| Document deleted | false | false | muted, non-clickable, title reads `(deleted)` |

Numbering stays dense in every case, because `index` was fixed at extraction time.

## 6. Gotchas

- **Citations only exist for turns that ran through `runByAgentId`.** Conversations created before this feature have no `citations` field and render as plain text with markers stripped. The tool payloads are still in those transcripts, so a backfill script could recover them.
- **`runAdHoc` produces no citations** — it has no conversation and often no `user_id`. Extraction would work; resolution is user-scoped.
- **Resolution needs a `user_id`.** Without one, `AgentRunResponse.citations` is `undefined` rather than views with everything marked unavailable.
- **The persist path is best-effort.** `persistTurn` swallows write failures, so a caller can receive citations that were never saved and would vanish on reload. The response is not a receipt for the write.
- **`(deleted)` is corpus-neutral** by necessity — the service cannot assume "note". A corpus-specific label belongs in the client, where the corpus is known.
- **The SPA renders markers as markdown links, not as split text.** `CitationText.toMarkdown` rewrites each `[c:<id>]` into `[<index>](citation:<id>)` so the answer stays *one* markdown document, and `chat_message.tsx` swaps those links back into chips via a react-markdown `a` override. A marker with no matching citation is rewritten to the empty string. Anything that touches the marker syntax must keep the two in step.
- **The SPA links only corpora it has a route for.** `CORPUS_ROUTES` in [chat_message.tsx](../web/src/components/chat_message.tsx) maps `notes → /notes`; an unmapped corpus renders as a dead reference. Adding a corpus means adding a resolver *and* a route.

## 7. Extending: a second corpus

1. Implement `DocumentResolver` under `corpora/`, wrapping that domain's service. Keep both lookups user-scoped in the repository query, never in an application-layer check.
2. Register it in `CitationSvc.loadInstance()`.
3. Add the module pair to `scripts/layering.test.ts`.
4. Add its route to `CORPUS_ROUTES` in the SPA, and make sure the target view can accept a `?chunk=` deep link.

Retrieval must also emit `corpus` on its chunks for citations to route — `RawRetrievedChunk` already carries it, so a corpus that goes through `RetrievalSvc` gets this for free.
