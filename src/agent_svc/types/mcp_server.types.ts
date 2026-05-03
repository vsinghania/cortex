export enum McpServerMode {
  SelfHosted = 'self_hosted',
  PublicHosted = 'public_hosted',
}

export enum McpTransport {
  Http = 'http',
}

export type McpHttpConfig = {
  base_url: string;
  headers?: Record<string, string>;
  auth_token_env?: string;
};

export type McpServerManifest = {
  mcp_server_id: string;
  name: string;
  mode: McpServerMode;
  transport: McpTransport;
  http: McpHttpConfig;
  enabled: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};
