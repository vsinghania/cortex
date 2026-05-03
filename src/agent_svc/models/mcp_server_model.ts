import { Schema } from 'mongoose';
import type { McpServerManifest } from '../types/mcp_server.types.js';
import { McpServerMode, McpTransport } from '../types/mcp_server.types.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';

export class McpServerModelFactory extends BaseModelFactory<McpServerManifest> {
  protected buildSchema(): Schema<McpServerManifest> {
    const schema = new Schema<McpServerManifest>(
      {
        mcp_server_id: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        mode: {
          type: String,
          enum: Object.values(McpServerMode),
          required: true,
        },
        transport: {
          type: String,
          enum: Object.values(McpTransport),
          required: true,
          default: McpTransport.Http,
        },
        http: {
          base_url: { type: String, required: true },
          headers: { type: Map, of: String, default: undefined },
          auth_token_env: { type: String, default: undefined },
        },
        enabled: { type: Boolean, default: true, index: true },
        version: { type: Number, default: 1 },
      },
      {
        collection: 'mcp_servers',
        versionKey: false,
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
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
    return 'McpServerManifest';
  }
}
