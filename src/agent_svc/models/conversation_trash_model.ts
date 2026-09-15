import { Schema } from 'mongoose';
import { Role } from '../types/message.types.js';
import type {
  TrashedConversation,
  TrashedConversationMessage,
} from '../types/conversation_trash.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { Time } from '../../lib/time.js';

const TRASH_RETENTION_DAYS = 30;

// Snapshots of deleted conversations and their messages. Entries keep the live _id and
// timestamps, so the repository can upsert them idempotently; a TTL index expires them.
export class ConversationTrashModelFactory extends BaseModelFactory<TrashedConversation> {
  protected buildSchema(): Schema<TrashedConversation> {
    const schema = new Schema<TrashedConversation>(
      {
        conversation_id: { type: String, required: true, index: true },
        user_id: { type: String, default: undefined },
        agent_id: { type: String, required: true },
        title: { type: String, default: undefined },
        is_pinned: { type: Boolean, default: false },
        last_provider_response_id: { type: String, default: undefined },
        created_at: { type: Date, required: true },
        updated_at: { type: Date, required: true },
        deleted_at: { type: Date, required: true },
      },
      {
        collection: 'conversations_trash',
        versionKey: false,
        timestamps: false,
      }
    );

    schema.index({ user_id: 1, deleted_at: -1 }, { name: 'by_user_deleted' });
    schema.index(
      { deleted_at: 1 },
      { name: 'conversation_trash_ttl', expireAfterSeconds: Time.daysToSec(TRASH_RETENTION_DAYS) }
    );

    schema.set('toJSON', {
      transform(_doc, ret) {
        return MongooseUtils.stripMongoFields(ret);
      },
    });

    return schema;
  }

  protected getModelName(): string {
    return 'ConversationTrash';
  }
}

export class ConversationMessageTrashModelFactory extends BaseModelFactory<TrashedConversationMessage> {
  protected buildSchema(): Schema<TrashedConversationMessage> {
    const schema = new Schema<TrashedConversationMessage>(
      {
        conversation_id: { type: String, required: true, index: true },
        turn: { type: Number, required: true },
        role: { type: String, enum: Object.values(Role), required: true },
        content: { type: Schema.Types.Mixed, required: true, default: [] },
        tool_call_id: { type: String, default: undefined },
        tool_calls: { type: Schema.Types.Mixed, default: undefined },
        provider_response_id: { type: String, default: undefined },
        citations: { type: Schema.Types.Mixed, default: undefined },
        usage: { type: Schema.Types.Mixed, default: undefined },
        model: { type: String, default: undefined },
        created_at: { type: Date, required: true },
        deleted_at: { type: Date, required: true },
      },
      {
        collection: 'conversation_messages_trash',
        versionKey: false,
        timestamps: false,
      }
    );

    schema.index(
      { deleted_at: 1 },
      {
        name: 'conversation_message_trash_ttl',
        expireAfterSeconds: Time.daysToSec(TRASH_RETENTION_DAYS),
      }
    );

    schema.set('toJSON', {
      transform(_doc, ret) {
        return MongooseUtils.stripMongoFields(ret);
      },
    });

    return schema;
  }

  protected getModelName(): string {
    return 'ConversationMessageTrash';
  }
}
