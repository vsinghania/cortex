import { useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import { DateFormat } from '../../lib/date_format';
import { Icon } from '../icon';
import { OneNoteLogo } from '../onenote_logo';
import type { Note } from '../../lib/note.types';

const SOURCE_LABELS: Record<string, string> = {
  onenote: 'OneNote',
  notion: 'Notion',
  evernote: 'Evernote',
};

/**
 * Provenance belongs on the meta line with the date and word count, not in a banner
 * above the title: it is a standing fact about the note, not a message, and the title
 * should be the first thing on the page.
 */
export function ImportedNoteMeta({ note, onSynced }: { note: Note; onSynced: (note: Note) => void }) {
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const label = SOURCE_LABELS[note.source] ?? note.source;
  const provider_url = note.metadata?.provider_url;

  async function syncNow() {
    set_busy(true);
    set_error(null);
    try {
      const { note: fresh } = await ApiClient.syncOneNoteNote(note.id);
      onSynced(fresh);
    } catch (err) {
      set_error(err instanceof Error ? err.message : `We couldn't reach ${label}.`);
    } finally {
      set_busy(false);
    }
  }

  const synced_hint = note.last_synced_at ? ` Last synced ${DateFormat.relative(note.last_synced_at)}.` : '';

  return (
    <span className="imported-meta">
      {note.source === 'onenote' ? <OneNoteLogo size={12} /> : <Icon name="refresh" size={12} />}
      <span className="mono-meta" title={`Synced from ${label} — edit it there.${synced_hint}`}>
        {label} · read-only
      </span>

      <button
        type="button"
        className="icon-btn icon-btn-sm"
        disabled={busy}
        aria-label={`Sync this note from ${label}`}
        title={busy ? 'Syncing…' : `Sync this note from ${label}`}
        onClick={() => void syncNow()}
      >
        <Icon name="refresh" size={12} />
      </button>

      {provider_url && (
        <a
          className="icon-btn icon-btn-sm"
          href={provider_url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open in ${label}`}
          title={`Open in ${label}`}
        >
          <Icon name="external" size={12} />
        </a>
      )}

      {error && <span className="imported-meta-error">{error}</span>}
    </span>
  );
}
