import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupNotesTools } from './adapter.js';
import { NotesSvc } from '../../../notes_svc/notes_svc.js';
import { MongooseConnectionManager } from '../../../db/mongo/mongoose_connection_manager.js';
import { logger } from '../../../common/logger.js';
import { DbNameResolver } from '../../../db/mongo/db_name_resolver.js';

async function main() {
  const host = process.env.MONGO_HOST ?? 'localhost';
  const port = Number(process.env.MONGO_PORT ?? 27017);
  const db = DbNameResolver.resolve('notes');

  try {
    // Bootstrap Mongo base connection (admin DB)
    await MongooseConnectionManager.getInstance({ host, port });
    logger.info({ msg: 'Mongo base connection bootstrapped for MCP server', host, port });
  } catch (e) {
    logger.warn({ msg: 'Mongo bootstrap failed for MCP server; continuing. Tools may error.', error: (e as Error)?.message });
  }

  // Create Notes service bound to application DB
  const notes_svc = await NotesSvc.createWithMongo({ db, host, port });

  const server = new McpServer(
    { name: 'notes-mcp', version: '1.0.0' },
    {
      debouncedNotificationMethods: [
        'notifications/tools/list_changed',
        'notifications/resources/list_changed',
        'notifications/prompts/list_changed'
      ]
    }
  );

  // Register domain tools
  setupNotesTools(server, notes_svc);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Notes MCP server (stdio) is ready.');

  const shutdown = async () => {
    try {
      const mgr = MongooseConnectionManager.getExistingInstance();
      if (mgr) {
        await mgr.disconnectAll();
      }
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Notes MCP server failed to start', err);
  process.exit(1);
});
