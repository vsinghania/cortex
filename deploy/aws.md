# AWS deployment — Phase 1

The current production deployment: a single EC2 instance running the docker-compose
stack behind an ALB, with the SPA served statically from CloudFront. Deliberately
simple — one box, one region, no orchestrator — so the whole thing can be reasoned
about end to end. Later phases (ECS, EKS, Terraform, CI/OIDC, Secrets Manager) are
tracked in [README.md](README.md#known-gaps-phase-1-backlog), not here.

Region is **us-east-1** throughout. Real values — account id, instance id, hosted
zone id — stay out of this file by convention; keep them in local notes.

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
   │  docker compose -f docker-compose.prod.yml                                │
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
- Default root object `index.html`; SPA fallback returns `index.html` for
  client-side routes.
- `VITE_API_BASE_URL` is **baked into the bundle at build time** (see
  [web/.env](../web/.env) and `docs/` on env layering) — changing the API URL means
  a rebuild and re-upload, not a config change.

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

```sh
# interactive shell on the box
aws ssm start-session --target <instance-id>

# port-forward the inspector for remote debugging (see README.md §"Attaching a debugger")
aws ssm start-session \
  --target <instance-id> \
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

## 8. ECR and the image build/push flow

Private repository **`cortex-app`**. `web-server` and `mcp-notes` run the **same
image** with different commands (see [docker-compose.prod.yml](docker-compose.prod.yml)).

Because the Mac is ARM and the instance is x86_64, always build for `linux/amd64`:

```sh
# from the repo root, on your Mac
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
TAG="$REGISTRY/cortex-app:$(git rev-parse --short HEAD)"

aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/amd64 -t "$TAG" --push .
```

Then on the box (the instance authenticates to ECR via `cortex-ec2-role`, no
`docker login` needed):

```sh
aws ssm start-session --target <instance-id>
cd <app-dir>                                        # holds docker-compose.prod.yml + .env
export CORTEX_IMAGE=<registry>/cortex-app:<tag>     # or set it in .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl -s localhost:3000/healthz                      # expect: ok
```

> `CORTEX_IMAGE` is the one interpolated value that is a deployment *action* rather
> than a secret — it changes every deploy. Tagging with the git SHA (as above)
> makes rollback a one-line change back to a known-good tag. See the backlog note on
> image hygiene in [README.md](README.md#known-gaps-phase-1-backlog).

## 9. The app stack on the box

The instance holds two files next to each other: `docker-compose.prod.yml` (a copy
of [this repo's](docker-compose.prod.yml)) and `.env`. Compose reads `.env` for the
`${...}` secrets (`CORTEX_IMAGE`, `JWT_ACCESS_SECRET`, `OPENAI_API_KEY`,
`MCP_NOTES_AUTH_TOKEN`); every non-secret fact is literal in the compose file. See
the env-layering docs for the full secret-vs-fact split.

| Service | Host exposure | Internal address |
| --- | --- | --- |
| `web-server` | `0.0.0.0:3000` (ALB target) | — |
| `mcp-notes` | `127.0.0.1:3010` (loopback only) | `mcp-notes:3010` |
| `mongodb` | none | `mongodb:27017` |
| `qdrant` | none | `qdrant:6333` |

Data lives in Docker named volumes (`mongodb_data`, `qdrant_data`) on the root
volume. **There is no backup** — see the durability gap in
[README.md](README.md#known-gaps-phase-1-backlog).

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

## 11. Deploy checklist

**Backend:** build+push (§8) → `pull` + `up -d` on the box → `curl localhost:3000/healthz`.

**SPA:** `npm --prefix web run build` → sync `web/dist` to the S3 bucket →
CloudFront invalidation (`/*`) so the edge serves the new bundle.

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
- **Private:** `mcp-notes` (loopback host bind), MongoDB and Qdrant (unpublished,
  Docker-network only, and currently without their own auth — a defense-in-depth
  gap noted in the backlog).
- **No SSH.** SSM only; the inspector ports are never opened in the SG.
- **Secrets** are plaintext in the box's `.env` (Phase 2 → Secrets Manager). That
  file is the only copy — losing the instance loses it. Keep a copy somewhere safe.

Open items — health-check depth, datastore auth, backups, image tagging — are all
tracked in [README.md](README.md#known-gaps-phase-1-backlog).
