import { useMemo } from 'react';
import type { Citation } from '../../../lib/agent.types';
import { Icon } from '../../../components/icon';
import type { ChatTurn } from '../../lib/assistant.types';
import type { AssistantMode } from '../../lib/beta_routes';
import { CitationLink, CitationLinks } from './beta_chat_message';

type Props = {
  turns: ChatTurn[];
  mode: AssistantMode;
};

export function SessionRail({ turns, mode }: Props) {
  // One entry per note, keeping the first passage cited from it as the jump target.
  const sources = useMemo(() => {
    const by_document = new Map<string, Citation>();
    for (const turn of turns) {
      for (const citation of turn.citations ?? []) {
        if (!by_document.has(citation.document_id)) by_document.set(citation.document_id, citation);
      }
    }
    return [...by_document.values()];
  }, [turns]);

  const user_turns = turns.filter((t) => t.role === 'user').length;

  return (
    <aside className="side-rail" aria-label="Session details">
      <div className="side-heading">Referenced notes</div>
      <div className="related">
        {sources.length === 0 ? (
          <p className="side-empty">Nothing cited in this thread yet.</p>
        ) : (
          sources.map((citation) => {
            const href = CitationLinks.href(citation);
            const content = (
              <>
                <Icon name="notes" size={13} />
                <span className="related-title">{citation.document_title}</span>
              </>
            );
            return href ? (
              <CitationLink key={citation.document_id} href={href} className="related-card related-card-row" title={CitationLinks.title(citation)}>
                {content}
              </CitationLink>
            ) : (
              <span key={citation.document_id} className="related-card related-card-row related-card-dead" title={CitationLinks.title(citation)}>
                {content}
              </span>
            );
          })
        )}
      </div>

      <div className="side-heading">This session</div>
      <dl className="details">
        <dt>Mode</dt>
        <dd>{mode === 'voice' ? 'Voice' : 'Chat'}</dd>
        <dt>Turns</dt>
        <dd className="mono-meta">{user_turns}</dd>
        <dt>Notes cited</dt>
        <dd className="mono-meta">{sources.length}</dd>
      </dl>
    </aside>
  );
}
