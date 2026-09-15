import type { Connection } from 'mongoose';
import type { Note } from '../types/note.types.js';
import type {
  NoteRepository,
  NoteListParams,
  NoteListResult,
  NoteListFilter,
  NoteTagCount,
  NoteByIdKey,
  NoteBySourceKey,
  NoteMaintenanceParams,
  NoteSearchParams,
  NoteArchivedFilter,
  NotePatchFields
} from './note_repository_interface.js';
import { NoteListSort, type ResolvedNoteSort } from '../note_list_sort.js';
import { NotePatchKind } from '../note_patch_kind.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { NoteModelFactory, NoteTrashModelFactory } from '../models/index.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import { Regex } from '../../lib/regex.js';
import { logExecTime } from '../../lib/decorators/logging_decorators.js';
import { logger } from '../../common/logger.js';


export class MongooseNoteRepository implements NoteRepository {
  private static readonly factory = new NoteModelFactory();
  private static readonly trash_factory = new NoteTrashModelFactory();
  private static readonly MAX_TAG_FACET_ROWS = 200;

  private constructor(
    private readonly conn: Connection,
    private readonly model: any,
    private readonly trash_model: any
  ) {}

  // Async factory to create a repository bound to a specific db (and optional host/port)
  static async create(params: { db: string; host?: string; port?: number }) {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    const trash_model = this.trash_factory.getModel(conn);
    return new MongooseNoteRepository(conn, model, trash_model);
  }

  async createNote(note: Note): Promise<Note> {
    const created = await this.model.create(note);
    return MongooseUtils.toDomain<Note>(created);
  }

  async getNoteById(params: NoteByIdKey): Promise<Note | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      id: params.id
    }).lean();
    return found ? (MongooseUtils.toDomain<Note>(found) as Note) : null;
  }

  async getNoteByKey(params: NoteBySourceKey): Promise<Note | null> {
    const found = await this.model.findOne({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    }).lean();
    return found ? (MongooseUtils.toDomain<Note>(found) as Note) : null;
  }

  async getNotesByIds(params: { user_id: string; ids: string[] }): Promise<Note[]> {
    if (params.ids.length === 0) return [];
    const docs = await this.model
      .find({ user_id: params.user_id, id: { $in: params.ids } })
      .lean();
    return docs.map((d: any) => MongooseUtils.toDomain<Note>(d));
  }

  async listNotes(params: NoteListParams): Promise<NoteListResult> {
    const { limit, offset } = MongooseNoteRepository.normalizePagination(params);

    const use_text = !!params.query && !!params.query.trim();
    const filter = MongooseNoteRepository.buildListFilter({ ...params, use_text });
    const resolved_sort = NoteListSort.resolve({ sort: params.sort, has_query: use_text });

    let cursor = this.model.find(filter);
    if (resolved_sort.by_relevance) {
      cursor = cursor.select({ score: { $meta: 'textScore' } });
    }
    cursor = cursor.sort(resolved_sort.sort);

    // Only the non-text path can ask for a collation: text indexes support simple binary
    // comparison only, so $text with a non-simple collation cannot use one. The text path
    // gets tag case-insensitivity from anchored regexes instead, and a title sort there
    // falls back to binary order.
    const collation = use_text ? undefined : MongooseNoteRepository.collationFor(params.filter, resolved_sort);
    if (collation) cursor = cursor.collation(collation);

    const [items, total] = await Promise.all([
      MongooseNoteRepository.isCountOnly(limit) ? [] : cursor.skip(offset).limit(limit).lean(),
      // Must carry the same collation as the find, or total disagrees with items.
      collation ? this.model.countDocuments(filter, { collation }) : this.model.countDocuments(filter)
    ]);

    return {
      items: items.map((i: any) => MongooseUtils.toDomain<Note>(i)),
      total
    };
  }

  @logExecTime({ threshold_in_ms: 200 })
  async listTags(params: { user_id: string; limit?: number }): Promise<NoteTagCount[]> {
    const limit = MongooseNoteRepository.normalizeTagFacetLimit(params.limit);

    const rows = await this.model
      .aggregate([
        { $match: { user_id: params.user_id } },
        { $project: { _id: 0, tags: 1 } },
        { $unwind: '$tags' },
        // Fold casing variants together, then keep the most-used spelling as the label so
        // facet chips read the same as the chips rendered on the notes themselves.
        { $group: { _id: { folded: { $toLower: '$tags' }, label: '$tags' }, count: { $sum: 1 } } },
        { $sort: { count: -1, '_id.label': 1 } },
        { $group: { _id: '$_id.folded', tag: { $first: '$_id.label' }, count: { $sum: '$count' } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
        { $project: { _id: 0, tag: 1, count: 1 } }
      ])
      .collation(NoteModelFactory.CASE_INSENSITIVE_COLLATION);

    return rows as NoteTagCount[];
  }

  async updateNoteById(params: NoteByIdKey & { patch: NotePatchFields }): Promise<Note | null> {
    return this.findOneAndPatch({ user_id: params.user_id, id: params.id }, params.patch);
  }

  async updateNoteByKey(params: NoteBySourceKey & { patch: NotePatchFields }): Promise<Note | null> {
    return this.findOneAndPatch(
      {
        user_id: params.user_id,
        source: params.source,
        external_id: params.external_id
      },
      params.patch
    );
  }

  private async findOneAndPatch(filter: Record<string, unknown>, patch: NotePatchFields): Promise<Note | null> {
    const update = MongooseNoteRepository.buildPatchUpdate(patch);
    const updated = await this.model.findOneAndUpdate(filter, update, {
      new: true,
      timestamps: !NotePatchKind.isOrganizationalOnly(patch)
    }).lean();
    return updated ? (MongooseUtils.toDomain<Note>(updated) as Note) : null;
  }

  async deleteNoteById(params: NoteByIdKey): Promise<boolean> {
    return this.snapshotThenDelete({ user_id: params.user_id, id: params.id });
  }

  async deleteNoteByKey(params: NoteBySourceKey): Promise<boolean> {
    return this.snapshotThenDelete({
      user_id: params.user_id,
      source: params.source,
      external_id: params.external_id
    });
  }

  async searchNotes(params: NoteSearchParams): Promise<NoteListResult> {
    const { limit, offset } = MongooseNoteRepository.normalizePagination(params);

    const filter: Record<string, unknown> = {
      user_id: params.user_id,
      $text: { $search: params.query.trim() },
      ...MongooseNoteRepository.archivedClause(params.archived)
    };

    const [items, total] = await Promise.all([
      MongooseNoteRepository.isCountOnly(limit)
        ? []
        : this.model.find(filter)
          .select({ score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' }, updated_at: -1 })
          .skip(offset)
          .limit(limit)
          .lean(),
      this.model.countDocuments(filter)
    ]);

    return {
      items: items.map((i: any) => MongooseUtils.toDomain<Note>(i)),
      total
    };
  }

  async listNotesForMaintenance(params: NoteMaintenanceParams): Promise<Note[]> {
    const docs = await this.model
      .find(MongooseNoteRepository.buildMaintenanceFilter(params))
      .sort({ id: 1 })
      .limit(Math.max(1, params.limit))
      .lean();
    return docs.map((d: any) => MongooseUtils.toDomain<Note>(d));
  }

  async countNotesForMaintenance(
    params: Omit<NoteMaintenanceParams, 'after_id' | 'limit'>
  ): Promise<number> {
    return this.model.countDocuments(MongooseNoteRepository.buildMaintenanceFilter(params));
  }

  /**
   * Unscoped by design - a maintenance sweep may target every note. An empty
   * user_ids/note_ids means "everything", which is the actual backfill case.
   */
  private static buildMaintenanceFilter(params: {
    user_ids?: string[];
    note_ids?: string[];
    after_id?: string;
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (params.user_ids?.length) filter.user_id = { $in: params.user_ids };
    if (params.note_ids?.length) filter.id = { $in: params.note_ids };
    if (params.after_id) {
      filter.id = params.note_ids?.length
        ? { $in: params.note_ids, $gt: params.after_id }
        : { $gt: params.after_id };
    }

    return filter;
  }

  private async snapshotThenDelete(filter: Record<string, unknown>): Promise<boolean> {
    const snapshot = await this.model.findOne(filter).lean();
    if (!snapshot) return false;

    const trash_doc = { ...snapshot, deleted_at: new Date() };
    Reflect.deleteProperty(trash_doc as any, '_id');
    Reflect.deleteProperty(trash_doc as any, '__v');
    await this.trash_model.create(trash_doc);

    try {
      await this.model.deleteOne(filter);
    } catch (err) {
      logger.warn(
        { err, note_id: (snapshot as any).id },
        'note delete failed after trash snapshot was written; trash entry will TTL out'
      );
      throw err;
    }

    return true;
  }

  private static buildListFilter(params: NoteListParams & { use_text: boolean }): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      user_id: params.user_id,
      ...MongooseNoteRepository.archivedClause(params.filter?.archived)
    };

    if (params.filter?.pinned !== undefined) {
      filter.is_pinned = params.filter.pinned ? true : { $ne: true };
    }

    if (params.use_text) {
      filter.$text = { $search: params.query!.trim() };
    }

    const tags = MongooseNoteRepository.normalizeTags(params.filter?.tags);
    if (tags.length > 0) {
      filter.tags = {
        $all: params.use_text ? tags.map((t) => Regex.exactCaseInsensitive(t)) : tags
      };
    }

    return filter;
  }

  /** `$ne: true` rather than `false` so notes written before the flag existed still match. */
  private static archivedClause(archived: NoteArchivedFilter | undefined): Record<string, unknown> {
    switch (archived ?? 'exclude') {
      case 'only':
        return { is_archived: true };
      case 'include':
        return {};
      default:
        return { is_archived: { $ne: true } };
    }
  }

  /**
   * Tag filters and title sorts share one case-insensitive collation; it is only requested
   * when one of them is in play, since a collated query can only use a collated index.
   */
  private static collationFor(filter: NoteListFilter | undefined, sort: ResolvedNoteSort) {
    const filters_tags = MongooseNoteRepository.normalizeTags(filter?.tags).length > 0;
    return filters_tags || sort.needs_case_insensitive_collation
      ? NoteModelFactory.CASE_INSENSITIVE_COLLATION
      : undefined;
  }

  private static normalizeTags(tags: string[] | undefined): string[] {
    return (tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  }

  private static normalizeTagFacetLimit(limit: number | undefined): number {
    const max_rows = MongooseNoteRepository.MAX_TAG_FACET_ROWS;
    return Math.max(1, Math.min(max_rows, limit ?? max_rows));
  }

  private static normalizePagination(params: { limit?: number; offset?: number }): { limit: number; offset: number } {
    const limit_raw = params.limit ?? 20;
    const offset_raw = params.offset ?? 0;
    return {
      limit: Math.max(0, Math.min(100, limit_raw)),
      offset: Math.max(0, offset_raw)
    };
  }

  /** A zero limit means "total only"; it must skip the find, since Mongo reads `.limit(0)` as unlimited. */
  private static isCountOnly(limit: number): boolean {
    return limit === 0;
  }

  private static buildPatchUpdate(patch: NotePatchFields): Record<string, unknown> {
    return { $set: MongooseNoteRepository.buildAllowedPatch(patch) };
  }

  private static buildAllowedPatch(patch: Partial<Note> | undefined): Partial<Note> {
    const p = patch ?? {};
    const allowed: Partial<Note> = {};

    if (p.title !== undefined) allowed.title = p.title;
    if (p.body !== undefined) allowed.body = p.body;
    if (p.body_raw !== undefined) allowed.body_raw = p.body_raw;
    if (p.tags !== undefined) allowed.tags = p.tags;
    if (p.container !== undefined) allowed.container = p.container;

    if (p.provider_created_at !== undefined) allowed.provider_created_at = p.provider_created_at;
    if (p.provider_updated_at !== undefined) allowed.provider_updated_at = p.provider_updated_at;
    if (p.last_synced_at !== undefined) allowed.last_synced_at = p.last_synced_at;

    if (p.sync_status !== undefined) allowed.sync_status = p.sync_status;
    if (p.is_archived !== undefined) allowed.is_archived = p.is_archived;
    if (p.is_pinned !== undefined) allowed.is_pinned = p.is_pinned;
    if (p.is_deleted !== undefined) allowed.is_deleted = p.is_deleted;

    if (p.metadata !== undefined) allowed.metadata = p.metadata;
    if (p.vectorization !== undefined) allowed.vectorization = p.vectorization;

    return allowed;
  }
}
