import { Schema } from 'mongoose';
import type { AgentManifest } from '../types/agent.types.js';
import { AgentImplKind } from '../types/agent.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class AgentModelFactory extends BaseModelFactory<AgentManifest> {
  protected buildSchema(): Schema<AgentManifest> {
    const schema = new Schema<AgentManifest>(
      {
        agent_id: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        instructions: { type: String, required: true },
        model: { type: String, default: undefined },
        implementation: {
          type: String,
          enum: Object.values(AgentImplKind),
          required: true,
          default: AgentImplKind.OpenAiAgents,
        },
        tool_names: { type: [String], default: [] },
        tool_agent_ids: { type: [String], default: [] },
        handoff_agent_ids: { type: [String], default: [] },
        mcp_server_ids: { type: [String], default: [] },
        output_schema_ref: { type: String, default: undefined },
        enabled: { type: Boolean, default: true, index: true },
        version: { type: Number, default: 1 },
      },
      {
        collection: 'agents',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
      }
    );

    schema.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      },
    });

    return schema;
  }

  protected getModelName(): string {
    return 'AgentManifest';
  }
}
