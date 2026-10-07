/**
 * The OAuth scopes the notes MCP resource understands. The resource owns its
 * vocabulary; the authorization server (oauth_svc) grants from it and the notes MCP
 * module decides which tools each grant can see.
 */
export type NotesAccess = 'read' | 'read_write';

export class NotesScope {
  static readonly READ = 'notes:read';
  static readonly WRITE = 'notes:write';
  static readonly ALL: readonly string[] = [NotesScope.READ, NotesScope.WRITE];

  private constructor() {}

  /** Keeps only scopes we know; an empty request means "whatever the user agrees to". */
  static normalize(requested: readonly string[]): string[] {
    const known = requested.filter((scope) => NotesScope.ALL.includes(scope));
    const effective = known.length > 0 ? known : [...NotesScope.ALL];
    return NotesScope.withImpliedRead(effective);
  }

  /** What the consent screen's choice grants, never more than the client asked for. */
  static forAccess(access: NotesAccess, requested: readonly string[]): string[] {
    const chosen = access === 'read_write' ? [...NotesScope.ALL] : [NotesScope.READ];
    return chosen.filter((scope) => requested.includes(scope));
  }

  /** Writing a note you cannot find is not useful, so write always brings read. */
  private static withImpliedRead(scopes: string[]): string[] {
    const set = new Set(scopes);
    if (set.has(NotesScope.WRITE)) set.add(NotesScope.READ);
    return NotesScope.ALL.filter((scope) => set.has(scope));
  }
}
