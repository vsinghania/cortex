import mongoose, { type Connection, type ConnectOptions } from 'mongoose';
import { logger } from '../../common/logger.js';

type BootstrapOptions = {
  minPoolSize?: number;
  maxPoolSize?: number;
  serverSelectionTimeoutMS?: number;
};



export class MongooseConnectionManager {
  private static instance: MongooseConnectionManager | null = null;
  private base_host: string | null = null;
  private base_port: number | null = null;
  private base_conn: Connection | null = null;

  private base_bootstrap_opts?: BootstrapOptions;

  // Root connections keyed by "host:port"
  private root_conns = new Map<string, Connection>();
  // In-flight creations keyed by "host:port" to dedupe concurrent connect attempts
  private in_flight = new Map<string, Promise<Connection>>();

  private constructor() {}

  private static uriFor(host: string, port: number, db: string) {
    return `mongodb://${host}:${port}/${db}`;
  }

  private static toConnectOptions(opts?: BootstrapOptions): ConnectOptions {
    return {
      minPoolSize: opts?.minPoolSize ?? 5,
      maxPoolSize: opts?.maxPoolSize ?? 10,
      serverSelectionTimeoutMS: opts?.serverSelectionTimeoutMS ?? 5000
    };
  }

  static async getInstance(params?: { host: string; port: number; options?: BootstrapOptions }): Promise<MongooseConnectionManager> {
    if (!MongooseConnectionManager.instance) {
      const inst = new MongooseConnectionManager();
      MongooseConnectionManager.instance = inst;
      if (params) {
        await inst.bootstrap(params);
      }
      return inst;
    }

    const inst = MongooseConnectionManager.instance;
    if (params) {
      // If already bootstrapped with a different host/port, keep existing and warn
      if (inst.base_host !== null && (inst.base_host !== params.host || inst.base_port !== params.port)) {
        logger.warn({
          msg: 'getInstance called with different host/port than existing instance; ignoring new params',
          existing_host: inst.base_host,
          existing_port: inst.base_port,
          requested_host: params.host,
          requested_port: params.port
        });
      } else if (!inst.isBaseConnected()) {
        await inst.bootstrap(params);
      }
    }
    return inst;
  }

  static getExistingInstance(): MongooseConnectionManager | null {
    return MongooseConnectionManager.instance;
  }

  isBaseConnected(): boolean {
    return this.base_conn?.readyState === 1;
  }

  getBaseConnection(): Connection | null {
    return this.base_conn;
  }

  private async bootstrap(params: {
    host: string;
    port: number;
    options?: BootstrapOptions;
  }): Promise<void> {
    const { host, port, options } = params;
    const root_key = `${host}:${port}`;

    // If already bootstrapped with same host/port and connected, ensure root cache has it and return
    if (this.base_conn && this.base_host === host && this.base_port === port && this.isBaseConnected()) {
      if (!this.root_conns.has(root_key)) {
        this.root_conns.set(root_key, this.base_conn);
      }
      this.base_bootstrap_opts = options ?? this.base_bootstrap_opts;
      return;
    }

    // Close previous base if any (do not touch other roots)
    if (this.base_conn) {
      try {
        this.base_conn.removeAllListeners();
        await this.base_conn.close();
      } catch (e) {
        logger.warn({ msg: 'Error closing previous base connection', error: (e as Error)?.message });
      }
      this.base_conn = null;
    }

    const connect_opts = MongooseConnectionManager.toConnectOptions(options);
    this.base_bootstrap_opts = options;

    // If a root already exists for this host:port, promote it to base
    const existing_root = this.root_conns.get(root_key);
    if (existing_root) {
      await existing_root.asPromise();
      this.base_conn = existing_root;
      this.base_host = host;
      this.base_port = port;
      logger.info({ msg: 'Bootstrapped Mongo base from existing root', host, port, ...connect_opts });
      return;
    }

    const uri = MongooseConnectionManager.uriFor(host, port, 'admin'); // base/root connects to admin
    logger.info({ msg: 'Bootstrapping Mongo base connection', host, port, ...connect_opts });

    const conn = mongoose.createConnection(uri, connect_opts);
    const ready = await conn.asPromise();

    this.base_conn = ready;
    this.base_host = host;
    this.base_port = port;

    this.root_conns.set(root_key, ready);
    this.attachConnEvents(ready, `root:${root_key}`);
  }

  async getRootConnection(params?: { host?: string; port?: number }): Promise<Connection> {
    const host = params?.host ?? this.base_host ?? undefined;
    const port = params?.port ?? this.base_port ?? undefined;

    if (!host || typeof port !== 'number') {
      throw new Error('Mongo manager not bootstrapped and host/port not provided');
    }

    const key = `${host}:${port}`;
    const existing = this.root_conns.get(key);
    if (existing) {
      if (existing.readyState === 1) return existing;
      return existing.asPromise();
    }

    const inflight = this.in_flight.get(key);
    if (inflight) return inflight;

    const uri = MongooseConnectionManager.uriFor(host, port, 'admin');
    const connect_opts = MongooseConnectionManager.toConnectOptions(this.base_bootstrap_opts);

    logger.info({ msg: 'Creating Mongo root connection', host, port, ...connect_opts });

    const conn = mongoose.createConnection(uri, connect_opts);
    const promise = this.openRootConnection(conn, host, port, key);
    this.in_flight.set(key, promise);
    return promise;
  }

  private async openRootConnection(
    conn: Connection,
    host: string,
    port: number,
    key: string
  ): Promise<Connection> {
    try {
      const ready = await conn.asPromise();
      this.root_conns.set(key, ready);
      this.attachConnEvents(ready, `root:${key}`);
      if (this.base_host === host && this.base_port === port && !this.base_conn) {
        this.base_conn = ready;
      }
      return ready;
    } finally {
      this.in_flight.delete(key);
    }
  }

  async getDbConnection(params: { db: string; host?: string; port?: number }): Promise<Connection> {
    const host = params.host ?? this.base_host ?? undefined;
    const port = params.port ?? this.base_port ?? undefined;
    const db = params.db;

    if (!host || typeof port !== 'number') {
      throw new Error('Mongo manager not bootstrapped and host/port not provided');
    }
    if (!db) {
      throw new Error('db is required to obtain a DB connection');
    }

    const root = await this.getRootConnection({ host, port });
    // useCache ensures the same per-db Connection instance is reused
    return root.useDb(db, { useCache: true });
  }

  listRootConnections(params?: { host?: string; port?: number }): Array<{ host: string; port: number; connection: Connection }> {
    const results: Array<{ host: string; port: number; connection: Connection }> = [];
    for (const [key, connection] of this.root_conns.entries()) {
      const [h, pStr] = key.split(':');
      const p = Number(pStr);
      if (params?.host && params.host !== h) continue;
      if (typeof params?.port === 'number' && params.port !== p) continue;
      results.push({ host: h, port: p, connection });
    }
    return results;
  }

  async disconnectAll(): Promise<void> {
    const promises: Promise<unknown>[] = [];

    for (const [key, conn] of this.root_conns.entries()) {
      conn.removeAllListeners();
      promises.push(this.closeRootConnection(conn, key));
    }

    this.root_conns.clear();
    this.base_conn = null;
    this.base_host = null;
    this.base_port = null;
    this.in_flight.clear();

    await Promise.all(promises);
  }

  private async closeRootConnection(conn: Connection, key: string): Promise<void> {
    try {
      await conn.close();
      logger.info({ msg: 'Closed Mongo root connection', key });
    } catch (e) {
      logger.warn({ msg: 'Error closing Mongo root connection', key, error: (e as Error)?.message });
    }
  }

  private attachConnEvents(conn: Connection, name: string) {
    conn.on('connected', () => logger.info({ msg: 'Mongo connected', name, host: (conn as any).host, db: conn.name }));
    conn.on('reconnected', () => logger.warn({ msg: 'Mongo reconnected', name }));
    conn.on('disconnected', () => logger.warn({ msg: 'Mongo disconnected', name }));
    conn.on('error', (err) =>
      logger.error({ msg: 'Mongo error', name, error: (err as Error)?.message, stack: (err as Error)?.stack })
    );
  }
}
