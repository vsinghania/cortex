# agent_svc

LLM agent runtime for the Cortex backend. Owns the lifecycle of agents (build → compile → run), the tools they can call, the MCP servers they can talk to, and the conversation history they accumulate.

This document is the entry point for anyone new to the module. It covers what the service does, how it is structured, and the typical paths a request flows through.

---

## 1. What it does

`agent_svc` exposes a small surface to the rest of the app:

- **Run an agent by id** against a string prompt or a chat history. Conversations are persisted by default.
- **Run an ad-hoc agent** built on the fly from a manifest + tools (used by tests / scripts; not persisted).
- **List / fetch conversations** for a user.

Everything else — picking the LLM SDK, wiring tools, sub-agents, MCP servers, persisting turns — is internal.

The public surface lives in [src/agent_svc/agent_svc_interface.ts](../src/agent_svc/agent_svc_interface.ts):

```ts
interface AgentSvcInterface {
  runByAgentId(input: RunByAgentIdInput): Promise<AgentRunResponse>;
  runAdHoc(input: RunAdHocInput): Promise<AgentRunResponse>;
  listConversations(input: ListConversationsInput): Promise<Conversation[]>;
  getConversation(input: GetConversationInput): Promise<ConversationWithMessages>;
}
```

The implementation is [src/agent_svc/agent_svc.ts](../src/agent_svc/agent_svc.ts), constructed via `AgentSvc.create()` (async factory; no public constructor).

The HTTP layer is thin and just adapts `AgentSvc` — see [src/web-server/agent/agent.controller.ts](../src/web-server/agent/agent.controller.ts).

---

## 2. Mental model

An **agent** in this service is a stored configuration (`AgentManifest`) plus a runtime object (`BaseAgent`) that wraps a vendor LLM SDK (currently the OpenAI Agents SDK).

A manifest declares:

- `instructions` and `model`
- `tool_names` — names of registered function tools the agent may call
- `tool_agent_ids` — child agents callable as tools (delegation)
- `handoff_agent_ids` — child agents the LLM may hand the turn off to
- `mcp_server_ids` — MCP servers (self-hosted or public-hosted) to attach
- `implementation` — which adapter to use (currently only `openai_agents`)

At process startup the registries are warmed once. A request then resolves an agent by id and calls `run()` on it; the service handles persisting the conversation turn afterwards.

```
HTTP / caller
    │
    ▼
AgentSvc ────► AgentRegistry ──► BaseAgent (OpenAiAgent)
    │                                  │
    │                                  ├─ ToolRegistry (function tools)
    │                                  ├─ McpServerRegistry (MCP handles)
    │                                  └─ sub-agents (tool_agents, handoffs)
    │
    └────► ConversationStore ──► Mongo (conversations + messages)
```

---

## 3. Directory layout

[src/agent_svc/](../src/agent_svc/)

| Path | Role |
| --- | --- |
| [agent_svc.ts](../src/agent_svc/agent_svc.ts) | Public service. Orchestrates registry lookup, conversation load, agent run, turn persistence. |
| [agent_svc_interface.ts](../src/agent_svc/agent_svc_interface.ts) | Service contract + input/output types. |
| [agents/base_agent.ts](../src/agent_svc/agents/base_agent.ts) | Abstract base class. Holds manifest, tools, sub-agents, MCP handles. Defines `compile()` / `run()` lifecycle. |
| [agents/openai/](../src/agent_svc/agents/openai/) | Concrete adapter built on `@openai/agents`. |
| [factory/agent_factory.ts](../src/agent_svc/factory/agent_factory.ts) | Picks a concrete `BaseAgent` subclass based on `manifest.implementation`. |
| [registry/agent_registry.ts](../src/agent_svc/registry/agent_registry.ts) | Process-wide singleton. Loads enabled manifests, builds + wires + compiles all agents. |
| [registry/mcp_server_registry.ts](../src/agent_svc/registry/mcp_server_registry.ts) | Process-wide singleton. Connects to MCP servers and exposes handles by id. |
| [tools/tool_registry.ts](../src/agent_svc/tools/tool_registry.ts) | In-memory registry of function tools, keyed by name. |
| [tools/builtin/](../src/agent_svc/tools/builtin/) | First-party tools (e.g. `ping`). |
| [conversation/conversation_store.ts](../src/agent_svc/conversation/conversation_store.ts) | Persistence facade for conversations + messages. |
| [conversation/mongoose_conversation_repository.ts](../src/agent_svc/conversation/mongoose_conversation_repository.ts) | Mongoose impl of the repository. |
| [repositories/](../src/agent_svc/repositories/) | Mongoose repos for `AgentManifest` and `McpServerManifest`. |
| [models/](../src/agent_svc/models/) | Mongoose schemas. |
| [types/](../src/agent_svc/types/) | Domain types and Zod schemas (`agent.types.ts`, `conversation.types.ts`, `mcp_server.types.ts`, `agent_manifest.schema.ts`, `mcp_server.schema.ts`). |

---

## 4. Core types (cheat sheet)

From [types/agent.types.ts](../src/agent_svc/types/agent.types.ts):

- **`AgentManifest`** — persisted, declarative shape of an agent.
- **`Tool<TArgs>`** — `{ name, description, input_schema (Zod), execute(args, ctx) }`. Tools return a `ToolResult` discriminated union (`text` / `json` / `error`).
- **`AgentRunRequest`** — `{ input: string | PromptMessage[], message_history?, conversation_id?, user_id?, previous_response_id?, options? }`.
- **`AgentRunResponse`** — `{ final_output_text, message_history, tool_calls, usage, model, response_id, conversation_id, stop_reason }`.
- **`AgentRunOptions`** — `{ max_turns, temperature, max_tokens, timeout_ms, retries }`. The OpenAI adapter currently respects `max_turns` (default 10).
- **`AgentImplKind`** — enum of supported adapters; today `OpenAiAgents` only.

From [types/mcp_server.types.ts](../src/agent_svc/types/mcp_server.types.ts):

- **`McpServerManifest`** — `{ mcp_server_id, name, mode, transport, http, enabled, ... }`.
- **`McpServerMode`** — `SelfHosted` (we connect via streamable HTTP and pass the SDK server to the agent) or `PublicHosted` (registered as a hosted MCP tool).

---

## 5. Lifecycle: from boot to response

### 5.1 Boot — `AgentSvc.create()`

[agent_svc.ts:37](../src/agent_svc/agent_svc.ts#L37) eagerly initializes three process-wide singletons:

1. `ToolRegistry.getInstance()` — registers built-in tools synchronously.
2. `AgentRegistry.getInstance()` — async; this internally:
   - waits on `McpServerRegistry.getInstance()` (connects to all enabled MCP servers),
   - calls `refresh()` to load all enabled `AgentManifest`s and build the agent graph.
3. `ConversationStore.getInstance()` — opens the mongoose repo.

After `create()`, `AgentSvc` itself holds no state; it pulls the registries via `getInstance()` at each call site.

### 5.2 Building the agent graph — `AgentRegistry.refresh()`

A three-pass build, see [registry/agent_registry.ts:54](../src/agent_svc/registry/agent_registry.ts#L54):

1. **Build instances.** For each enabled manifest, resolve `tool_names` against `ToolRegistry` and `mcp_server_ids` against `McpServerRegistry`, then call `AgentFactory.forManifest(...)` to construct a `BaseAgent` subclass. Failures (e.g. unknown tool) are logged and the agent is skipped.
2. **Wire sub-agents.** Walk the manifests again and call `agent.setSubAgents({ tool_agents, handoff_agents })`. Doing this in a separate pass lets the graph reference agents that hadn't been built yet during pass 1, including cycles.
3. **Compile.** Each agent's `compile()` calls the adapter's `onCompile()` (vendor-side setup). The OpenAI adapter walks sub-agents lazily via `getSdkAgent()`, which itself calls `compile()` — so cycles are tolerated.

The result is a `Map<agent_id, BaseAgent>` cached for the process lifetime. Re-run `refresh()` to pick up manifest changes; the registry replaces the map atomically.

### 5.3 Running — `runByAgentId`

[agent_svc.ts:45](../src/agent_svc/agent_svc.ts#L45):

1. Resolve the agent from `AgentRegistry`.
2. `ConversationStore.ensureConversation(...)` — load existing or create new (uuid).
3. `loadHistory(...)` — pull all non-system messages and convert to `PromptMessage[]`.
4. Build an `AgentRunRequest` (carries history, `previous_response_id`, options) and call `agent.run(req)`.
5. `persistTurn(...)` — append the user message + assistant message (with tool calls, usage, model, response id) and update `last_response_id`. Persistence failures are logged but do not fail the request.

### 5.4 Inside `BaseAgent.run`

[agents/base_agent.ts:88](../src/agent_svc/agents/base_agent.ts#L88) ensures `compile()` has been called and delegates to the abstract `onRun(req)`. `BaseAgent` instances are shared across requests — never store per-call state on `this`.

The OpenAI adapter ([agents/openai/openai_agent.ts](../src/agent_svc/agents/openai/openai_agent.ts)):

- `onCompile()` builds an `Agent` from `@openai/agents` with:
  - function tools (mapped from our `Tool` interface; Zod schema becomes the parameters schema, results serialized via `OpenAiSdkUtils.serializeToolResult`),
  - tool-agent tools (each child becomes a delegated tool via `child_sdk.asTool(...)`),
  - hosted MCP tools (`McpServerMode.PublicHosted`),
  - self-hosted MCP servers (`McpServerMode.SelfHosted`) attached as `mcpServers`,
  - handoffs (other agents as full handoff targets).
- `onRun()` constructs the SDK input (string for the simple case, otherwise a flattened history+latest array via `OpenAiSdkUtils.toSdkInput`), calls `runAgent(...)` with `maxTurns`, then converts the SDK result into our `AgentRunResponse`. `MaxTurnsExceededError` is mapped to `stop_reason: 'max_turns'` rather than an exception.

---

## 6. Tools

A tool is anything implementing the `Tool` interface from [types/agent.types.ts](../src/agent_svc/types/agent.types.ts):

```ts
class MyTool implements Tool<MyArgs> {
  readonly name = 'my_tool';
  readonly description = '...';
  readonly input_schema = MyArgsSchema; // zod
  async execute(args: MyArgs, ctx: ToolContext): Promise<ToolResult> { ... }
}
```

To make it available:

1. Implement under [tools/builtin/](../src/agent_svc/tools/builtin/) (or wherever appropriate).
2. Register it from `ToolRegistry.registerBuiltins()` in [tools/tool_registry.ts](../src/agent_svc/tools/tool_registry.ts).
3. Add the tool's `name` to the relevant agent manifest's `tool_names`.

`ToolRegistry.resolveAll([...])` throws `NotFoundError` on any unknown name; the agent is then skipped during registry refresh (logged warning).

Reference implementation: [tools/builtin/ping_tool.ts](../src/agent_svc/tools/builtin/ping_tool.ts).

---

## 7. MCP servers

MCP servers are configured via `McpServerManifest` rows. The registry decides what to do per `mode`:

- **`SelfHosted`** — opens `MCPServerStreamableHttp(url, headers)`, calls `connect()`, then exposes the SDK server via `mcpServers` on the OpenAI agent. We own the connection lifecycle and close it on refresh.
- **`PublicHosted`** — wraps `hostedMcpTool(...)` from the SDK and surfaces it as a tool to the agent. No network connection from us.

Auth: if `http.auth_token_env` is set, the value is read from `process.env` at refresh time and passed as `Authorization: Bearer <value>`. Missing env var fails the build for that one server (warning logged, server skipped). Additional static headers can come from `http.headers`.

To add an MCP server: insert a row through the repo / admin path, then call `McpServerRegistry.refresh()` (or restart the process) and add its `mcp_server_id` to an agent manifest.

---

## 8. Sub-agents: `tool_agents` vs `handoff_agents`

Both are lists of agent ids that another agent can use, and both must point to agents that exist in the registry:

| | `tool_agents` | `handoff_agents` |
| --- | --- | --- |
| Mechanism | Child agent is exposed as a callable tool. Parent stays in control. | Parent can hand off the turn to the child. The child then drives the conversation. |
| Use when | You want delegation — the parent calls the sub-agent like a function, gets a result, continues. | You want routing — once the right agent is chosen, it owns the turn end-to-end. |
| Cross-implementation | Not supported. Mismatched implementations are skipped with a warning. | Same. |

Cycles are allowed; they're handled by lazy compile through `OpenAiAgent.getSdkAgent()`.

---

## 9. Conversation persistence

[conversation/conversation_store.ts](../src/agent_svc/conversation/conversation_store.ts) is the only place that talks to the conversation repo.

- `ensureConversation` — load by id or create a new one with a uuid.
- `loadHistory` — returns non-system `PromptMessage[]`, oldest first.
- `appendTurn` — inserts the user message + assistant message as two consecutive `turn` numbers and updates `last_response_id` for the next call's `previous_response_id`.
- `listForUser` / `getForUser` / `listMessages` — read paths used by the controller.

Schema: see [models/conversation_model.ts](../src/agent_svc/models/conversation_model.ts) and the types in [types/conversation.types.ts](../src/agent_svc/types/conversation.types.ts).

`runByAgentId` always persists. `runAdHoc` never does — it's meant for tests/scripts where you want to exercise an agent without polluting Mongo.

---

## 10. Adding things — quick recipes

**A new function tool**
1. Implement `Tool` under `src/agent_svc/tools/...`.
2. Register it in `ToolRegistry.registerBuiltins()`.
3. Add its `name` to one or more agent manifests' `tool_names`.
4. `AgentRegistry.refresh()` (or restart) to pick up the change.

**A new agent**
1. Insert an `AgentManifest` row (`enabled: true`, point at existing tool names / sub-agent ids / MCP server ids).
2. `AgentRegistry.refresh()` (or restart).
3. Call `runByAgentId({ agent_id, input })`.

**A new MCP server**
1. Insert a `McpServerManifest`. For self-hosted, set `http.base_url` (and `auth_token_env` if needed). For public-hosted, same fields.
2. `McpServerRegistry.refresh()` then `AgentRegistry.refresh()` — or restart.
3. Add the `mcp_server_id` to whichever agents need it.

**A new agent implementation (e.g. an Anthropic adapter)**
1. Add a value to `AgentImplKind` in [types/agent.types.ts](../src/agent_svc/types/agent.types.ts).
2. Subclass `BaseAgent` (override `onCompile` and `onRun`).
3. Extend the `switch` in [factory/agent_factory.ts](../src/agent_svc/factory/agent_factory.ts).
4. Note: cross-implementation `tool_agents` / `handoff_agents` are intentionally not supported today.

---

## 11. Operational notes

- **Singletons.** `AgentRegistry`, `McpServerRegistry`, and `ConversationStore` are process-wide. The first `getInstance()` call drives bootstrap; subsequent callers wait on the same in-flight promise. Don't construct them yourself.
- **`AgentSvc` itself is cheap.** It holds no state — `AgentSvc.create()` is fine to call per request, and the controller does (it returns immediately once registries are warm).
- **Errors.** Manifest-build failures (unknown tool, MCP connect failure, compile failure) drop *only* that one agent and are logged at `warn`. They do not crash boot. A run against a missing/disabled agent throws `NotFoundError`, which the error middleware translates to a 404.
- **Hot reload.** There is no auto-refresh. Call `AgentRegistry.refresh()` (and/or `McpServerRegistry.refresh()`) after manifest writes, or restart the process.
- **Performance.** `runByAgentId` is wrapped with `@logExecTime({ threshold_in_ms: 5000 })`; runs taking longer than 5s are logged.
