import { Schema } from 'mongoose';
import { Role } from '../types/message.types.js';
import type { Conversation, ConversationMessage } from '../types/conversation.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';

export class ConversationModelFactory extends BaseModelFactory<Conversation> {
  protected buildSchema(): Schema<Conversation> {
    const ContextRefSchema = new Schema(
      {
        corpus: { type: String, required: true },
        document_id: { type: String, required: true },
      },
      { _id: false, id: false }
    );

    const schema = new Schema<Conversation>(
      {
        conversation_id: { type: String, required: true, unique: true, index: true },
        user_id: { type: String, default: undefined, index: true },
        agent_id: { type: String, required: true, index: true },
        context_ref: { type: ContextRefSchema, default: undefined },
        title: { type: String, default: undefined },
        is_pinned: { type: Boolean, default: false },
        last_provider_response_id: { type: String, default: undefined },
      },
      {
        collection: 'conversations',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
      }
    );

    schema.index({ user_id: 1, is_pinned: 1, updated_at: -1 }, { name: 'by_user_pinned_updated' });
    schema.index(
      { user_id: 1, 'context_ref.corpus': 1, 'context_ref.document_id': 1, updated_at: -1 },
      { name: 'by_user_context_updated', partialFilterExpression: { context_ref: { $exists: true } } }
    );

    schema.set('toJSON', {
      transform(_doc, ret) {
        return MongooseUtils.stripMongoFields(ret);
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
    const ToolCallSchema = new Schema(
      {
        tool_call_id: { type: String, required: true },
        tool_name: { type: String, required: true },
        arguments: { type: Schema.Types.Mixed, default: undefined },
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
        content: { type: Schema.Types.Mixed, required: true, default: [] },
        tool_call_id: { type: String, default: undefined },
        tool_calls: { type: [ToolCallSchema], default: undefined },
        provider_response_id: { type: String, default: undefined },
        citations: { type: Schema.Types.Mixed, default: undefined },
        usage: { type: UsageSchema, default: undefined },
        model: { type: String, default: undefined },
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
        return MongooseUtils.stripMongoFields(ret);
      },
    });

    return schema;
  }

  protected getModelName(): string {
    return 'ConversationMessage';
  }
}
