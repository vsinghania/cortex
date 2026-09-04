# cortex

A personal "second brain": capture notes by hand, by voice, or by agent; they are chunked and embedded on write and recalled by an LLM agent that cites the chunks it used.

## Documentation

- [docs/architecture.md](docs/architecture.md) — processes, layering, end-to-end flows, startup, known rough edges
- [docs/patterns.md](docs/patterns.md) — the idioms used throughout the code
- [docs/README.md](docs/README.md) — index of the per-module docs

## Running locally

```bash
docker compose up -d mongodb qdrant   # datastores
npm run dev                           # API on :3000
npm run mcp:notes:dev                 # notes MCP server on :3010
npm --prefix web run dev              # SPA on :5173
```

Copy [.env.example](.env.example) to `.env` first; `OPENAI_API_KEY`, `JWT_ACCESS_SECRET` and `MCP_NOTES_AUTH_TOKEN` are the ones without workable defaults. `docker compose up` runs the whole set; [deploy/k8s/base/](deploy/k8s/base/) has the Kubernetes manifests, and [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml) is the production stack that runs on EC2.
