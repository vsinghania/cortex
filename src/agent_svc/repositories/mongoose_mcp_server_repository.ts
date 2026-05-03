import type { Connection, Model } from 'mongoose';
import type { McpServerManifest } from '../types/mcp_server.types.js';
import type { McpServerRepositoryInterface } from './mcp_server_repository_interface.js';
import { McpServerModelFactory } from '../models/mcp_server_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { mcp_server_manifest_schema } from '../types/mcp_server.schema.js';
import { InternalServerError } from '../../common/errors.js';

export class MongooseMcpServerRepository implements McpServerRepositoryInterface {
  private static readonly factory = new McpServerModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<McpServerManifest>
  ) {}

  static async create(): Promise<MongooseMcpServerRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const db = DbNameResolver.resolve('agent');
    const conn = await mgr.getDbConnection({ db });
    const model = MongooseMcpServerRepository.factory.getModel(conn);
    return new MongooseMcpServerRepository(conn, model);
  }

  async listEnabled(): Promise<McpServerManifest[]> {
    const docs = await this.model.find({ enabled: true }).lean();
    return docs.map((d) => MongooseMcpServerRepository.toDomain(d));
  }

  async getById(mcp_server_id: string): Promise<McpServerManifest | null> {
    const doc = await this.model.findOne({ mcp_server_id }).lean();
    return doc ? MongooseMcpServerRepository.toDomain(doc) : null;
  }

  async upsertByMcpServerId(
    manifest: Omit<McpServerManifest, 'created_at' | 'updated_at'>
  ): Promise<McpServerManifest> {
    const updated = await this.model
      .findOneAndUpdate(
        { mcp_server_id: manifest.mcp_server_id },
        { $set: manifest },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .lean();
    if (!updated) {
      throw new InternalServerError('Failed to upsert MCP server manifest', {
        details: { mcp_server_id: manifest.mcp_server_id },
      });
    }
    return MongooseMcpServerRepository.toDomain(updated);
  }

  async setEnabled(
    mcp_server_id: string,
    enabled: boolean
  ): Promise<McpServerManifest | null> {
    const doc = await this.model
      .findOneAndUpdate({ mcp_server_id }, { $set: { enabled } }, { new: true })
      .lean();
    return doc ? MongooseMcpServerRepository.toDomain(doc) : null;
  }

  async deleteByMcpServerId(mcp_server_id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ mcp_server_id });
    return (res.deletedCount ?? 0) > 0;
  }

  private static toDomain(raw: unknown): McpServerManifest {
    const obj = MongooseUtils.toDomain<unknown>(raw);
    const normalized = MongooseMcpServerRepository.normalizeHeaders(obj);
    return mcp_server_manifest_schema.parse(normalized);
  }

  private static normalizeHeaders(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    const record = obj as Record<string, unknown>;
    const http = record.http;
    if (!http || typeof http !== 'object') return obj;
    const http_record = http as Record<string, unknown>;
    const headers = http_record.headers;
    if (headers instanceof Map) {
      http_record.headers = Object.fromEntries(headers);
    }
    return obj;
  }
}
