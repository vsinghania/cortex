import type { Connection } from 'mongoose';
import { MongooseConnectionManager } from './mongoose_connection_manager.js';

export type DbHealthStatus = 'up' | 'down';

export type DbConnectionDetail = {
  host: string;
  port: number;
  ready_state: number;
  state: string;
  db_name?: string;
};

export type DbHealth = {
  status: DbHealthStatus;
  details: DbConnectionDetail[];
};

export class DbHealthUtils {
  private constructor() {}

  private static readyStateToString(ready_state: number): string {
    switch (ready_state) {
      case 0:
        return 'disconnected';
      case 1:
        return 'connected';
      case 2:
        return 'connecting';
      case 3:
        return 'disconnecting';
      default:
        return 'unknown';
    }
  }

  private static describe(conn: Connection | null) {
    if (!conn) {
      return {
        ready_state: 0,
        state: 'disconnected' as const,
        db_name: undefined,
        host: undefined
      };
    }
    return {
      ready_state: conn.readyState,
      state: DbHealthUtils.readyStateToString(conn.readyState),
      db_name: conn.name,
      host: (conn as any).host
    };
  }

  public static getDbHealth(params?: { host?: string; port?: number }): DbHealth {
    const mgr = MongooseConnectionManager.getExistingInstance();
    if (!mgr) {
      return { status: 'down', details: [] };
    }

    const roots = mgr.listRootConnections(params);
    const details = roots.map(({ host, port, connection }) => ({
      host,
      port,
      ready_state: connection.readyState,
      state: DbHealthUtils.readyStateToString(connection.readyState),
      db_name: connection.name
    }));

    const status: DbHealthStatus = details.length > 0 && details.every((d) => d.ready_state === 1) ? 'up' : 'down';
    return { status, details };
  }
}
