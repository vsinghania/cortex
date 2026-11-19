# Security

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/vsinghania/cortex/security/advisories/new). If private reporting is unavailable, contact the repository owner through a contact method listed on [their GitHub profile](https://github.com/vsinghania) to arrange private disclosure.

Include the affected commit, reproduction steps using synthetic data, and the expected impact. Redact credentials, personal notes, and account information. Avoid posting vulnerabilities or credentials in public issues or pull requests.

## Supported code

Security fixes target the latest code on `main`. This is a personal project without a guaranteed response time or long-term support for older revisions.

## Local configuration

- Keep credentials in `.env` or your deployment's secret store. `.env.example` contains configuration examples only.
- `VITE_*` values are public browser configuration. Never use them for API keys or server secrets.
- The root Compose files are for local development: MongoDB and Qdrant have no authentication, and application secrets have development fallbacks. Published ports bind to loopback. Use [the production deployment configuration](deploy/aws.md) for a hosted installation.
- Run `gitleaks git --log-opts=--all --redact` before publishing history. If a real secret has been committed, revoke or rotate it first; deleting its current value does not invalidate copies.

See [the publication checklist](docs/public_release.md) for the remote settings and logs that a source scan cannot verify.
