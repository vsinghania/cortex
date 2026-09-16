import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '../../lib/agent.types';
import type { Note } from '../../lib/note.types';
import type { ReturnLinkState } from '../../lib/navigation.types';
import { CitationText } from '../../lib/citation_text';
import { Icon } from '../icon';
import type { ChatTurn } from '../../lib/assistant.types';
import { AppRoutes } from '../../lib/app_routes';

type Props = {
  turn: ChatTurn;
  onSaveAsNote: (turn: ChatTurn) => Promise<Note>;
};

type SaveState = { status: 'idle' | 'saving' | 'error' } | { status: 'saved'; note_id: string };

const COPIED_FEEDBACK_MS = 1500;

export function ChatMessage({ turn, onSaveAsNote }: Props) {
  const time = new Date(turn.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (turn.role === 'user') {
    return (
      <div className="msg msg-user">
        <span className="sr-only">You said:</span>
        <div className="msg-bubble">
          {turn.text}
          <time className="msg-time" dateTime={turn.created_at}>{time}</time>
        </div>
      </div>
    );
  }

  const citations = turn.citations ?? [];
  return (
    <div className="msg msg-assistant">
      <span className="msg-avatar" aria-hidden="true">
        <Icon name="hexagon" size={14} />
      </span>
      <div className="msg-content">
        <div className="msg-byline">
          <span className="msg-author">Cortex</span>
          <time className="msg-time" dateTime={turn.created_at}>{time}</time>
        </div>
        <span className="sr-only">Assistant said:</span>
        <div className="markdown msg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={MarkdownUrls.transform} components={MarkdownUrls.components(citations)}>
            {CitationText.toMarkdown(turn.text, citations)}
          </ReactMarkdown>
        </div>
        {citations.length > 0 && <SourceChips citations={citations} />}
        <MessageActions turn={turn} onSaveAsNote={onSaveAsNote} />
      </div>
    </div>
  );
}

function MessageActions({ turn, onSaveAsNote }: Props) {
  const [copied, set_copied] = useState(false);
  const [save, set_save] = useState<SaveState>({ status: 'idle' });

  async function copy() {
    try {
      await navigator.clipboard.writeText(CitationText.toPlainWithSources(turn.text, turn.citations));
      set_copied(true);
      window.setTimeout(() => set_copied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard access can be denied; nothing useful to show beyond the unchanged button.
    }
  }

  async function saveAsNote() {
    set_save({ status: 'saving' });
    try {
      const note = await onSaveAsNote(turn);
      set_save({ status: 'saved', note_id: note.id });
    } catch {
      set_save({ status: 'error' });
    }
  }

  return (
    <div className="msg-actions">
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => void copy()} aria-label="Copy answer" title={copied ? 'Copied' : 'Copy'}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
      {save.status === 'saved' ? (
        <span className="msg-saved">
          <Icon name="check" size={12} />
          Saved · <Link to={AppRoutes.note(save.note_id)} className="text-link">Open</Link>
        </span>
      ) : (
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => void saveAsNote()}
          disabled={save.status === 'saving'}
          aria-label="Save as note"
          title={save.status === 'error' ? "Couldn't save. Try again" : 'Save as note'}
        >
          <Icon name="file_plus" size={13} />
        </button>
      )}
      {save.status === 'error' && <span className="msg-save-error">Couldn't save the note.</span>}
    </div>
  );
}

function SourceChips({ citations }: { citations: Citation[] }) {
  return (
    <div className="sources">
      <span className="sources-label">Sources</span>
      {citations.map((citation) => {
        const href = CitationLinks.href(citation);
        const body = (
          <>
            <span className="source-index">{citation.index}</span>
            {citation.document_title}
          </>
        );
        return href ? (
          <CitationLink key={citation.chunk_id} href={href} className="source-chip" title={CitationLinks.title(citation)}>
            {body}
          </CitationLink>
        ) : (
          <span key={citation.chunk_id} className="source-chip source-chip-dead" title={CitationLinks.title(citation)}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

type CitationLinkProps = { href: string; className: string; title?: string; children: ReactNode };

/** Carries this thread's URL so the note page can link straight back to it. */
export function CitationLink({ href, className, title, children }: CitationLinkProps) {
  const location = useLocation();
  const state: ReturnLinkState = { return_to: `${location.pathname}${location.search}`, return_label: 'Back to chat' };
  return (
    <Link to={href} state={state} className={className} title={title}>
      {children}
    </Link>
  );
}

export class CitationLinks {
  /** Only notes have a page; other corpora render as dead references. */
  static href(citation: Citation): string | null {
    if (!citation.document_available || citation.corpus !== 'notes') return null;
    // A pruned chunk still resolves to its note; there is just nothing to highlight.
    const search = citation.chunk_available ? `chunk=${encodeURIComponent(citation.chunk_id)}` : '';
    return AppRoutes.note(citation.document_id, search);
  }

  static title(citation: Citation): string {
    if (!citation.document_available) return 'This source has been deleted';
    const heading = CitationText.headingLabel(citation);
    return heading ? `${citation.document_title} — ${heading}` : citation.document_title;
  }
}

class MarkdownUrls {
  static transform(url: string): string {
    return CitationText.isCitationHref(url) ? url : defaultUrlTransform(url);
  }

  static components(citations: Citation[]): Components {
    const by_chunk_id = new Map(citations.map((c) => [c.chunk_id, c]));
    return {
      a({ href, children }) {
        const chunk_id = CitationText.chunkIdFromHref(href);
        const citation = chunk_id ? by_chunk_id.get(chunk_id) : undefined;
        if (citation) {
          const citation_href = CitationLinks.href(citation);
          return citation_href ? (
            <CitationLink href={citation_href} className="cite" title={CitationLinks.title(citation)}>
              {citation.index}
            </CitationLink>
          ) : (
            <span className="cite cite-dead" title={CitationLinks.title(citation)}>{citation.index}</span>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
    };
  }
}
