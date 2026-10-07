/** What the consent screen offers; the server turns it into the resource's OAuth scopes. */
export type McpAccess = 'read' | 'read_write';

/** One choice on the consent screen, worded by the server for the resource it grants. */
export type OAuthAccessOption = {
  value: McpAccess;
  label: string;
  detail: string;
  /** False when the app did not ask for this much. */
  available: boolean;
};

/** A ChatGPT/Claude/... authorization waiting for the signed-in user's answer. */
export type OAuthConsentRequest = {
  request_id: string;
  /** Supplied by the app in its metadata document, so shown as a claim, never as verified. */
  client_name: string;
  /** The host serving the app's metadata document: an identity the app cannot fake. */
  client_host: string;
  /** Where the browser goes next. */
  redirect_host: string;
  /** Which of Cortex's MCP servers the app wants to reach (Notes, ...). */
  resource: { id: string; name: string };
  requested_scopes: string[];
  access_options: OAuthAccessOption[];
  default_access: McpAccess;
};

/** Dates arrive as ISO strings; nothing here is ever a token. */
export type ConnectedApp = {
  grant_id: string;
  client_name: string;
  client_host: string | null;
  /** Which MCP server the connection is for (Notes, ...); null if it is no longer served. */
  resource_id: string | null;
  resource_name: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
};

export type ConnectedAppsStatus = {
  /** False when this server has no public MCP configured. */
  available: boolean;
  /** The MCP servers a user can connect, each with the URL to paste into an assistant. */
  resources: { id: string; name: string; url: string }[];
  grants: ConnectedApp[];
};
