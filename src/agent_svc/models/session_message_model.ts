import { Schema } from 'mongoose';
import type { AgentSessionMessage, SessionMessage } from '../types/session_message.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class AgentSessionMessageModelFactory extends BaseModelFactory<AgentSessionMessage> {
  protected buildSchema(): Schema<AgentSessionMessage> {
    // Subschemas
    const SenderSchema = new Schema(
      {
        name: { type: String, required: true },
        role: { type: String, enum: ['user', 'model', 'tool', 'mcp'], required: true }
      },
      { _id: false, id: false }
    );

    const AgentContextSchema = new Schema(
      {
        agent_id: { type: String, default: undefined },
        agent_name: { type: String, default: undefined },
        provider: { type: String, default: undefined },
        model: { type: String, default: undefined },
        provider_session_id: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const ToolCallDetailsSchema = new Schema(
      {
        tool_name: { type: String, required: true },
        arguments: { type: Schema.Types.Mixed, default: undefined }
      },
      { _id: false, id: false }
    );

    const McpDetailsSchema = new Schema(
      {
        server_name: { type: String, required: true },
        tool_name: { type: String, required: true },
        arguments: { type: Schema.Types.Mixed, default: undefined },
        resource_uri: { type: String, default: undefined }
      },
      { _id: false, id: false }
    );

    const MessageContentSchema = new Schema(
      {
        data: { type: Schema.Types.Mixed, required: true },
        data_type: { type: String, enum: ['json', 'string'], required: true },
        tool_details: { type: ToolCallDetailsSchema, default: undefined },
        mcp_details: { type: McpDetailsSchema, default: undefined }
      },
      { _id: false, id: false }
    );

    const AgentSessionMessageSchema = new Schema<AgentSessionMessage>(
      {
        user_id: { type: String, required: true, index: true },
        session_id: { type: String, required: true, index: true },

        message_id: { type: String, required: true, index: true },
        sender: { type: SenderSchema, required: true },
        agent_context: { type: AgentContextSchema, default: undefined },
        model_response_type: {
          type: String,
          enum: ['output', 'tool_call', 'mcp_call', 'human_approval'],
          required: true
        },
        content: { type: MessageContentSchema, required: true },
        timestamp: { type: Date, required: true },
        provider_response_id: { type: String, default: undefined }
      },
      {
        collection: 'agent_session_messages',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
      }
    );

    // Indexes
    AgentSessionMessageSchema.index(
      { user_id: 1, session_id: 1, timestamp: 1, message_id: 1 },
      { name: 'by_session_time' }
    );
    AgentSessionMessageSchema.index(
      { user_id: 1, session_id: 1, message_id: 1 },
      { name: 'by_session_message' }
    );
    AgentSessionMessageSchema.index(
      { provider_response_id: 1 },
      { name: 'by_provider_response_id', partialFilterExpression: { provider_response_id: { $type: 'string' } } as any }
    );
    AgentSessionMessageSchema.index(
      { user_id: 1, session_id: 1, 'agent_context.agent_id': 1, timestamp: -1 },
      { name: 'by_session_agent', partialFilterExpression: { 'agent_context.agent_id': { $type: 'string' } } as any }
    );

    // Output shaping
    AgentSessionMessageSchema.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        Reflect.deleteProperty(ret as any, '__v');
        return ret as SessionMessage;
      }
    });

    return AgentSessionMessageSchema;
  }

  protected getModelName(): string {
    return 'AgentSessionMessage';
  }
}
