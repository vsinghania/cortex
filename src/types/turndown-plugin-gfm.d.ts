/**
 * `turndown-plugin-gfm` ships no types and has no @types package. Only the pieces we
 * use are declared; it is imported in exactly one file, `src/lib/text/html_to_markdown.ts`.
 */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  /** Tables, strikethrough, task lists and fenced code in one plugin. */
  export function gfm(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}
