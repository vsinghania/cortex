import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BetaRoutes } from '../lib/beta_routes';

/**
 * Headings carry their source line so the outline can scroll to them, and app-relative
 * note links (as written by "Save as note") stay inside the beta UI.
 */
const COMPONENTS: Components = {
  h1: ({ node, children }) => <h1 data-line={node?.position?.start.line}>{children}</h1>,
  h2: ({ node, children }) => <h2 data-line={node?.position?.start.line}>{children}</h2>,
  h3: ({ node, children }) => <h3 data-line={node?.position?.start.line}>{children}</h3>,
  a: ({ href, children }) => {
    const beta_href = href ? BetaRoutes.fromNoteHref(href) : null;
    if (beta_href) return <Link to={beta_href}>{children}</Link>;
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

export function MarkdownPreview({ source, className = '' }: { source: string; className?: string }) {
  return (
    <div className={`markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
