/**
 * Every path in the app. Nothing outside this class spells a route out by hand, so the
 * shape of the URL space stays changeable from one place.
 */
export class AppRoutes {
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

  /**
   * Where ChatGPT, Claude and other MCP clients send the browser to ask for access. The
   * request id rides in the query, not the fragment, so it survives the login bounce.
   */
  static connect(): string {
    return '/connect';
  }

  /** Linked from the password-reset email; the token rides in the fragment. */
  static resetPassword(): string {
    return '/reset-password';
  }

  /** Linked from the address-confirmation email; the token rides in the fragment. */
  static verifyEmail(): string {
    return '/verify-email';
  }

  static privacy(): string {
    return '/privacy';
  }

  /** Where an integration's OAuth callback lands, with the outcome in the fragment. */
  static settings(): string {
    return '/settings';
  }

  /** The admin area; lands on its first view. */
  static admin(): string {
    return '/admin';
  }

  static adminUsers(): string {
    return '/admin/users';
  }

  static notes(search = ''): string {
    return `/notes${AppRoutes.withQuestionMark(search)}`;
  }

  static note(note_id: string, search = ''): string {
    return `/notes/${encodeURIComponent(note_id)}${AppRoutes.withQuestionMark(search)}`;
  }

  static newNote(search = ''): string {
    return AppRoutes.note(AppRoutes.NEW_NOTE_SEGMENT, search);
  }

  static chat(params: { conversation_id?: string | null } = {}): string {
    return params.conversation_id ? `/chat/${encodeURIComponent(params.conversation_id)}` : '/chat';
  }

  static voice(): string {
    return '/voice';
  }

  /** Maps an app-relative note link (as written into saved notes) to its page. */
  static fromNoteHref(href: string): string | null {
    const match = /^\/notes\/([^/?#]+)$/.exec(href);
    return match ? AppRoutes.note(decodeURIComponent(match[1])) : null;
  }

  private static withQuestionMark(search: string): string {
    if (!search) return '';
    return search.startsWith('?') ? search : `?${search}`;
  }
}
