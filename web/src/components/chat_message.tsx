import { Link } from 'react-router-dom';
import type { Citation } from '../lib/agent.types';
import { CitationText } from '../lib/citation_text';

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

export function ChatMessage({ role, text, citations }: Props) {
  const segments = CitationText.parse(text, citations);

  return (
    <div className={`chat-message chat-message-${role}`}>
      <div className="chat-message-role">{role === 'user' ? 'You' : 'Assistant'}</div>
      <div className="chat-message-body">
        {segments.map((segment, i) => {
          if (segment.type === 'text') return <span key={i}>{segment.text}</span>;
          const { citation } = segment;
          const href = citation.document_available ? citationHref(citation) : null;
          if (!href) {
            return (
              <span key={i} className="chat-citation chat-citation-dead" title={citationTitle(citation)}>
                {citation.index}
              </span>
            );
          }
          return (
            <Link key={i} to={href} className="chat-citation" title={citationTitle(citation)}>
              {citation.index}
            </Link>
          );
        })}
      </div>
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
                    <Link to={href} className="chat-source-row">
                      {body}
                    </Link>
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
