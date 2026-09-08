# agent_svc

LLM agent runtime. Owns the lifecycle of agents (build → compile → run), the tools they can call, the MCP servers they talk to, and the conversation history they accumulate.

Source: [src/agent_svc/](../src/agent_svc/). Consumed by [agent.controller.ts](../src/web-server/agent/agent.controller.ts) and by scripts.

---

## 1. Contract

[agent_svc_interface.ts](../src/agent_svc/agent_svc_interface.ts):

```ts
interface AgentSvcInterface {
  createAgent(input: CreateAgentInput): Promise<AgentManifest>;
  updateAgent(input: UpdateAgentInput): Promise<AgentManifest>;
  runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse>;
  runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse>;
  listConversations(input: ListConversationsInput): Promise<Conversation[]>;
  getConversation(input: GetConversationInput): Promise<ConversationWithMessages>;
}
```

`runByAgentId` persists the conversation; `runAdHoc` (manifest + tools supplied inline) never does — it is for tests and scripts. Everything else — picking the LLM SDK, wiring tools and sub-agents, connecting MCP servers — is internal.

## 2. Mental model

An agent is a **stored manifest** plus a **runtime object** wrapping a vendor SDK (today the OpenAI Agents SDK). The manifest is the design surface:

| Field | Meaning |
| --- | --- |
| `instructions`, `model` | the prompt and the model |
| `tool_names` | registered function tools it may call |
| `tool_agent_ids` | child agents callable as tools (delegation — parent stays in control) |
| `handoff_agent_ids` | child agents that can take over the turn (routing) |
| `mcp_server_ids` | MCP servers to attach |
| `engine` | which adapter (`AgentEngine.OpenAi` only today) |
| `output_schema` | optional JSON Schema for structured final output |

```
AgentSvc ──► AgentRegistry ──► BaseAgent (OpenAiAgent)
    │                              ├─ ToolRegistry (function tools)
    │                              ├─ McpServerRegistry (MCP handles)
    │                              └─ sub-agents (tool_agents, handoffs)
    └────► ConversationStore ──► Mongo
```

## 3. Design notes

- **Agents are data, not code.** New agents are manifest rows; `createAgent`/`updateAgent` write one and refresh the registry immediately. A row written directly to Mongo appears within the 10-minute refresh.
- **The graph is built in three passes** — build instances → wire sub-agents → compile — because pass 2 must reference agents that did not exist during pass 1. Compilation then walks sub-agents lazily through `getSdkAgent()`, so **cyclic agent graphs are legal**.
- **A bad manifest drops one agent, not the boot.** Unknown tool, failed MCP connect or failed compile logs a `warn` and skips that agent; the registry swaps its map atomically.
- **`BaseAgent` instances are shared across requests.** Never store per-call state on `this`.
- **Two MCP modes.** `SelfHosted` — we open the streamable-HTTP connection and own its lifecycle. `PublicHosted` — registered as a hosted MCP tool, no connection from us. Auth comes from `http.auth_token_env` read at refresh time; a missing env var skips that server with a warning.
- **Cross-engine sub-agents are not supported** — mismatched engines are skipped with a warning.
- **Conversation continuity rides on `previous_response_id`.** `appendTurn` stores the user and assistant messages plus the response id that the next call replays. A new conversation also gets a title from [ai_svc](ai_svc.md).
- **Tool results are normalized on the way in.** `OpenAiSdkUtils.toToolContent` parses the result once and stores it as a `{type:'json'}` content part, because the agents SDK discards MCP `structuredContent` and hands back a stringified blob (see [mcp.md](mcp.md)). Consumers read the payload; they do not re-parse strings.
- **Citations are extracted here but owned elsewhere.** `runByAgentId` hands this turn's tool payloads and the answer text to [citation_svc](citation_svc.md), persists the returned ids on the assistant message, and resolves them before returning. `getConversation` resolves the whole transcript in one pass. The boundary is plain data — `AgentSvc.toolPayloads` does the message-shape work — so agent_svc stays free of any domain module, an invariant [scripts/layering.test.ts](../scripts/layering.test.ts) enforces.

## 4. Tools

A tool is `{ name, description, input_schema (Zod), execute(args, ctx) }` returning a `text | json | error` result. Register it in `ToolRegistry.registerBuiltins()` and name it in a manifest's `tool_names`; `resolveAll` throws on an unknown name, which is what skips the agent at build time. Reference: [ping_tool.ts](../src/agent_svc/tools/builtin/ping_tool.ts).

MCP tools arrive differently — attached whole from `mcp_server_ids`, not registered per tool. See [mcp.md](mcp.md).

## 5. Gotchas

- **The `notes` MCP server manifest is not seeded** while the `notes-recall` agent depends on it — see [architecture.md §8](architecture.md#8-known-rough-edges). Symptom: the agent answers without ever searching.
- **`MaxTurnsExceededError` is not an error.** It maps to `stop_reason: 'max_turns'` (default 10 turns), so a truncated run looks like a successful one — check `stop_reason`.
- **Persistence failures do not fail a run.** The model answered; the turn may simply not be in Mongo.
- **`AgentSvc` holds no state.** It pulls registries via `getInstance()` per call, so constructing it per request is fine.

## 6. Extending

- **New tool** → implement `Tool`, register in `ToolRegistry`, add its name to a manifest.
- **New agent** → insert a manifest row, or `POST /api/v1/agent` as admin.
- **New MCP server** → insert an `McpServerManifest`, add its id to a manifest.
- **New engine** → add an `AgentEngine` value, subclass `BaseAgent` (`onCompile`/`onRun`), extend the switch in [agent_factory.ts](../src/agent_svc/factory/agent_factory.ts).
