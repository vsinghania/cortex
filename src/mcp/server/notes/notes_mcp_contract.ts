/**
 * What the notes MCP server promises the outside world: the OAuth scopes it
 * understands, and the audience a caller assertion must name to be accepted here.
 * The server owns this contract; the public resource catalog and the authorization
 * server read it, so the three can never disagree.
 */
export class NotesMcpContract {
  static readonly READ = 'notes:read';
  static readonly WRITE = 'notes:write';
  static readonly ALL: readonly string[] = [NotesMcpContract.READ, NotesMcpContract.WRITE];

  /** Distinct per MCP server, so an assertion minted for one is refused by another. */
  static readonly ASSERTION_AUDIENCE = 'cortex-notes-mcp';

  private constructor() {}
}
