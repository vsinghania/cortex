export type AssistantMode = 'chat' | 'voice';

/**
 * Every path inside the beta UI. Beta lives under /beta while the classic UI still owns
 * the root, so nothing in beta/ spells a path out by hand - moving beta to the root is a
 * one-line change here.
 */
export class BetaRoutes {
  static readonly PREFIX = '/beta';
  static readonly NEW_NOTE_SEGMENT = 'new';

  static isBetaPath(pathname: string): boolean {
    return pathname === BetaRoutes.PREFIX || pathname.startsWith(`${BetaRoutes.PREFIX}/`);
  }

  /** The classic page a beta path corresponds to, for the "Classic UI" escape hatch. */
  static toClassicPath(pathname: string): string {
    if (!BetaRoutes.isBetaPath(pathname)) return pathname;
    const classic = pathname.slice(BetaRoutes.PREFIX.length) || '/';
    // Drafts are beta-only; classic has no page for an unsaved note.
    return classic === `/notes/${BetaRoutes.NEW_NOTE_SEGMENT}` ? '/notes' : classic;
  }

  /** The beta page for a classic path; classic and beta share the same paths below the prefix. */
  static fromClassicPath(pathname: string): string {
    return `${BetaRoutes.PREFIX}${pathname === '/' ? '/notes' : pathname}`;
  }

  static login(): string {
    return `${BetaRoutes.PREFIX}/login`;
  }

  static register(): string {
    return `${BetaRoutes.PREFIX}/register`;
  }

  static forgotPassword(): string {
    return `${BetaRoutes.PREFIX}/forgot-password`;
  }

  static notes(search = ''): string {
    return `${BetaRoutes.PREFIX}/notes${BetaRoutes.withQuestionMark(search)}`;
  }

  static note(note_id: string, search = ''): string {
    return `${BetaRoutes.PREFIX}/notes/${encodeURIComponent(note_id)}${BetaRoutes.withQuestionMark(search)}`;
  }

  static newNote(search = ''): string {
    return BetaRoutes.note(BetaRoutes.NEW_NOTE_SEGMENT, search);
  }

  static chat(params: { conversation_id?: string | null; mode?: AssistantMode } = {}): string {
    const base = params.conversation_id
      ? `${BetaRoutes.PREFIX}/chat/${encodeURIComponent(params.conversation_id)}`
      : `${BetaRoutes.PREFIX}/chat`;
    return params.mode === 'voice' ? `${base}?mode=voice` : base;
  }

  /** Maps an app-relative note link (as written into saved notes) to its beta page. */
  static fromNoteHref(href: string): string | null {
    const match = /^\/notes\/([^/?#]+)$/.exec(href);
    return match ? BetaRoutes.note(decodeURIComponent(match[1])) : null;
  }

  private static withQuestionMark(search: string): string {
    if (!search) return '';
    return search.startsWith('?') ? search : `?${search}`;
  }
}
