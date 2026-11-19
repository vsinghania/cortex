import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script_path = fileURLToPath(new URL('./resolve_deploy_commit.sh', import.meta.url));

class DeploymentRepositoryFixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'cortex-deploy-ref-'));
  readonly output_path = join(this.directory, '.git', 'workflow-output');
  rollback_sha = '';
  main_sha = '';
  feature_sha = '';

  static create(): DeploymentRepositoryFixture {
    const fixture = new DeploymentRepositoryFixture();
    try {
      fixture.initializeRepository();
      return fixture;
    } catch (err) {
      fixture.removeRepository();
      throw err;
    }
  }

  resolveDeploymentRef(requested_ref: string) {
    writeFileSync(this.output_path, '');
    return spawnSync('bash', [script_path], {
      cwd: this.directory,
      env: { ...process.env, DEPLOY_REF: requested_ref, GITHUB_OUTPUT: this.output_path },
      encoding: 'utf8',
    });
  }

  readResolvedCommit(): string {
    return readFileSync(this.output_path, 'utf8').trim();
  }

  removeRepository(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }

  private initializeRepository(): void {
    this.runGit(['init', '-b', 'main']);
    this.runGit(['config', 'user.name', 'Cortex Tests']);
    this.runGit(['config', 'user.email', 'tests@example.com']);
    this.rollback_sha = this.createCommit('initial');
    this.runGit(['tag', 'rollback-release']);
    this.runGit(['checkout', '-b', 'feature']);
    this.feature_sha = this.createCommit('unmerged feature');
    this.runGit(['checkout', 'main']);
    this.main_sha = this.createCommit('main update');
    this.runGit(['update-ref', 'refs/remotes/origin/main', this.main_sha]);
  }

  private createCommit(content: string): string {
    writeFileSync(join(this.directory, 'example.txt'), content);
    this.runGit(['add', 'example.txt']);
    this.runGit(['commit', '-m', content]);
    return this.runGit(['rev-parse', 'HEAD']);
  }

  private runGit(args: string[]): string {
    return execFileSync('git', args, { cwd: this.directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
}

test('deployment refs accept main and rollback commits while rejecting unmerged or injected input', () => {
  const repository = DeploymentRepositoryFixture.create();
  try {
    for (const requested_ref of ['main', 'origin/main', repository.main_sha, '']) {
      const result = repository.resolveDeploymentRef(requested_ref);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(repository.readResolvedCommit(), `sha=${repository.main_sha}`);
    }

    for (const requested_ref of ['rollback-release', repository.rollback_sha]) {
      const result = repository.resolveDeploymentRef(requested_ref);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(repository.readResolvedCommit(), `sha=${repository.rollback_sha}`);
    }

    for (const requested_ref of ['feature', repository.feature_sha, 'missing', '--help']) {
      const result = repository.resolveDeploymentRef(requested_ref);
      assert.notEqual(result.status, 0);
      assert.equal(repository.readResolvedCommit(), '');
    }

    const injected_ref = '$(printf injected > .git/workflow-output)';
    assert.notEqual(repository.resolveDeploymentRef(injected_ref).status, 0);
    assert.equal(repository.readResolvedCommit(), '');
  } finally {
    repository.removeRepository();
  }
});
