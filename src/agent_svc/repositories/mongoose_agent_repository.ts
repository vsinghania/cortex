import type { Connection, Model } from 'mongoose';
import type { AgentManifest, AgentUpdatePatch } from '../types/agent.types.js';
import type { AgentRepositoryInterface } from './agent_repository_interface.js';
import { AgentModelFactory } from '../models/agent_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { DbNameResolver } from '../../db/mongo/db_name_resolver.js';
import { agent_manifest_schema } from '../types/agent_manifest.schema.js';
import { InternalServerError } from '../../common/errors.js';

export class MongooseAgentRepository implements AgentRepositoryInterface {
  private static readonly factory = new AgentModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<AgentManifest>
  ) {}

  static async create(): Promise<MongooseAgentRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const db = DbNameResolver.resolve('agent');
    const conn = await mgr.getDbConnection({ db });
    const model = MongooseAgentRepository.factory.getModel(conn);
    return new MongooseAgentRepository(conn, model);
  }

  async listEnabled(): Promise<AgentManifest[]> {
    const docs = await this.model.find({ enabled: true }).lean();
    return docs.map((d) => MongooseAgentRepository.toDomain(d));
  }

  async getById(agent_id: string): Promise<AgentManifest | null> {
    const doc = await this.model.findOne({ agent_id }).lean();
    return doc ? MongooseAgentRepository.toDomain(doc) : null;
  }

  async create(
    manifest: Omit<AgentManifest, 'created_at' | 'updated_at'>
  ): Promise<AgentManifest> {
    const created = await this.model.create(manifest);
    return MongooseAgentRepository.toDomain(created);
  }

  async updateByAgentId(
    agent_id: string,
    patch: AgentUpdatePatch
  ): Promise<AgentManifest | null> {
    const update = MongooseAgentRepository.toUpdateOperator(patch);
    const doc = await this.model.findOneAndUpdate({ agent_id }, update, { new: true }).lean();
    return doc ? MongooseAgentRepository.toDomain(doc) : null;
  }

  private static toUpdateOperator(patch: AgentUpdatePatch): Record<string, unknown> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        unset[key] = 1;
      } else if (value !== undefined) {
        set[key] = value;
      }
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;
    return update;
  }

  async upsertByAgentId(
    manifest: Omit<AgentManifest, 'created_at' | 'updated_at'>
  ): Promise<AgentManifest> {
    const updated = await this.model.findOneAndUpdate(
      { agent_id: manifest.agent_id },
      { $set: manifest },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    if (!updated) {
      throw new InternalServerError('Failed to upsert agent manifest', {
        details: { agent_id: manifest.agent_id },
      });
    }
    return MongooseAgentRepository.toDomain(updated);
  }

  async setEnabled(agent_id: string, enabled: boolean): Promise<AgentManifest | null> {
    const doc = await this.model.findOneAndUpdate(
      { agent_id },
      { $set: { enabled } },
      { new: true }
    ).lean();
    return doc ? MongooseAgentRepository.toDomain(doc) : null;
  }

  async deleteByAgentId(agent_id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ agent_id });
    return (res.deletedCount ?? 0) > 0;
  }

  private static toDomain(raw: unknown): AgentManifest {
    const obj = MongooseUtils.toDomain<unknown>(raw);
    return agent_manifest_schema.parse(obj);
  }
}
