# Local development

Use Node.js 22.12 or later in the 22.x line and Docker with Compose. The steps below use the database names and ports from `.env.example` and run Node processes on the host.

## Install and configure

```bash
nvm use
npm ci
npm --prefix web ci
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. To generate the three independent application secrets, run this command locally and copy its output into the corresponding entries in `.env`:

```bash
node --input-type=module <<'NODE'
import { randomBytes } from 'node:crypto';
for (const name of ['JWT_ACCESS_SECRET', 'MCP_NOTES_AUTH_TOKEN', 'MCP_GATEWAY_ASSERTION_SECRET']) {
  console.log(`${name}=${randomBytes(32).toString('hex')}`);
}
NODE
```

Keep the remaining defaults for now. OpenAI is used for embeddings and the chat agent; ordinary note editing can still be explored if AI requests fail. The public MCP gateway needs `MCP_GATEWAY_ASSERTION_SECRET`; the same value is read by both host processes from `.env`.

Start the local data stores and mail catcher:

```bash
docker compose up -d mongodb qdrant mailpit
docker compose ps
```

Mailpit accepts verification and password-reset emails without sending them outside your machine.

## Seed a sample chat agent

Chat expects the `notes-recall` agent and the `notes` MCP server manifest. They are configuration records, so application startup does not create them.

Run the following **before starting the API**. It inserts missing records only and preserves any existing agent prompt or MCP configuration. This recipe assumes `MONGO_DB_APP=cortex`; change the database argument if you configured `MONGO_DB_AGENT` or `MONGO_DB_NAMESPACE`.

```bash
docker compose exec -T mongodb mongosh --quiet cortex_agent_db <<'MONGO'
const now = new Date();
db.mcp_servers.updateOne(
  { mcp_server_id: 'notes' },
  { $setOnInsert: {
    mcp_server_id: 'notes',
    name: 'Notes MCP',
    mode: 'self_hosted',
    transport: 'http',
    http: {
      base_url: 'http://127.0.0.1:3010/mcp',
      auth_token_env: 'MCP_NOTES_AUTH_TOKEN',
    },
    enabled: true,
    version: 1,
    created_at: now,
    updated_at: now,
  } },
  { upsert: true }
);
db.agents.updateOne(
  { agent_id: 'notes-recall' },
  { $setOnInsert: {
    agent_id: 'notes-recall',
    name: 'Notes Recall',
    instructions: 'Help the user recall and organize their notes. If a document is attached to this conversation, answer from it first and search only when the question needs information beyond it. Otherwise, make exactly one notes_search_semantic call before answering questions about saved notes. Cite claims supported by retrieved chunks as [c:<chunk_id>], using the actual chunk_id returned by the tool. If the notes do not contain the answer, say so. Confirm destructive changes with the user before making them.',
    engine: 'openai',
    tool_names: [],
    tool_agent_ids: [],
    handoff_agent_ids: [],
    mcp_server_ids: ['notes'],
    instruction_policy_names: [
      'output_hygiene', 'confidentiality', 'untrusted_content',
      'grounding', 'citations', 'write_safety',
    ],
    enabled: true,
    version: 1,
    created_at: now,
    updated_at: now,
  } },
  { upsert: true }
);
MONGO
```

This is a sample prompt for local exploration. The model defaults to `OPENAI_DEFAULT_MODEL` or the agent implementation's fallback; set the agent record's `model` field if you need a specific model.

## Start the app

Run each command in a separate terminal at the repository root:

```bash
npm run mcp:notes:dev
npm run worker:dev
npm run dev
npm --prefix web run dev
```

| Surface | URL |
| --- | --- |
| Web app | http://localhost:5173 |
| API health | http://localhost:3000/healthz |
| Mailpit inbox | http://localhost:8025 |
| Internal notes MCP | http://127.0.0.1:3010/mcp (requires authentication) |

Register in the web app, open its verification email in Mailpit, verify your address, and sign in. Create a note and ask chat about its contents. The worker must be running for verification emails to be delivered.

If you seeded after starting the API, restart `npm run dev` to load the manifests immediately; otherwise registry refresh can take up to ten minutes. Existing manifests take precedence over the sample seed, including any old MCP URL.

## Run the backend in containers instead

Use the same `.env`, install the web dependencies, and start the backend with:

```bash
docker compose up -d --build
npm --prefix web run dev
```

For a **fresh** database, run the seed above with `http://mcp-notes:3010/mcp` as the MCP `base_url`, then `docker compose restart web-server`. Host Node processes use `127.0.0.1`; containers use the `mcp-notes` service name. The insert-only seed will not change an existing record when you switch between these setups; update its URL deliberately before restarting the API.

For container hot reload, use [docker-compose.dev.yml](../docker-compose.dev.yml). The frontend is always started separately. Published ports are bound to `127.0.0.1`; connecting from a phone or another computer requires a deliberate networking override.

## Optional integrations

- **Voice and external assistants:** [voice.md](voice.md), [mcp.md](mcp.md), and [oauth.md](oauth.md). Remote MCP clients need an HTTPS tunnel to port 3000. Set `MCP_PUBLIC_BASE_URL` to the tunnel origin and `VOICE_MCP_PUBLIC_URL` to its `/notes` URL. Keep `OAUTH_ISSUER_URL` reachable by those clients and restart the API after changing configuration.
- **Google sign-in:** configure the client ID, client secret, and authorized redirect URI described in [auth.md](auth.md).
- **OneNote:** configure the Microsoft OAuth application and credential-encryption keys described in [.env.example](../.env.example). Recurring sync also requires an explicitly created [job schedule](../deploy/aws.md#fresh-database--create-the-onenote-sync-schedule).
- **Anthropic:** set `ANTHROPIC_API_KEY` to enable its single-shot AI adapter. Notes embeddings, the chat agent, and voice still use OpenAI.

## Stop services

Stop each Node process with Ctrl+C, then run `docker compose stop`. This preserves notes and other local data. `docker compose down -v` deletes the local database volumes.
