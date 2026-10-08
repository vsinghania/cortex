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
