/**
 * Where the public MCP resources live and which authorization server they trust. The
 * resource side's own settings: the authorization server is configured separately.
 */
export type McpPublicConfig = {
  /** Each resource is this plus its path (`https://mcp.cortexapp.me/notes`). */
  base_url: URL;
  /** The issuer the resources advertise and accept tokens from. */
  authorization_server_url: URL;
};

/** The access levels a user chooses between when connecting an assistant to one resource. */
export type McpAccess = 'read' | 'read_write';

/** Every public MCP server Cortex can expose. Add an id here when adding a server. */
export type McpResourceId = 'notes';

/**
 * One public MCP server, as the authorization server and the public MCP gateway see it.
 * Scope names and the assertion audience come from the server's own contract class.
 */
export type McpResourceDefinition = {
  id: McpResourceId;
  /** Appended to MCP_PUBLIC_BASE_URL to form the resource's canonical URL. */
  path: string;
  display_name: string;
  scopes: { read: string; write: string };
  /** The consent page's wording for each access level. */
  access_copy: Record<McpAccess, string>;
  /** Where the gateway forwards to; a resource whose variable is unset is not served. */
  internal_url_env: string;
  /** The audience the server's assertions must name. */
  assertion_audience: string;
};

/** An enabled resource: its definition plus where it lives, publicly and internally. */
export type McpResource = McpResourceDefinition & {
  /** The canonical public URL: what tokens are issued for (RFC 8707). */
  url: string;
  internal_url: string;
};
