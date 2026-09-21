import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { NoteFolderNode } from '../../lib/note_folder.types';
import type { NoteTagCount } from '../../lib/note.types';
import { Icon } from '../icon';
import { OneNoteLogo } from '../onenote_logo';
import type { IconName } from '../icon';
import type { FolderTreeNode, NoteFilters } from '../../lib/note_workspace.types';
import { FolderTree } from '../../lib/folder_tree';
import { NoteFilterParams } from '../../lib/note_filter_params';
import { PopoverMenu } from '../popover_menu';
import { FolderNameInput } from './folder_name_input';

type Props = {
  collapsed: boolean;
  folders: NoteFolderNode[];
  tags: NoteTagCount[];
  filters: NoteFilters;
  onSelect: (patch: Partial<NoteFilters>) => void;
  onCreateFolder: (name: string, parent_id: string | null) => Promise<boolean>;
  onRenameFolder: (folder_id: string, name: string) => Promise<boolean>;
  onDeleteFolder: (folder: NoteFolderNode) => void;
};

/** `undefined` means no create input is open; `null` means one is open at the top level. */
type CreateTarget = string | null | undefined;

/**
 * A folder a sync owns looks different from one the user made, because it behaves
 * differently: the next pass rebuilds it from the provider, so a rename or a move here
 * is undone. The icon is the cheapest place to say so before someone reorganises.
 */
/** The single folder a provider hangs its tree under; it mirrors no container of its own. */
function isProviderRoot(node: NoteFolderNode): boolean {
  return node.source === 'onenote' && !node.container_type;
}

function folderIcon(node: NoteFolderNode): IconName {
  if (node.container_type === 'notebook') return 'notebook';
  if (node.container_type === 'section_group') return 'layers';
  if (node.container_type === 'section') return 'notes';
  return node.source ? 'refresh' : 'folder';
}

function folderHint(node: NoteFolderNode): string | undefined {
  if (!node.source) return undefined;
  const kind = node.container_type?.replace('_', ' ') ?? 'folder';
  return `${node.name} — a ${kind} synced from ${node.source}. Renaming or moving it here is undone by the next sync.`;
}

export function NotesRailSections(props: Props) {
  const { collapsed, folders, tags, filters, onSelect } = props;
  const tree = useMemo(() => FolderTree.build(folders), [folders]);
  const [collapsed_ids, set_collapsed_ids] = useState<Set<string>>(() => new Set());
  const [create_target, set_create_target] = useState<CreateTarget>(undefined);
  const [renaming_id, set_renaming_id] = useState<string | null>(null);

  const no_tag = !filters.tag;
  const views: { key: string; label: string; icon: IconName; active: boolean; patch: Partial<NoteFilters> }[] = [
    {
      key: 'all',
      label: 'All notes',
      icon: 'layers',
      active: no_tag && !filters.folder && !filters.archived,
      patch: { folder: null, archived: false, tag: null },
    },
    {
      key: 'unfiled',
      label: 'Unfiled',
      icon: 'inbox',
      active: no_tag && filters.folder === NoteFilterParams.UNFILED,
      patch: { folder: NoteFilterParams.UNFILED, archived: false, tag: null },
    },
  ];
  const archive_view = { active: no_tag && filters.archived, patch: { folder: null, archived: true, tag: null } };

  function toggleExpanded(folder_id: string) {
    set_collapsed_ids((current) => {
      const next = new Set(current);
      if (next.has(folder_id)) next.delete(folder_id);
      else next.add(folder_id);
      return next;
    });
  }

  function startCreate(parent_id: string | null) {
    set_renaming_id(null);
    set_create_target(parent_id);
    if (parent_id) {
      set_collapsed_ids((current) => {
        const next = new Set(current);
        next.delete(parent_id);
        return next;
      });
    }
  }

  async function commitCreate(name: string, parent_id: string | null) {
    const ok = await props.onCreateFolder(name, parent_id);
    if (ok) set_create_target(undefined);
    return ok;
  }

  async function commitRename(folder_id: string, name: string) {
    const ok = await props.onRenameFolder(folder_id, name);
    if (ok) set_renaming_id(null);
    return ok;
  }

  function renderFolder(node: FolderTreeNode) {
    const is_expanded = !collapsed_ids.has(node.id);
    const is_active = no_tag && filters.folder === node.id;
    const has_children = node.children.length > 0;

    return (
      <div key={node.id} role="treeitem" aria-expanded={has_children ? is_expanded : undefined} aria-selected={is_active}>
        {renaming_id === node.id ? (
          <FolderNameInput
            initial={node.name}
            depth={node.depth}
            placeholder="Folder name"
            onCommit={(name) => commitRename(node.id, name)}
            onCancel={() => set_renaming_id(null)}
          />
        ) : (
          <div className={`tree-row${is_active ? ' tree-row-active' : ''}`} style={{ '--depth': node.depth } as CSSProperties}>
            {has_children ? (
              <button
                type="button"
                className="tree-chevron"
                onClick={() => toggleExpanded(node.id)}
                aria-label={is_expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              >
                <Icon name={is_expanded ? 'chevron_down' : 'chevron_right'} size={14} />
              </button>
            ) : (
              <span className="tree-chevron-spacer" aria-hidden="true" />
            )}
            <button
              type="button"
              className="tree-select"
              title={folderHint(node)}
              onClick={() => onSelect({ folder: node.id, archived: false, tag: null })}
            >
              {/* The provider's own mark on the root it owns; its children stay monochrome
                  so one coloured logo reads as a heading, not as noise down the tree. */}
              {isProviderRoot(node) ? (
                <OneNoteLogo size={14} className="rail-item-icon" />
              ) : (
                <Icon
                  name={folderIcon(node)}
                  size={14}
                  className={`rail-item-icon${node.source ? ' rail-item-icon-synced' : ''}`}
                />
              )}
              <span className="rail-item-label">{node.name}</span>
              {node.note_count > 0 && <span className="rail-count">{node.note_count}</span>}
            </button>
            <PopoverMenu label={`Actions for ${node.name}`} trigger={<Icon name="more" size={14} />} trigger_class="icon-btn tree-menu" align="end">
              {(close) => (
                <>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); startCreate(node.id); }}>
                    <Icon name="folder_plus" size={14} />
                    New subfolder
                  </button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); set_create_target(undefined); set_renaming_id(node.id); }}>
                    <Icon name="edit" size={14} />
                    Rename
                  </button>
                  <div className="menu-divider" />
                  <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => { close(); props.onDeleteFolder(node); }}>
                    <Icon name="trash" size={14} />
                    Delete folder…
                  </button>
                </>
              )}
            </PopoverMenu>
          </div>
        )}
        {create_target === node.id && (
          <FolderNameInput
            depth={node.depth + 1}
            placeholder="New subfolder"
            onCommit={(name) => commitCreate(name, node.id)}
            onCancel={() => set_create_target(undefined)}
          />
        )}
        {has_children && is_expanded && <div role="group">{node.children.map(renderFolder)}</div>}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="rail-section">
        {views.map((view) => (
          <button key={view.key} type="button" title={view.label} className={`rail-item${view.active ? ' rail-item-active' : ''}`} onClick={() => onSelect(view.patch)}>
            <Icon name={view.icon} size={15} className="rail-item-icon" />
            <span className="sr-only">{view.label}</span>
          </button>
        ))}
        <button type="button" title="Archive" className={`rail-item${archive_view.active ? ' rail-item-active' : ''}`} onClick={() => onSelect(archive_view.patch)}>
          <Icon name="archive" size={15} className="rail-item-icon" />
          <span className="sr-only">Archive</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="rail-section">
        <div className="rail-heading">Workspaces</div>
        {views.map((view) => (
          <button key={view.key} type="button" className={`rail-item${view.active ? ' rail-item-active' : ''}`} onClick={() => onSelect(view.patch)}>
            <Icon name={view.icon} size={15} className="rail-item-icon" />
            <span className="rail-item-label">{view.label}</span>
          </button>
        ))}
        <button type="button" className={`rail-item${archive_view.active ? ' rail-item-active' : ''}`} onClick={() => onSelect(archive_view.patch)}>
          <Icon name="archive" size={15} className="rail-item-icon" />
          <span className="rail-item-label">Archive</span>
        </button>
      </div>

      {/* Folders get their own section: listed under the views they read as children of Unfiled. */}
      <div className="rail-section">
        <div className="rail-heading rail-heading-with-action">
          <span>Folders</span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => startCreate(null)} aria-label="New folder" title="New folder">
            <Icon name="plus" size={13} />
          </button>
        </div>
        {create_target === null && (
          <FolderNameInput depth={0} placeholder="New folder" onCommit={(name) => commitCreate(name, null)} onCancel={() => set_create_target(undefined)} />
        )}
        {tree.length > 0 ? (
          <div role="tree" aria-label="Folders">{tree.map(renderFolder)}</div>
        ) : (
          create_target !== null && (
            <button type="button" className="rail-item rail-item-hint" onClick={() => startCreate(null)}>
              <Icon name="folder_plus" size={15} className="rail-item-icon" />
              <span className="rail-item-label">New folder</span>
            </button>
          )
        )}
      </div>

      {tags.length > 0 && (
        <div className="rail-section">
          <div className="rail-heading">Tags</div>
          {tags.map(({ tag, count }) => {
            const is_active = filters.tag === tag;
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={is_active}
                className={`rail-item${is_active ? ' rail-item-active' : ''}`}
                onClick={() => onSelect({ tag: is_active ? null : tag })}
              >
                <Icon name="hash" size={14} className="rail-item-icon" />
                <span className="rail-item-label">{tag}</span>
                <span className="rail-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
