import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../../../lib/api_client';
import type { NoteChunkRef } from '../../../lib/note.types';
import type { ReturnLinkState } from '../../../lib/navigation.types';
import { NoteHighlight } from '../../../lib/note_highlight';
import { Icon } from '../../../components/icon';

type Props = {
  note_id: string;
  body: string;
  chunk_id: string;
  return_link: ReturnLinkState | null;
  onEdit: () => void;
};

/** The raw body with the cited passage marked, opened from a citation in the assistant. */
export function CitationSourceView({ note_id, body, chunk_id, return_link, onEdit }: Props) {
  const [chunk, set_chunk] = useState<NoteChunkRef | null>(null);
  const mark_ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await ApiClient.getNoteChunk(note_id, chunk_id);
        if (!cancelled) set_chunk(res.chunk);
      } catch {
        // A pruned or unknown chunk just means no highlight; the note still renders.
        if (!cancelled) set_chunk(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [note_id, chunk_id]);

  const highlight = NoteHighlight.resolve(body, chunk);

  useEffect(() => {
    if (highlight) mark_ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight?.start, highlight?.end]);

  return (
    <>
      <div className="citation-banner" role="status">
        <Icon name="sparkle" size={14} />
        <span>{highlight ? 'Showing the passage the assistant cited.' : 'Opened from a citation.'}</span>
        <span className="citation-banner-actions">
          {return_link && (
            <Link to={return_link.return_to} className="link-btn">
              ← {return_link.return_label}
            </Link>
          )}
          <button type="button" className="link-btn" onClick={onEdit}>Edit note</button>
        </span>
      </div>
      <pre className="source-body">
        {highlight ? (
          <>
            {body.slice(0, highlight.start)}
            <mark ref={mark_ref}>{body.slice(highlight.start, highlight.end)}</mark>
            {body.slice(highlight.end)}
          </>
        ) : (
          body
        )}
      </pre>
    </>
  );
}
