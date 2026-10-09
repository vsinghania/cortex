import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import type { IncomingMessage, RequestListener } from 'node:http';
import type { LookupFunction } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';

/** Runs the real HTTPS transport against a local server, trusting only its temporary certificate. */
export class HttpsFixture {
  public static async create(t: TestContext, listener: RequestListener) {
    const dir = await mkdtemp(join(tmpdir(), 'cortex-safe-fetch-'));
    t.after(async () => { await rm(dir, { recursive: true, force: true }); });
    const key_path = join(dir, 'key.pem');
    const cert_path = join(dir, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=client.test', '-addext', 'subjectAltName=DNS:client.test',
      '-keyout', key_path, '-out', cert_path
    ], { stdio: 'ignore' });
    const [key, cert] = await Promise.all([readFile(key_path), readFile(cert_path)]);
    const server = https.createServer({ key, cert }, listener);
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const original_get = https.get;
    const seen_options: https.RequestOptions[] = [];
    t.mock.method(https, 'get', (options: https.RequestOptions, callback: (res: IncomingMessage) => void) => {
      seen_options.push(options);
      assert.equal(options.rejectUnauthorized, undefined);
      assert.equal(options.host, options.servername);
      assert.ok(options.lookup);
      const pinned_lookup = options.lookup;
      const local_lookup: LookupFunction = (hostname, lookup_options, done) => {
        pinned_lookup(hostname, lookup_options, (err, pinned_address, family) => {
          assert.equal(err, null);
          assert.deepEqual(pinned_address, lookup_options.all ? [{ address: '93.184.216.34', family: 4 }] : '93.184.216.34');
          if (lookup_options.all) {
            const all_done = done as unknown as (err: null, addresses: { address: string; family: number }[]) => void;
            all_done(null, [{ address: '127.0.0.1', family: 4 }]);
          } else {
            assert.equal(family, 4);
            done(null, '127.0.0.1', 4);
          }
        });
      };
      return original_get({ ...options, port: address.port, ca: cert, lookup: local_lookup, agent: false }, callback);
    });
    return { server, seen_options };
  }
}
