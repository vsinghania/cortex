# Preparing a public release

Use this checklist before changing the repository from private to public. Source checks cover Git content; GitHub settings, logs, and artifacts need a separate review.

## Source and history

- [ ] Fetch all published branches and tags with `git fetch --all --tags`.
- [ ] Install [Gitleaks](https://github.com/gitleaks/gitleaks) and run `gitleaks git --log-opts=--all --redact=100` locally. The CI workflow pins a checksum-verified release and runs the same history scan.
- [ ] Review uncommitted changes and any GitHub-only pull request refs separately. A Git-history scan does not cover ignored local files or uncommitted edits.
- [ ] If a real credential was committed, revoke or rotate it before publishing. Review whether its history also needs removal; coordinate any rewrite across branches and collaborators. [GitHub's removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
- [ ] Confirm example credentials have never been used for a real account. Examples now use `example.com`, blank passwords, and blank record IDs; earlier revisions still contain the old examples.
- [ ] Check screenshots, test fixtures, issue/PR discussions, release attachments, and commit messages for private data or material you cannot publish.
- [ ] Review author/committer emails in Git history. Setting a GitHub noreply address affects future commits; existing metadata remains unless history is rewritten.
- [ ] Confirm ownership or permission for code, prompts, and assets. The repository uses ISC; dependency and third-party asset licenses still apply to their respective material.

## GitHub Actions and AWS

- [ ] Review historical workflow logs and artifacts. [Actions history and logs become public](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility). Downloaded logs can contain secrets: scan them locally, keep output redacted, and do not commit reports.
- [ ] Remove any runs or artifacts that disclose sensitive content, and rotate exposed credentials. Review old attempts as well as the latest attempt of a re-run workflow.
- [ ] Keep the default `GITHUB_TOKEN` permission read-only and disable workflow approval of pull requests.
- [ ] Require approval before workflows from outside contributors run. Keep AWS credentials and OIDC permissions out of pull-request workflows; avoid executing untrusted code with `pull_request_target`.
- [ ] Restrict AWS OIDC trust policies to this repository and the intended trusted branch or protected environment. Changing a job to use an environment changes its OIDC subject, so update and verify AWS trust before doing so.
- [ ] Protect `main` against deletion and force pushes, and require successful CI and secret scanning before merges. Protection may require a paid plan while this repository is private; check again immediately after publication if unavailable.
- [ ] Review who can dispatch deployments. Build and deploy jobs run only from the `main` workflow branch; manual deploy refs must resolve to a commit already merged into `main`. Rollbacks to earlier `main` commits remain available. These workflow checks complement the AWS trust policy; they do not replace it.

## Repository settings

- [ ] Enable dependency alerts and review current advisories for both npm projects.
- [ ] Enable secret scanning and push protection when available for the repository's plan and visibility. The committed Gitleaks workflow provides a CI check but cannot prevent a secret from reaching GitHub in the first place.
- [ ] Enable private vulnerability reporting so the link in [SECURITY.md](../SECURITY.md) works.
- [ ] Confirm the Dependabot configuration covers `/`, `/web`, and GitHub Actions after it reaches the default branch.

## Presentation and validation

- [ ] Follow [local_development.md](local_development.md) from a fresh configuration, including the sample agent seed and Mailpit verification email.
- [ ] Run the checks in the root [README](../README.md#development-checks) and review the latest CI results.
- [ ] Add screenshots or a short demo using synthetic notes if desired. Check every visible note, email address, URL, and account menu before publishing media.
- [ ] Set a concise repository description and relevant topics, and link the repository from your resume.

Changing visibility makes the code copyable and forkable. Complete the review before publishing; making the repository private again cannot remove other people's copies.
