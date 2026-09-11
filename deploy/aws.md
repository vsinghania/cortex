# AWS deployment — Phase 1

The current production deployment: a single EC2 instance running the docker-compose
stack behind an ALB, with the SPA served statically from CloudFront. Deliberately
simple — one box, one region, no orchestrator — so the whole thing can be reasoned
about end to end. Later phases (ECS, EKS, Terraform, CI/OIDC, Secrets Manager) are
tracked in [README.md](README.md#known-gaps-phase-1-backlog), not here.

Region is **us-east-1** throughout. Real values — account id, instance id, hosted
zone id — stay out of this file by convention; keep them in local notes.

---

## Day-to-day cheat sheet

Deploys run through GitHub Actions (§8). Building is automatic; promoting to
production is a manual dispatch.

| Want to | Do |
| --- | --- |
| Ship the backend | push to `main` → an image is built and pushed to ECR. Then **Actions → deploy-api → Run workflow** |
| Ship the SPA | **Actions → deploy-spa → Run workflow** |
| Roll back | **Actions → deploy-api** with the previous commit's SHA |
| Rebuild without a new commit | **Actions → build-image → Run workflow** |
| Stand up a fresh database | seed the chat agent rows by hand — [§9](#fresh-database--seed-the-chat-agent) |

`deploy-api` takes a branch, tag or SHA in `git_ref` (default `main`) and resolves
it to a single commit. The image and the compose file both come from that commit,
so a rollback restores the code and its configuration together.

### Local values

Nothing below needs an account id memorised. Source the helper once per terminal:

```sh
# One-time: copy the template and fill in the two non-derivable values.
cp deploy/aws.env.example deploy/aws.env      # set SPA_BUCKET + CLOUDFRONT_DISTRIBUTION_ID

# Per terminal (needs a live SSO session — run `aws sso login` if expired):
source scripts/aws-env.sh
#   exports INSTANCE_ID, ECR_REGISTRY, ECR_IMAGE, SPA_BUCKET,
#   CLOUDFRONT_DISTRIBUTION_ID, AWS_ACCOUNT_ID, AWS_REGION
```

`deploy/aws.env` is the local operator's copy of this config; the GitHub
repository **variables** are CI's copy of the same two irreducible values. Change
one, change the other.

### Shells and tunnels

```sh
# EC2 shell over SSM
aws ssm start-session --target "$INSTANCE_ID"

# Prod database (tunnel 27017 to localhost:27018)
aws ssm start-session --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["27017"],"localPortNumber":["27018"]}'
#   then point Compass / mongosh at mongodb://localhost:27018
```

### Break-glass — deploying by hand

Only when Actions is unavailable. Note the **full** SHA: `deploy-api` will not
recognise a short-tagged image later.

```sh
aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker buildx build --platform linux/amd64 -t "$ECR_IMAGE:$(git rev-parse HEAD)" --push .

# then on the box — see §8 for what the automated path does
```

---

## 1. Topology

```
                         ┌──────────── cortexapp.me (apex) ───────────┐
   Browser ──────────────┤  Route 53 Alias → CloudFront → S3 (SPA)    │  static files
      │                   └────────────────────────────────────────────┘
      │ REST + Bearer JWT + rt cookie
      ▼
   ┌──────── api.cortexapp.me ────────┐
   │  Route 53 Alias → ALB (:443)      │  ACM cert; :80 → :443 redirect
   │        │ HTTP :3000               │
   │        ▼                          │
   │  target group cortex-web-tg       │  health check: GET /healthz
   └────────┬──────────────────────────┘
            │ (only web-server is reachable from the ALB SG)
            ▼
   ┌─────────────────── EC2  cortex-ec2 (public subnet a) ───────────────────┐
   │  docker compose  (compose.yaml, shipped by deploy-api)                   │
   │                                                                          │
   │   web-server :3000 ──┬── mcp-notes :3010 (127.0.0.1 host bind only)      │
   │        │             │        │                                          │
   │        ▼             ▼        ▼                                          │
   │   mongodb :27017   qdrant :6333   (Docker-network only, unpublished)     │
   └──────────────────────────────────────────────────────────────────────────┘
```

Two rules the whole design enforces:

- **Only `web-server` is public.** The ALB security group can reach port 3000 and
  nothing else. `mcp-notes`, MongoDB and Qdrant are never published to `0.0.0.0`
  on the host — see [docker-compose.prod.yml](docker-compose.prod.yml) and §5.
- **The SPA and the API are separate origins on the same site.** `cortexapp.me`
  (CloudFront) and `api.cortexapp.me` (ALB) share a registrable domain, which is
  why the refresh-token cookie (`SameSite=Lax`, host-only on the API) works across
  them without extra configuration.

## 2. Frontend — SPA on CloudFront

- Build output (`web/`) is uploaded to a **private S3 bucket**; CloudFront serves
  it publicly. The bucket is not itself public.
- **Domain:** `https://cortexapp.me`, a Route 53 apex Alias → CloudFront.
- **Cert:** ACM in **us-east-1** (CloudFront only reads certs from that region).
- Default root object `index.html`, which covers `/` and nothing else.
- **SPA fallback** is the CloudFront Function `cortex-spa-router`
  ([cloudfront/spa_router.js](cloudfront/spa_router.js)), attached to the default
  cache behaviour on **viewer-request**. It rewrites any path whose last segment
  has no dot — `/notes`, `/notes/:id`, `/chat` — to `/index.html`, so a refresh or
  a pasted deep link reaches the router instead of S3.

  Without it those paths are missing keys, and because the bucket is private
  behind OAC with `s3:GetObject` but no `s3:ListBucket`, S3 returns **403
  AccessDenied**, not 404 — CloudFront passed that error XML straight to the
  browser. The distribution deliberately has **no `CustomErrorResponses`**: the
  usual 403/404 → `index.html` recipe would also mask genuinely missing assets,
  handing a stale tab an HTML document where it asked for a JS chunk.

  The function is console/CLI-managed, not IaC. `spa_router.js` is the source of
  truth for its code; changing it means `aws cloudfront update-function` plus
  `publish-function` (Terraform is a Phase 2 item).
- `VITE_API_BASE_URL` is **baked into the bundle at build time**, selected by Vite
  mode: `vite build` reads the committed [web/.env.production](../web/.env.production)
  (the prod API), while `npm run dev` reads [web/.env.development](../web/.env.development)
  (localhost). Nothing is hand-edited per build; changing the prod API URL means
  editing `.env.production` and rebuilding, not a runtime config change.

## 3. Backend — API on the ALB

- **Domain:** `https://api.cortexapp.me`, a Route 53 Alias → the public ALB.
- ALB terminates HTTPS with an ACM cert; **:80 redirects to :443**.
- Target group `cortex-web-tg`: HTTP, port **3000**, health check **`GET /healthz`**,
  target = the EC2 instance.
- Only `web-server` sits behind the ALB. Everything else on the box is internal.

## 4. Networking

VPC `cortex-vpc`, CIDR `10.0.0.0/16`.

| Subnet | CIDR | AZ |
| --- | --- | --- |
| `cortex-public-a` | `10.0.1.0/24` | us-east-1a |
| `cortex-public-b` | `10.0.2.0/24` | us-east-1b |

- `cortex-igw` attached to the VPC.
- `cortex-public-rt`: `10.0.0.0/16 → local`, `0.0.0.0/0 → IGW`; both subnets use it.
- **No NAT gateway.** The instance reaches AWS (SSM, ECR) and the internet (OpenAI)
  over its **public IP via the IGW** — so that public IP is load-bearing. Removing
  it would require a NAT gateway or VPC endpoints.
- The ALB spans both public subnets (it requires two AZs); the instance lives only
  in `cortex-public-a`, so there is no cross-AZ redundancy yet.

## 5. Security groups

**`cortex-alb-sg`** (on the ALB):
- inbound TCP 80 from `0.0.0.0/0`
- inbound TCP 443 from `0.0.0.0/0`

**`cortex-ec2-sg`** (on the instance):
- inbound TCP 3000 **only from `cortex-alb-sg`**
- no port 22 — **no SSH**; access is via SSM (§7)

> Never add 9229/9230 (the Node inspector ports) to `cortex-ec2-sg`. The debug
> overlay publishes them on the instance's loopback only, reached by an SSM
> port-forward — see [README.md](README.md#attaching-a-debugger).

## 6. EC2 instance

| Attribute | Value |
| --- | --- |
| Name | `cortex-ec2` |
| AMI | Amazon Linux 2023, x86_64 |
| Type / disk | `t3.medium`, 30 GB gp3 |
| Placement | `cortex-public-a`, public IPv4 enabled |
| Security group | `cortex-ec2-sg` |
| IAM role | `cortex-ec2-role` (via instance profile) |

The instance is **x86_64 while a Mac is ARM** — images must be built for
`linux/amd64` (§8).

**IAM role policies:**
- `AmazonSSMManagedInstanceCore` — SSM shell and port forwarding
- `AmazonEC2ContainerRegistryReadOnly` — pull from ECR without stored credentials

## 7. Access — SSM, not SSH

There is no SSH key and no port 22. Everything goes through SSM, which is why the
instance needs the SSM managed-instance policy and outbound reachability to AWS.

`$INSTANCE_ID` below comes from `source scripts/aws-env.sh` (see the cheat sheet);
substitute the literal id if you have not sourced the helper.

```sh
# interactive shell on the box
aws ssm start-session --target "$INSTANCE_ID"

# port-forward the inspector for remote debugging (see README.md §"Attaching a debugger")
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["9229"],"localPortNumber":["9229"]}'
```

**Local operator identity** is IAM Identity Center (SSO), not static keys:

```sh
export AWS_PROFILE=cortex        # set for the repo via .envrc (direnv)
export AWS_REGION=us-east-1
aws sso login                    # 8-hour session; renew when it expires
aws sts get-caller-identity      # expect an AWSReservedSSO_AdministratorAccess ARN
```

No static AWS access keys live in the repo or `.envrc`.

**CI identity** is GitHub OIDC federated to IAM — also temporary credentials, also
no stored keys. The runner requests a short-lived token from GitHub, presents it to
STS, and receives ~1 hour of credentials. Two roles, so the build path cannot reach
production:

| Role | Used by | Can |
| --- | --- | --- |
| `cortex-gha-build` | `build-image.yml` | push to the `cortex-app` ECR repo, nothing else |
| `cortex-gha-deploy` | `deploy-api.yml`, `deploy-spa.yml` | `ssm:SendCommand` on `cortex-ec2`, write the deploy bucket, sync the SPA bucket, invalidate CloudFront |

Both trust policies pin the token's `sub` claim to
`repo:vsinghania/cortex:ref:refs/heads/main`, so a pull-request run — which
presents a different claim — is refused by STS before any permission is evaluated.
`ci.yml` additionally declares no `id-token` permission at all, making it
structurally incapable of assuming a role.

Three identities, one model — nothing long-lived anywhere:

    Human  → IAM Identity Center → temporary credentials
    GitHub → OIDC               → temporary credentials
    EC2    → instance role      → temporary credentials

**Deploys still go over SSM.** Adding CI/CD did not open port 22 and introduced no
SSH key; GitHub reaches the instance the same way you do.

## 8. Build and deploy

Private ECR repository **`cortex-app`**. `web-server` and `mcp-notes` run the
**same image** with different commands (see
[docker-compose.prod.yml](docker-compose.prod.yml)).

### Build — automatic

`.github/workflows/build-image.yml` runs on every push to `main`: assume
`cortex-gha-build` via OIDC, build for `linux/amd64` (runners are x86_64, so no
QEMU), push to ECR.

The canonical tag is the **full 40-character commit SHA**. A 7-character alias is
pushed alongside it for readable `docker ps` output, but automation uses the full
form — `deploy-api` checks out that exact commit to fetch the matching compose
file, and only a full SHA resolves reliably as a ref.

Every commit on `main` therefore has a deployable image. Production is unaffected
until someone dispatches a deploy.

### Deploy — manual

**Actions → deploy-api → Run workflow**, with `git_ref` (branch, tag or SHA;
default `main`). The workflow:

1. resolves the ref to one commit and checks it out
2. preflights — image exists in ECR, exactly one running `cortex-ec2`, SSM agent `Online`
3. uploads `compose.yaml` and `remote-deploy.sh` to `s3://<deploy-bucket>/releases/<sha>/`
4. `ssm send-command` runs [remote-deploy.sh](remote-deploy.sh) on the box
5. polls the command and streams the box's stdout/stderr into the Actions log

On the instance the script fetches the artifacts, writes `deploy.env`,
authenticates to ECR, validates the config, pulls **only** `web-server` and
`mcp-notes`, applies, and health-checks both services. A failing gate fails the
workflow; recovery is dispatching the previous SHA (§11).

Two things that look optional and are not:

- **The `docker login` on the box is required, every deploy.** `cortex-ec2-role`
  grants ECR permission, but Docker does not use instance credentials for registry
  auth unless `amazon-ecr-credential-helper` is configured — and tokens last 12
  hours, so a deploy after an idle gap would fail on pull. (An earlier version of
  this document claimed the opposite.)
- **The pull is scoped to the app services.** A bare `docker compose pull` would
  re-resolve every image; the datastores are digest-pinned so it is safe in
  principle, but keeping the intent explicit is the point.

## 9. The app stack on the box

The app directory (`/home/ssm-user/cortex`) holds three files:

| File | Owner | Contents |
| --- | --- | --- |
| `compose.yaml` | **CI — do not hand-edit** | shipped by every deploy from [docker-compose.prod.yml](docker-compose.prod.yml); local changes are silently reverted |
| `.env` | human | the four secrets: `JWT_ACCESS_SECRET`, `OPENAI_API_KEY`, `MCP_NOTES_AUTH_TOKEN`, `SMTP_PASS` (the Resend API key, see §10). Automation never writes this file |
| `deploy.env` | CI | one line, `CORTEX_IMAGE=<registry>/cortex-app:<full-sha>` — which version is running |

Splitting deployment state from secrets is what lets CI change the running version
without ever touching the file holding credentials. Every non-secret fact is a
literal in the compose file; only those five values are interpolated.

The on-box name is `compose.yaml` because that is one of the names `docker compose`
discovers automatically, so interactive commands need no `-f`. Both env files must
be named for interpolation to work:

```sh
docker compose --env-file .env --env-file deploy.env config -q
```

`/etc/profile.d/cortex.sh` sets `COMPOSE_PROJECT_NAME` and `COMPOSE_ENV_FILES` so
that read-only commands (`ps`, `logs`, `top`) work from any directory, while
`up`/`pull`/`config` still require the app directory. Session Manager's Linux shell
profile runs `bash -l` so a session actually sources it.

### Box-local state that CI does not ship

If the instance is replaced, these do not come back on their own:

- `.env` — the only copy of the four secrets
- `deploy.env` — recreated by the next deploy, so not critical
- `ssm-user`'s membership of the `docker` group (`usermod -aG docker ssm-user`)
- `/etc/profile.d/cortex.sh`
- the Session Manager shell profile (`bash -l`) — stored in the account, not the box, so this one does survive

| Service | Host exposure | Internal address |
| --- | --- | --- |
| `web-server` | `0.0.0.0:3000` (ALB target) | — |
| `mcp-notes` | `127.0.0.1:3010` (loopback only) | `mcp-notes:3010` |
| `mongodb` | `127.0.0.1:27017` (loopback only) | `mongodb:27017` |
| `qdrant` | none | `qdrant:6333` |

Data lives in Docker named volumes (`mongodb_data`, `qdrant_data`) on the root
volume, snapshotted daily by a Data Lifecycle Manager policy (7-day retention).
The datastore images are pinned by digest so no deploy can upgrade them as a side
effect — see [README.md](README.md#known-gaps-phase-1-backlog) for what restoring
a snapshot still has to prove.

### Connecting to the prod database

MongoDB publishes `27017` on the **instance loopback only** — it is not on the ALB,
not in `cortex-ec2-sg`, and never bound to `0.0.0.0`. Reach it from your laptop with
an SSM port-forward (the command is in the cheat sheet at the top):

```sh
aws ssm start-session --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["27017"],"localPortNumber":["27018"]}'
# Compass / mongosh: mongodb://localhost:27018
```

Two things to keep in mind, both consequences of the current setup rather than of
the tunnel:

- **Mongo runs without auth**, so your AWS/SSM permission to the instance is the
  entire perimeter around the database — there are no DB credentials. This is why
  the loopback bind and the "no 0.0.0.0, no SG rule" rule above are load-bearing,
  not optional. Tracked as a hardening item in
  [README.md](README.md#known-gaps-phase-1-backlog).
- **You are connected to live prod data with full write access.** A stray
  destructive command in a GUI hits production. Until Mongo has auth (and thus a
  read-only role), care is the only guardrail.

### Fresh database — seed the chat agent

Agents and MCP servers are data, not code: nothing creates them on boot. The SPA's
chat hardcodes `agent_id: 'notes-recall'`, so on a new environment chat is broken
until two rows exist in `cortex_agent_db` (`MONGO_DB_APP=cortex` + `_agent_db`):
the `notes` MCP server in `mcp_servers`, and the `notes-recall` agent in `agents`.

Run once on the box after the first deploy, replacing `<AGENT_PROMPT>` and
`<AGENT_MODEL>` with the agent's prompt and model first — neither is kept in the
repo. It is an upsert, so
re-running is safe — but it **resets both rows to these values**, overwriting any
prompt edits made in the database since.

```sh
cd /home/ssm-user/cortex
docker compose exec -T mongodb mongosh --quiet cortex_agent_db <<'EOF'
const now = new Date();

db.mcp_servers.updateOne(
  { mcp_server_id: 'notes' },
  {
    $set: {
      name: 'Notes MCP',
      mode: 'self_hosted',
      transport: 'http',
      http: { base_url: 'http://mcp-notes:3010/mcp', auth_token_env: 'MCP_NOTES_AUTH_TOKEN' },
      enabled: true,
      version: 1,
      updated_at: now,
    },
    $setOnInsert: { created_at: now },
  },
  { upsert: true }
);

db.agents.updateOne(
  { agent_id: 'notes-recall' },
  {
    $set: {
      name: 'Notes Recall',
      instructions: `<AGENT_PROMPT>`,
      model: '<AGENT_MODEL>',
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
      updated_at: now,
    },
    $setOnInsert: { created_at: now },
  },
  { upsert: true }
);
EOF

docker compose restart web-server
docker compose logs --since=2m web-server | grep 'Connected to self-hosted MCP server'
```

The same script works against the local compose stack (`docker compose exec -T
mongodb mongosh cortex_agent_db`). Then ask the chat something about a note; the
answer should carry citations.

Things that bite when editing these rows by hand later:

- **Always set `created_at` / `updated_at`.** Mongoose stamps them, raw `mongosh`
  does not — and an MCP row without `updated_at` is skipped with `Skipping MCP
  server: failed to initialize`.
- **Bump `updated_at` (or `version`) when changing an MCP row.** The registry
  keeps the existing connection unless one of them moves. Agents are recompiled
  on every refresh regardless.
- **Changes land within 10 minutes** (the registry refresh), or immediately on
  `docker compose restart web-server`.
- **Keep `[c:<chunk_id>]` in the prompt.** It is the only place the citation
  format is taught, and `CitationExtractor` matches exactly that; any other
  format produces answers with no citations and no error.
- **`auth_token_env` names an env var, not the token.** web-server reads
  `MCP_NOTES_AUTH_TOKEN` from its environment; the secret never goes in Mongo.

## 10. Route 53 / DNS

Hosted zone for `cortexapp.me` is managed by Route 53 (created at registration).

| Record | Target |
| --- | --- |
| `cortexapp.me` (apex) | Alias → CloudFront |
| `api.cortexapp.me` | Alias → ALB |

```sh
dig NS cortexapp.me +short          # four awsdns nameservers
dig cortexapp.me +short             # resolves to CloudFront
dig api.cortexapp.me +short         # resolves to the ALB
```

### Sending mail

Mail goes out through **Resend** over SMTP: `smtp.resend.com:465`, user `resend`,
password a sending-only API key scoped to the sending domain `mail.cortexapp.me`.
The provider is pure config ([docs/mailer_svc.md](../docs/mailer_svc.md)) — moving
to SES or Postmark changes the `SMTP_*` literals and the key, not the code. A
subdomain keeps sending reputation off the apex.

The sending domain needs, in this zone:

- **DKIM** — TXT `resend._domainkey.mail`, value from Resend.
- **Return path (SPF + bounces)** — CNAMEs `send.mail` and `rsend.mail` pointing at
  Resend's `*.forge.rmta.net`; Resend publishes the SPF and MX behind them.

  Copy the exact records from the domain's page in Resend; Route 53's record-name
  field takes only the prefix shown above (it appends `.cortexapp.me`).
- **DMARC** — a `_dmarc.cortexapp.me` TXT, starting at `p=none` to watch reports
  before tightening.

Without them, password-reset and verification mail lands in spam or is rejected
outright. Outbound 465 must be allowed by `cortex-ec2-sg` (egress is open by
default; AWS only throttles port 25).

`SMTP_PASS` must be in `.env` **before** deploying: the compose file requires it,
so a deploy without it fails at interpolation. After a deploy, check the relay
and the key from inside the container — this connects and authenticates without
sending anything:

```sh
docker compose exec web-server node --input-type=module -e \
  "const { MailerSvc } = await import('./dist/mailer_svc/mailer_svc.js'); await MailerSvc.getInstance().verify(); console.log('smtp ok')"
```

Bounces and complaints are
asynchronous — the relay accepts the message at SMTP time — so they show in the
Resend dashboard, not in our logs.

## 11. Deploy and rollback

**Backend:** push to `main` (CI builds the image) → **Actions → deploy-api → Run
workflow**, `git_ref` = `main`. The run is green only if the box answered
`/healthz` with `ok` and neither app container is crash-looping.

**SPA:** **Actions → deploy-spa → Run workflow**. The run waits for the CloudFront
invalidation to complete, so green means the edge is serving the new bundle.

### Rollback

There is no automatic rollback. A failed health gate leaves the new image running
and the workflow red; you decide what to do next.

```sh
git log --oneline -10        # find the last good commit
```

**Actions → deploy-api → Run workflow**, `git_ref` = that SHA. Because the image
and the compose file both come from the named commit, this restores the code *and*
its configuration together. A short SHA is fine — the workflow resolves it.

To see what is running right now:

```sh
aws ssm start-session --target "$INSTANCE_ID"
cat /home/ssm-user/cortex/deploy.env
```

**Debugging a running container:** bring up the debug overlay and tunnel the
inspector — [README.md](README.md#attaching-a-debugger).

## 12. Security posture

What is and isn't exposed, in one place:

- **Public:** CloudFront (SPA), the ALB (:80/:443 → web-server :3000). Nothing else.
- **Not public, but internet-reachable *through* web-server:** `/api/v1/mcp/notes`
  is proxied to the notes MCP so OpenAI Realtime can reach it, gated only by
  `MCP_NOTES_AUTH_TOKEN` with the tenant chosen by an `X-User-Id` header. Treat that
  token as the entire perimeter around every user's notes — see
  [../docs/mcp.md](../docs/mcp.md) §2 and [../docs/voice.md](../docs/voice.md) §4.
- **Private:** `mcp-notes` and MongoDB are published on the instance **loopback
  only** (`127.0.0.1`, reached via SSM port-forward, never in the SG); Qdrant is
  unpublished (Docker-network only). None has its own auth — a defense-in-depth gap
  noted in the backlog, and the reason Mongo's loopback bind must never become
  `0.0.0.0`. DB access flow: § "Connecting to the prod database".
- **No SSH.** SSM only, for CI as well as for you; the inspector ports are never
  opened in the SG.
- **Secrets** are plaintext in the box's `.env` (Phase 2 → Secrets Manager). That
  file is the only copy — losing the instance loses it. Keep a copy somewhere safe.
  CI never reads or writes it.
- **No static AWS credentials** anywhere: SSO for humans, OIDC for GitHub, the
  instance role for the box (§7).

Two trust boundaries that CI/CD introduced, both deliberate:

- **Push access to `main` now implies the ability to deploy.** Anyone who can push
  can dispatch `deploy-api`. Previously deploying required an SSO login. With one
  operator this is fine; with a second contributor it needs revisiting — GitHub
  Environments with required reviewers is the upgrade.
- **The deploy role can empty the SPA bucket**, because `aws s3 sync --delete`
  needs `s3:DeleteObject` and there is no way to scope it to "files not in this
  build". Inherent to the sync model; the blast radius is a re-runnable `deploy-spa`.

Open items — health-check depth, datastore auth, ECR lifecycle, restore testing —
are tracked in [README.md](README.md#known-gaps-phase-1-backlog).
