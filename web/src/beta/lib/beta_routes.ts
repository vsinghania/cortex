export type AssistantMode = 'chat' | 'voice';

/**
 * Every path in the app. Nothing outside this class spells a route out by hand, so the
 * shape of the URL space stays changeable from one place.
 */
export class BetaRoutes {
  static readonly NEW_NOTE_SEGMENT = 'new';
  /**
   * A thread has no id until its first reply lands. On mobile a bare /chat means the thread
   * list, so a new thread needs a path of its own or composing would bounce back to the list.
   */
  static readonly NEW_THREAD_SEGMENT = 'new';

  /**
   * Guards the post-login redirect: `state.from` must be a path inside this app, never an
   * absolute or protocol-relative URL that would send the user off-site.
   */
  static isInternalPath(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//');
  }

  static login(): string {
    return '/login';
  }

  static register(): string {
    return '/register';
  }

  static forgotPassword(): string {
    return '/forgot-password';
  }

  /** Linked from the password-reset email; the token rides in the fragment. */
  static resetPassword(): string {
    return '/reset-password';
  }

  /** Linked from the address-confirmation email; the token rides in the fragment. */
  static verifyEmail(): string {
    return '/verify-email';
  }

  static notes(search = ''): string {
    return `/notes${BetaRoutes.withQuestionMark(search)}`;
  }

  static note(note_id: string, search = ''): string {
    return `/notes/${encodeURIComponent(note_id)}${BetaRoutes.withQuestionMark(search)}`;
  }

  static newNote(search = ''): string {
    return BetaRoutes.note(BetaRoutes.NEW_NOTE_SEGMENT, search);
  }

  static chat(params: { conversation_id?: string | null; mode?: AssistantMode } = {}): string {
    const base = params.conversation_id ? `/chat/${encodeURIComponent(params.conversation_id)}` : '/chat';
    return params.mode === 'voice' ? `${base}?mode=voice` : base;
  }

  /** Maps an app-relative note link (as written into saved notes) to its page. */
  static fromNoteHref(href: string): string | null {
    const match = /^\/notes\/([^/?#]+)$/.exec(href);
    return match ? BetaRoutes.note(decodeURIComponent(match[1])) : null;
  }

  private static withQuestionMark(search: string): string {
    if (!search) return '';
    return search.startsWith('?') ? search : `?${search}`;
  }
}
