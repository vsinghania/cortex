import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Elements that carry no readable content. Dropped outright rather than converted,
 * so nothing executable or presentational survives into a note body.
 */
/**
 * `title`, `meta` and friends matter as much as `script` here: given a whole document,
 * turndown walks the head too, and the page name lands as the body's first line.
 */
const DROPPED_ELEMENTS = [
  'head',
  'title',
  'meta',
  'link',
  'base',
  'script',
  'style',
  'noscript',
  'iframe',
  'embed',
  'form',
  'input',
  'select',
  'textarea'
];

/** Exporters style emphasis rather than marking it up, so the tags alone find nothing. */
const BOLD_WEIGHTS = /font-weight\s*:\s*(bold(er)?|[6-9]00)/i;
const ITALIC_STYLE = /font-style\s*:\s*italic/i;

/** Three or more newlines in a row; providers that use a paragraph per line produce many. */
const BLANK_RUN = /\n{3,}/g;
const TRAILING_SPACES = /[ \t]+$/gm;
/** A paragraph holding only whitespace, including the non-breaking kind. */
const BLANK_TEXT = /^[\s ]*$/;

export type HtmlToMarkdownOptions = {
  /** Replaces images with nothing. Used until there is somewhere to put the bytes. */
  drop_images?: boolean;
};

/**
 * The one place `turndown` is imported, per the anti-corruption rule that keeps a
 * third-party utility swappable — the same role `Cron` plays for cron-parser.
 */
export class HtmlToMarkdown {
  private constructor(private readonly service: TurndownService) {}

  static create(options: HtmlToMarkdownOptions = {}): HtmlToMarkdown {
    const service = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*'
    });

    service.use(gfm);
    service.remove(DROPPED_ELEMENTS as TurndownService.Filter);

    // Exporters commonly emit a paragraph per visual line plus spacer paragraphs; kept,
    // those become a blank line each and the note reads as a column of fragments.
    service.addRule('blank_paragraph', {
      filter: (node) => node.nodeName === 'P' && BLANK_TEXT.test(node.textContent ?? ''),
      replacement: () => ''
    });

    // OneNote writes <span style="font-weight:bold"> and never <strong>, so without
    // these every emphasis in an imported page is silently flattened.
    service.addRule('styled_strong', {
      filter: (node) => HtmlToMarkdown.hasStyle(node, BOLD_WEIGHTS),
      replacement: (content) => HtmlToMarkdown.wrap(content, '**')
    });

    service.addRule('styled_emphasis', {
      filter: (node) => HtmlToMarkdown.hasStyle(node, ITALIC_STYLE),
      replacement: (content) => HtmlToMarkdown.wrap(content, '*')
    });

    if (options.drop_images) {
      service.addRule('drop_image', { filter: 'img', replacement: () => '' });
    }

    return new HtmlToMarkdown(service);
  }

  convert(html: string): string {
    if (!html.trim()) return '';
    return HtmlToMarkdown.tidy(this.service.turndown(html));
  }

  /** Inline elements only: a styled block would wrap whole paragraphs in asterisks. */
  private static hasStyle(node: { nodeName: string; getAttribute(name: string): string | null }, pattern: RegExp): boolean {
    if (node.nodeName !== 'SPAN' && node.nodeName !== 'FONT') return false;
    return pattern.test(node.getAttribute('style') ?? '');
  }

  /**
   * Markers hug the text: `** bold **` is not emphasis in markdown, so any surrounding
   * space has to sit outside them. Whitespace-only content yields nothing to emphasise.
   */
  private static wrap(content: string, marker: string): string {
    const trimmed = content.trim();
    if (!trimmed) return content;

    const leading = content.startsWith(' ') || content.startsWith('\n') ? ' ' : '';
    const trailing = content.endsWith(' ') || content.endsWith('\n') ? ' ' : '';
    return `${leading}${marker}${trimmed}${marker}${trailing}`;
  }

  private static tidy(markdown: string): string {
    return markdown.replace(TRAILING_SPACES, '').replace(BLANK_RUN, '\n\n').trim();
  }
}
