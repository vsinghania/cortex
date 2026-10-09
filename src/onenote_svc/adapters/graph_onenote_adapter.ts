import { z } from 'zod';
import { logger } from '../../common/logger.js';
import { Delay } from '../../lib/delay.js';
import { Time } from '../../lib/time.js';
import {
  GraphForbiddenError,
  GraphRequestFailedError,
  GraphThrottledError,
  OneNoteReauthRequiredError
} from '../onenote_errors.js';
import { GraphRetryPolicy } from './graph_retry_policy.js';
import type { GraphOneNoteAdapterInterface } from './graph_onenote_adapter_interface.js';
import type {
  GraphNotebook,
  GraphPage,
  GraphPageBatch,
  GraphSection,
  ListPagesParams
} from '../types/graph.types.js';

const GRAPH_BASE_URL = process.env.GRAPH_API_BASE_URL ?? 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = Time.secondsToMs(30);
const PAGE_SIZE = 100;
const BODY_EXCERPT_CHARS = 300;

/**
 * Graph is JSON over HTTP with a bearer token, so `fetch` is the whole client. The SDK
 * was considered and dropped: its PageIterator does not serialize its position, and this
 * sync has to checkpoint mid-section and resume in a later process.
 */
const NotebookSchema = z.object({ id: z.string().min(1), displayName: z.string().default('') });

const ParentSchema = z.object({ id: z.string().min(1), displayName: z.string().default('') }).nullish();

const SectionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().default(''),
  parentNotebook: ParentSchema,
  parentSectionGroup: ParentSchema
});

const PageSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  createdDateTime: z.string().nullish(),
  lastModifiedDateTime: z.string().nullish(),
  links: z.object({ oneNoteWebUrl: z.object({ href: z.string() }).nullish() }).nullish()
});

export type GraphOneNoteAdapterDeps = {
  /** Fetches a current access token per request, so a long sync survives expiry. */
  accessToken: () => Promise<string>;
};

export class GraphOneNoteAdapter implements GraphOneNoteAdapterInterface {
  private constructor(private readonly deps: GraphOneNoteAdapterDeps) {}

  static create(deps: GraphOneNoteAdapterDeps): GraphOneNoteAdapter {
    return new GraphOneNoteAdapter(deps);
  }

  async listNotebooks(params: { signal?: AbortSignal } = {}): Promise<GraphNotebook[]> {
    const body = await this.fetchGraphJson('/me/onenote/notebooks?$select=id,displayName', params.signal);
    const parsed = GraphOneNoteAdapter.buildListResponseSchema(NotebookSchema).parse(body);
    return parsed.value.map((n) => ({ id: n.id, display_name: n.displayName }));
  }

  async listSections(params: { signal?: AbortSignal } = {}): Promise<GraphSection[]> {
    const path =
      '/me/onenote/sections?$select=id,displayName' +
      '&$expand=parentNotebook($select=id,displayName),parentSectionGroup($select=id,displayName)' +
      `&$top=${PAGE_SIZE}`;

    const sections: GraphSection[] = [];
    let next: string | undefined = path;
    while (next) {
      const body: unknown = await this.fetchGraphJson(next, params.signal);
      const parsed = GraphOneNoteAdapter.buildListResponseSchema(SectionSchema).parse(body);
      for (const s of parsed.value) {
        sections.push({
          id: s.id,
          display_name: s.displayName,
          notebook: s.parentNotebook ? { id: s.parentNotebook.id, display_name: s.parentNotebook.displayName } : null,
          section_group: s.parentSectionGroup
            ? { id: s.parentSectionGroup.id, display_name: s.parentSectionGroup.displayName }
            : null
        });
      }
      next = parsed['@odata.nextLink'] ?? undefined;
    }
    return sections;
  }

  async listPages(params: ListPagesParams): Promise<GraphPageBatch> {
    const body = await this.fetchGraphJson(params.next_link ?? GraphOneNoteAdapter.buildPagesRequestPath(params), params.signal);
    const parsed = GraphOneNoteAdapter.buildListResponseSchema(PageSchema).parse(body);

    return {
      pages: parsed.value.map((p) => GraphOneNoteAdapter.toGraphPage(p)),
      next_link: parsed['@odata.nextLink'] ?? undefined
    };
  }

  async getPageContent(params: { page_id: string; signal?: AbortSignal }): Promise<string> {
    const path = `/me/onenote/pages/${encodeURIComponent(params.page_id)}/content?includeIDs=true`;
    const resp = await this.fetchGraphResponse(path, params.signal);
    return resp.text();
  }

  private static buildPagesRequestPath(params: ListPagesParams): string {
    const query = [
      '$select=id,title,createdDateTime,lastModifiedDateTime,links',
      '$orderby=lastModifiedDateTime asc',
      `$top=${PAGE_SIZE}`
    ];
    if (params.modified_after) {
      query.push(`$filter=lastModifiedDateTime gt ${params.modified_after.toISOString()}`);
    }
    return `/me/onenote/sections/${encodeURIComponent(params.section_id)}/pages?${query.join('&')}`;
  }

  private static toGraphPage(raw: z.infer<typeof PageSchema>): GraphPage {
    return {
      id: raw.id,
      title: raw.title?.trim() || '(untitled)',
      created_at: Time.parseOptionalDate(raw.createdDateTime),
      modified_at: Time.parseOptionalDate(raw.lastModifiedDateTime),
      web_url: raw.links?.oneNoteWebUrl?.href ?? undefined
    };
  }

  private static buildListResponseSchema<T extends z.ZodType>(item: T) {
    return z.object({ value: z.array(item).default([]), '@odata.nextLink': z.string().nullish() });
  }

  private async fetchGraphJson(path_or_url: string, signal?: AbortSignal): Promise<unknown> {
    const resp = await this.fetchGraphResponse(path_or_url, signal);
    return resp.json();
  }

  /**
   * Retries throttles in place while that is cheap, then hands the wait back to the job
   * queue rather than holding a worker slot through a long Retry-After.
   */
  private async fetchGraphResponse(path_or_url: string, signal?: AbortSignal): Promise<Response> {
    const url = path_or_url.startsWith('http') ? path_or_url : `${GRAPH_BASE_URL}${path_or_url}`;
    let attempt = 0;
    let waited_ms = 0;

    for (;;) {
      attempt += 1;
      const resp = await this.fetchGraphResponseOnce(url, signal);
      if (resp.ok) return resp;

      const decision = GraphRetryPolicy.decideRequestRetry({
        status: resp.status,
        retry_after_header: resp.headers.get('retry-after'),
        attempt,
        waited_ms
      });

      // Read the body before deciding what to throw; it is the only diagnostic Graph gives.
      const excerpt = await GraphOneNoteAdapter.readErrorBodyExcerpt(resp);

      if (decision.outcome === 'permanent') {
        const graph = GraphOneNoteAdapter.parseGraphError(excerpt);
        // 401 is the grant; 403 is this resource. Conflating them turns a locked section
        // into a bogus "reconnect your account".
        if (resp.status === 401) {
          throw new OneNoteReauthRequiredError(`Microsoft rejected the token${graph.code ? ` (${graph.code})` : ''}`);
        }
        if (resp.status === 403) {
          throw new GraphForbiddenError(graph.message ?? 'Microsoft refused access to this item', graph.code);
        }
        throw new GraphRequestFailedError(
          `Graph request failed (${resp.status}${graph.code ? ` ${graph.code}` : ''})`,
          resp.status,
          graph.code
        );
      }
      if (decision.outcome === 'give_up') {
        throw new GraphThrottledError(`Graph is throttling (${resp.status})`, resp.status);
      }

      logger.warn({ status: resp.status, attempt, delay_ms: decision.delay_ms, body_excerpt: excerpt }, 'graph request retrying');
      await Delay.forMs(decision.delay_ms, signal);
      waited_ms += decision.delay_ms;
    }
  }

  private static async readErrorBodyExcerpt(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, BODY_EXCERPT_CHARS);
    } catch {
      return '';
    }
  }

  /** Graph puts a machine-readable code beside its message; keep it for diagnosis. */
  private static parseGraphError(body: string): { code?: string; message?: string } {
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
      return { code: parsed.error?.code, message: parsed.error?.message };
    } catch {
      return {};
    }
  }

  private async fetchGraphResponseOnce(url: string, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await fetch(url, {
        headers: { authorization: `Bearer ${await this.deps.accessToken()}` },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
