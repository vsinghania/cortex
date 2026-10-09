import { CanonicalUrl } from '../../lib/canonical_url.js';
import { NotesMcpContract } from '../server/notes/notes_mcp_contract.js';
import { McpPublicConfigLoader } from './config/mcp_public_config.js';
import type { McpAccess, McpResource, McpResourceDefinition, McpResourceId } from './mcp_resource.types.js';

const NOTES: McpResourceDefinition = {
  id: 'notes',
  path: '/notes',
  display_name: 'Notes',
  scopes: { read: NotesMcpContract.READ, write: NotesMcpContract.WRITE },
  access_copy: {
    read: 'Search and read your notes and folders.',
    read_write: 'Also create, edit, organise and delete notes.'
  },
  internal_url_env: 'MCP_NOTES_INTERNAL_URL',
  assertion_audience: NotesMcpContract.ASSERTION_AUDIENCE
};

/**
 * The public MCP servers Cortex exposes, each at MCP_PUBLIC_BASE_URL + its path
 * (`https://mcp.cortexapp.me/notes`). The authorization server issues tokens only for
 * these; the gateway mounts one route per entry. Adding a server is a new definition
 * here and its internal URL, not new OAuth or gateway code.
 */
export class McpResourceCatalog {
  static readonly DEFINITIONS: readonly McpResourceDefinition[] = [NOTES];

  private constructor(private readonly resources: readonly McpResource[]) {}

  /** Empty when the public MCP is not configured. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): McpResourceCatalog {
    const config = McpPublicConfigLoader.fromEnv(env);
    return config ? McpResourceCatalog.create({ base_url: config.base_url, env }) : new McpResourceCatalog([]);
  }

  /** Only resources whose internal URL is configured are enabled. */
  static create(input: {
    base_url: URL;
    env?: NodeJS.ProcessEnv;
    definitions?: readonly McpResourceDefinition[];
  }): McpResourceCatalog {
    const env = input.env ?? process.env;
    const resources = (input.definitions ?? McpResourceCatalog.DEFINITIONS).flatMap((definition) => {
      const internal_url = env[definition.internal_url_env]?.trim();
      if (!internal_url) return [];
      return [{ ...definition, url: McpResourceCatalog.buildResourceUrl(input.base_url, definition.path), internal_url }];
    });
    return new McpResourceCatalog(resources);
  }

  listResources(): readonly McpResource[] {
    return this.resources;
  }

  findResourceById(id: McpResourceId): McpResource | null {
    return this.resources.find((resource) => resource.id === id) ?? null;
  }

  /** By canonical URL, so `…/notes/` and `…/notes` name the same resource. */
  findResourceByUrl(raw_url: string): McpResource | null {
    const canonical = CanonicalUrl.parse(raw_url);
    return canonical ? (this.resources.find((resource) => resource.url === canonical) ?? null) : null;
  }

  listSupportedScopes(): string[] {
    return [...new Set(this.resources.flatMap((resource) => McpResourceCatalog.listResourceScopes(resource)))];
  }

  /** Keeps only this resource's scopes; an empty request means "whatever the user agrees to". Write implies read. */
  static resolveRequestedResourceScopes(resource: McpResourceDefinition, requested: readonly string[]): string[] {
    const known = requested.filter((scope) => McpResourceCatalog.listResourceScopes(resource).includes(scope));
    const asks_write = known.length === 0 || known.includes(resource.scopes.write);
    return asks_write ? McpResourceCatalog.listResourceScopes(resource) : [resource.scopes.read];
  }

  /** What the consent screen's choice grants, never more than the client asked for. */
  static resolveScopesForResourceAccess(resource: McpResourceDefinition, access: McpAccess, requested: readonly string[]): string[] {
    const chosen = access === 'read_write' ? McpResourceCatalog.listResourceScopes(resource) : [resource.scopes.read];
    return chosen.filter((scope) => requested.includes(scope));
  }

  static listResourceScopes(resource: McpResourceDefinition): string[] {
    return [resource.scopes.read, resource.scopes.write];
  }

  private static buildResourceUrl(base_url: URL, path: string): string {
    const base = CanonicalUrl.of(base_url);
    return CanonicalUrl.parse(`${base}${path}`) ?? `${base}${path}`;
  }
}
