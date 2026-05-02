import { Schema } from 'mongoose';
import { Role } from '../../ai_svc/types/ai_prompt.types.js';
import type { Conversation, ConversationMessage } from '../types/conversation.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

export class ConversationModelFactory extends BaseModelFactory<Conversation> {
  protected buildSchema(): Schema<Conversation> {
    const schema = new Schema<Conversation>(
      {
        conversation_id: { type: String, required: true, unique: true, index: true },
        user_id: { type: String, default: undefined, index: true },
        agent_id: { type: String, required: true, index: true },
        title: { type: String, default: undefined },
        last_response_id: { type: String, default: undefined },
      },
      {
        collection: 'conversations',
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
    return 'Conversation';
  }
}

export class ConversationMessageModelFactory extends BaseModelFactory<ConversationMessage> {
  protected buildSchema(): Schema<ConversationMessage> {
    const ToolInvocationSchema = new Schema(
      {
        tool_name: { type: String, required: true },
        arguments: { type: Schema.Types.Mixed, default: undefined },
        result: { type: Schema.Types.Mixed, required: true },
        duration_ms: { type: Number, required: true },
        turn: { type: Number, required: true },
      },
      { _id: false, id: false }
    );

    const UsageSchema = new Schema(
      {
        prompt_tokens: { type: Number, default: 0 },
        response_tokens: { type: Number, default: 0 },
        total_tokens: { type: Number, default: 0 },
      },
      { _id: false, id: false }
    );

    const schema = new Schema<ConversationMessage>(
      {
        conversation_id: { type: String, required: true, index: true },
        turn: { type: Number, required: true },
        role: { type: String, enum: Object.values(Role), required: true },
        content: { type: String, required: true, default: '' },
        tool_calls: { type: [ToolInvocationSchema], default: undefined },
        usage: { type: UsageSchema, default: undefined },
        model: { type: String, default: undefined },
        response_id: { type: String, default: undefined },
      },
      {
        collection: 'conversation_messages',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: false },
      }
    );

    schema.index({ conversation_id: 1, turn: 1 }, { name: 'by_conversation_turn' });

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
    return 'ConversationMessage';
  }
}
