import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '../lib/agent.types';
import { CitationText } from '../lib/citation_text';
import type { ReturnLinkState } from '../lib/navigation.types';

type Props = {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
};

/** Only corpora with a UI route are linkable; anything else renders as a dead reference. */
const CORPUS_ROUTES: Record<string, string> = {
  notes: '/notes',
};

function citationHref(citation: Citation): string | null {
  const route = CORPUS_ROUTES[citation.corpus];
  if (!route) return null;
  const base = `${route}/${encodeURIComponent(citation.document_id)}`;
  // A pruned chunk still resolves to its document; there is just nothing to highlight.
  return citation.chunk_available
    ? `${base}?chunk=${encodeURIComponent(citation.chunk_id)}`
    : base;
}

function citationTitle(citation: Citation): string {
  if (!citation.document_available) return 'This source has been deleted';
  const heading = CitationText.headingLabel(citation);
  return heading ? `${citation.document_title} — ${heading}` : citation.document_title;
}

type CitationLinkProps = { href: string; className: string; title?: string; children: ReactNode };

/** Carries the current chat URL so the source page can link straight back to this thread. */
function CitationLink({ href, className, title, children }: CitationLinkProps) {
  const location = useLocation();
  const state: ReturnLinkState = { return_to: location.pathname, return_label: 'Back to chat' };
  return (
    <Link to={href} state={state} className={className} title={title}>
      {children}
    </Link>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const href = citation.document_available ? citationHref(citation) : null;
  if (!href) {
    return (
      <span className="chat-citation chat-citation-dead" title={citationTitle(citation)}>
        {citation.index}
      </span>
    );
  }
  return (
    <CitationLink href={href} className="chat-citation" title={citationTitle(citation)}>
      {citation.index}
    </CitationLink>
  );
}

function markdownComponents(citations: Citation[]): Components {
  const by_chunk_id = new Map(citations.map((c) => [c.chunk_id, c]));

  return {
    a({ href, children }) {
      const chunk_id = CitationText.chunkIdFromHref(href);
      const citation = chunk_id ? by_chunk_id.get(chunk_id) : undefined;
      if (citation) return <CitationChip citation={citation} />;
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
}

function markdownUrlTransform(url: string): string {
  return CitationText.isCitationHref(url) ? url : defaultUrlTransform(url);
}

function MessageBody({ role, text, citations }: Props) {
  // User input is typed prose, not markdown - rendering it would mangle stray asterisks.
  if (role === 'user') return <div className="chat-message-body">{text}</div>;

  const resolved = citations ?? [];
  return (
    <div className="chat-message-body chat-message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={markdownComponents(resolved)}
      >
        {CitationText.toMarkdown(text, resolved)}
      </ReactMarkdown>
    </div>
  );
}

export function ChatMessage({ role, text, citations }: Props) {
  return (
    <div className={`chat-message chat-message-${role}`}>
      <div className="chat-message-role">{role === 'user' ? 'You' : 'Assistant'}</div>
      <MessageBody role={role} text={text} citations={citations} />
      {citations && citations.length > 0 && (
        <div className="chat-sources">
          <div className="chat-sources-label">Sources</div>
          <ul>
            {citations.map((citation) => {
              const heading = CitationText.headingLabel(citation);
              const href = citation.document_available ? citationHref(citation) : null;
              const body = (
                <>
                  <span className="chat-source-index">{citation.index}</span>
                  <span className="chat-source-title">{citation.document_title}</span>
                  {heading && <span className="chat-source-heading">{heading}</span>}
                </>
              );
              return (
                <li key={citation.chunk_id}>
                  {href ? (
                    <CitationLink href={href} className="chat-source-row">
                      {body}
                    </CitationLink>
                  ) : (
                    <span className="chat-source-row chat-source-row-dead">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
