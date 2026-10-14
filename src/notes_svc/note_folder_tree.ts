import type { NoteFolder, NoteFolderNode } from './types/note_folder.types.js';
import type { NoteFolderPlacement } from './repositories/note_folder_repository_interface.js';
import type { NoteFolderCount } from './repositories/note_repository_interface.js';
import { BadRequestError } from '../common/errors.js';

export class NoteFolderTree {
  static readonly MAX_DEPTH = 8;
  static readonly MAX_NAME_CHARS = 100;
  static readonly MAX_DESCRIPTION_CHARS = 1000;
  static readonly PATH_SEPARATOR = '/';

  private constructor() {}

  static normalizeDescription(raw: string): string {
    const description = raw.trim();
    if (description.length > NoteFolderTree.MAX_DESCRIPTION_CHARS) {
      throw new BadRequestError(`Folder description must be at most ${NoteFolderTree.MAX_DESCRIPTION_CHARS} characters`);
    }
    return description;
  }

  /** Trims and collapses whitespace; `/` is reserved as the path separator. */
  static normalizeName(raw: string): string {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestError('Folder name must not be empty');
    if (name.includes(NoteFolderTree.PATH_SEPARATOR)) {
      throw new BadRequestError(`Folder name must not contain "${NoteFolderTree.PATH_SEPARATOR}"`);
    }
    if (name.length > NoteFolderTree.MAX_NAME_CHARS) {
      throw new BadRequestError(`Folder name must be at most ${NoteFolderTree.MAX_NAME_CHARS} characters`);
    }
    return name;
  }

  /** `"Work / Clients/"` -> `['Work', 'Clients']`; empty segments are ignored. */
  static parsePath(raw: string): string[] {
    const segments = raw
      .split(NoteFolderTree.PATH_SEPARATOR)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => NoteFolderTree.normalizeName(s));
    if (segments.length === 0) throw new BadRequestError('Folder path must name at least one folder');
    if (segments.length > NoteFolderTree.MAX_DEPTH) {
      throw new BadRequestError(`Folders can be nested at most ${NoteFolderTree.MAX_DEPTH} levels deep`);
    }
    return segments;
  }

  static placementUnder(parent: NoteFolder | null): NoteFolderPlacement {
    return parent
      ? { parent_id: parent.id, ancestor_ids: [...parent.ancestor_ids, parent.id] }
      : { parent_id: null, ancestor_ids: [] };
  }

  static assertCanCreateUnder(parent: NoteFolder | null): void {
    const depth = NoteFolderTree.placementUnder(parent).ancestor_ids.length + 1;
    if (depth > NoteFolderTree.MAX_DEPTH) {
      throw new BadRequestError(`Folders can be nested at most ${NoteFolderTree.MAX_DEPTH} levels deep`);
    }
  }

  /** Rejects moving a folder into itself or its own subtree, or past the depth limit. */
  static assertCanMove(params: { folder: NoteFolder; new_parent: NoteFolder | null; descendants: NoteFolder[] }): void {
    const { folder, new_parent, descendants } = params;
    if (new_parent && (new_parent.id === folder.id || new_parent.ancestor_ids.includes(folder.id))) {
      throw new BadRequestError('A folder cannot be moved into itself or one of its subfolders');
    }
    const placement = NoteFolderTree.placementUnder(new_parent);
    const deepest = placement.ancestor_ids.length + NoteFolderTree.subtreeHeight(folder, descendants);
    if (deepest > NoteFolderTree.MAX_DEPTH) {
      throw new BadRequestError(`Folders can be nested at most ${NoteFolderTree.MAX_DEPTH} levels deep`);
    }
  }

  /** Levels in the subtree rooted at `folder`, counting the folder itself. */
  static subtreeHeight(folder: NoteFolder, descendants: NoteFolder[]): number {
    const base = folder.ancestor_ids.length;
    return descendants.reduce((height, d) => Math.max(height, d.ancestor_ids.length - base + 1), 1);
  }

  /** Attaches name paths and note counts, ordered so each parent precedes its children. */
  static buildNodes(folders: NoteFolder[], counts: NoteFolderCount[]): NoteFolderNode[] {
    const name_by_id = new Map(folders.map((f) => [f.id, f.name]));
    const count_by_id = new Map(counts.map((c) => [c.folder_id, c.count]));
    const nodes = folders.map((f) => ({
      ...f,
      path: [...f.ancestor_ids.map((id) => name_by_id.get(id) ?? ''), f.name],
      note_count: count_by_id.get(f.id) ?? 0
    }));
    return nodes.sort((a, b) => NoteFolderTree.comparePaths(a.path, b.path));
  }

  private static comparePaths(a: string[], b: string[]): number {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      const cmp = a[i].localeCompare(b[i], undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  }
}
