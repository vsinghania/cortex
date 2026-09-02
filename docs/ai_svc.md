# ai_svc

Single-shot LLM calls: messages in, text or a schema-validated object out. No tools, no history, no persistence — that is [agent_svc](agent_svc.md).

Source: [src/ai_svc/](../src/ai_svc/). Callers: `POST /api/v1/ai/generate` and `/generate-structured`, and `ConversationTitleGenerator` in agent_svc.

---

## 1. Contract

```ts
interface AiSvcInterface {
  generateText(req: GenerateTextRequest): Promise<GenerateTextResponse>;
  generateStructured<T>(req: GenerateStructuredRequest): Promise<GenerateStructuredResponse<T>>;
}
```

Both take `messages`, an optional `provider`, and optional `options` (`model`, `max_tokens`, `temperature`, `timeout_ms`, `retries`); both return the result plus the `model` used and token `usage`.

## 2. Design notes

- **Structured output has three input modes**, unified by `StructuredSchemaSource` into one adapter-facing format: `registered` (looked up by name in `StructuredSchemaRegistry`), `zod` (passed in-process), and `json_schema` (a raw schema object).
- **The HTTP boundary accepts only `schema_name`.** An untrusted caller can name a server-side schema but cannot push an arbitrary one through the model; an unknown name is a `NotFoundError` → 404.
- **Provider choice is an enum lookup** in `AdapterRegistry`, so a second provider is an adapter plus a map entry.
- **Every call is wrapped in timeout + retry** inside the adapter, with the model and attempt count logged on success.

## 3. Gotchas

- **Retries are unconditional.** A malformed request is retried the full `retries` count before failing, because no distinction is made between a timeout and a 400.
- **Errors are not translated** — an OpenAI failure reaches the error middleware as a 500. Only unknown schema names produce a typed error.
- **Prompts and completions are never logged**, by convention. Debugging a bad generation means reproducing it, not reading logs.

## 4. Extending

- **A schema for HTTP callers** → define it in `StructuredSchemaRegistry.buildDefaultSchemas()`, then call with `schema_name`.
- **A provider** → add the value to `GenAiProviderSchema` (it is the HTTP-visible enum too), implement `GenAiAdapter`, register it.
