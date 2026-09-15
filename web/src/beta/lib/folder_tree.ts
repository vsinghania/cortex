import type { NoteFolderNode } from '../../lib/note_folder.types';
import type { FolderTreeNode } from './note_workspace.types';

export class FolderTree {
  static build(folders: NoteFolderNode[]): FolderTreeNode[] {
    const children_by_parent = new Map<string | null, NoteFolderNode[]>();
    for (const folder of folders) {
      const siblings = children_by_parent.get(folder.parent_id) ?? [];
      siblings.push(folder);
      children_by_parent.set(folder.parent_id, siblings);
    }

    const attach = (parent_id: string | null, depth: number): FolderTreeNode[] =>
      (children_by_parent.get(parent_id) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((folder) => ({ ...folder, depth, children: attach(folder.id, depth + 1) }));

    return attach(null, 0);
  }

  /** Depth-first, so a picker can render the tree as one indented list. */
  static flatten(nodes: FolderTreeNode[]): FolderTreeNode[] {
    return nodes.flatMap((node) => [node, ...FolderTree.flatten(node.children)]);
  }

  static byId(folders: NoteFolderNode[]): Map<string, NoteFolderNode> {
    return new Map(folders.map((f) => [f.id, f]));
  }

  static descendants(folders: NoteFolderNode[], folder_id: string): NoteFolderNode[] {
    return folders.filter((f) => f.ancestor_ids.includes(folder_id));
  }

  static isInSubtree(folders_by_id: Map<string, NoteFolderNode>, folder_id: string | null | undefined, root_id: string): boolean {
    if (!folder_id) return false;
    if (folder_id === root_id) return true;
    return folders_by_id.get(folder_id)?.ancestor_ids.includes(root_id) ?? false;
  }

  /** Counts are per folder and exclude archived notes, so this is a lower bound on what a cascade deletes. */
  static subtreeNoteCount(folders: NoteFolderNode[], folder_id: string): number {
    return folders
      .filter((f) => f.id === folder_id || f.ancestor_ids.includes(folder_id))
      .reduce((sum, f) => sum + f.note_count, 0);
  }

  static pathLabel(folder: NoteFolderNode | undefined): string {
    return folder ? folder.path.join(' / ') : 'Unfiled';
  }
}
