import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';

export type ProtectedResourceMetadataDocument = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
};

/**
 * RFC 9728 metadata for the `/mcp` resource: the document a client that holds only the
 * MCP URL reads to find out which authorization server to ask for a token.
 */
export class ProtectedResourceMetadata {
  private constructor() {}

  static build(input: {
    resource: string;
    authorization_server: string;
    scopes: readonly string[];
    resource_name: string;
  }): ProtectedResourceMetadataDocument {
    return {
      resource: input.resource,
      authorization_servers: [input.authorization_server],
      scopes_supported: [...input.scopes],
      bearer_methods_supported: ['header'],
      resource_name: input.resource_name
    };
  }

  /** `https://host/.well-known/oauth-protected-resource/mcp` for `https://host/mcp`. */
  static urlFor(resource: URL): string {
    return getOAuthProtectedResourceMetadataUrl(resource);
  }
}
