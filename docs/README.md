# Cortex docs

Design-level documentation: what the pieces are, why they are shaped that way, and what will bite you. Anything you could learn in a minute by opening the code deliberately isn't here.

**Start here:** [architecture.md](architecture.md) — processes, layering, end-to-end flows, startup, rough edges.
**Then:** [patterns.md](patterns.md) — the idioms used throughout the code, and where they have drifted.

| Doc | Covers |
| --- | --- |
| [agent_svc.md](agent_svc.md) | Agent manifests, registries, tools, MCP wiring, conversations |
| [ai_svc.md](ai_svc.md) | Single-shot text and structured generation |
| [recall.md](recall.md) | Notes, chunking, embeddings, semantic retrieval |
| [citation_svc.md](citation_svc.md) | Grounding answers in sources: markers, storage, resolution |
| [mcp.md](mcp.md) | MCP server framework, notes tools, client, reverse proxy |
| [auth.md](auth.md) | JWT access tokens, rotating refresh sessions, users |
| [voice.md](voice.md) | Ephemeral OpenAI Realtime sessions |
| [web.md](web.md) | HTTP surface and the SPA that consumes it |
| [platform.md](platform.md) | Logger, errors, trace context, middlewares, lib wrappers, db |

**Reading order** — new to the codebase: architecture → web → the module you are touching. Working on recall quality: recall → agent_svc. Working on capture: voice → mcp → recall. Working on grounding or citations: citation_svc → recall.

Coding conventions live in [CLAUDE.md](../CLAUDE.md). Request/response shapes live in [bruno/](../bruno/). Environment variables live in [.env.example](../.env.example).
