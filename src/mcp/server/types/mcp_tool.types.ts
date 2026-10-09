import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';

export type McpToolConfig<Args> = {
  title: string;
  description: string;
  inputSchema: StandardSchemaWithJSON<unknown, Args>;
  outputSchema?: StandardSchemaWithJSON;
  annotations: ToolAnnotations;
};

export type McpToolRegistration<Args> = {
  name: string;
  config: McpToolConfig<Args>;
  /** The OAuth scope a caller's grant must carry; internal callers always pass. */
  required_scope: string;
  handler: (args: Args) => Promise<Record<string, unknown>>;
};
