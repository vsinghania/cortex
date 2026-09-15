export type NoteBulkAction =
  | { action: 'move'; folder_id: string | null }
  | { action: 'archive' }
  | { action: 'unarchive' }
  | { action: 'pin' }
  | { action: 'unpin' }
  | { action: 'add_tags'; tags: string[] }
  | { action: 'remove_tags'; tags: string[] }
  | { action: 'delete' };

export type NoteBulkActionName = NoteBulkAction['action'];

export type NoteBulkResult = {
  action: NoteBulkActionName;
  matched: number;
  modified: number;
};
