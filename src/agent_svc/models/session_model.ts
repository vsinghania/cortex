import { Schema } from 'mongoose';
import type { AgentSession } from '../types/session.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class AgentSessionModelFactory extends BaseModelFactory<AgentSession> {
  protected buildSchema(): Schema<AgentSession> {
    const SessionSummaryAgentSchema = new Schema(
      {
        agent_id: { type: String, default: undefined },
        agent_name: { type: String, default: undefined },
        first_used_at: { type: Date, required: true },
        last_used_at: { type: Date, required: true }
      },
      { _id: false, id: false }
    );

    const SessionMetadataSchema = new Schema(
      {
        message_count: { type: Number, required: true, default: 0 },
        last_message_at: { type: Date, default: undefined },
        agents: { type: [SessionSummaryAgentSchema], default: undefined }
      },
      { _id: false, id: false }
    );

    const AgentSessionSchema = new Schema<AgentSession>(
      {
        user_id: { type: String, required: true, index: true }, // UUID (domain id)
        session_id: { type: String, required: true, index: true }, // UUID (domain id)
        session_name: { type: String, required: true, default: '' },
        live_mode: { type: String, enum: ['live', 'background'], required: true, default: 'live' },
        is_archived: { type: Boolean, required: true, default: false },
        metadata: { type: SessionMetadataSchema, default: undefined }
      },
      {
        collection: 'agent_sessions',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    AgentSessionSchema.index({ user_id: 1, session_id: 1 }, { unique: true, name: 'uniq_user_session' });
    AgentSessionSchema.index({ user_id: 1, updated_at: -1 }, { name: 'by_user_updated' });

    // Output shaping
    AgentSessionSchema.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret;
      }
    });

    return AgentSessionSchema;
  }

  protected getModelName(): string {
    return 'AgentSession';
  }
}
