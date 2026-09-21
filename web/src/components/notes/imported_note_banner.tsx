import { useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import { DateFormat } from '../../lib/date_format';
import { Icon } from '../icon';
import type { Note } from '../../lib/note.types';

const SOURCE_LABELS: Record<string, string> = {
  onenote: 'OneNote',
  notion: 'Notion',
  evernote: 'Evernote',
};

/**
 * Imported notes are a mirror: the next sync overwrites the body wholesale, so editing
 * here would promise to keep something we are about to discard. This says where the note
 * really lives, and offers the two things that are useful instead — open it there, or
 * pull it again now.
 */
export function ImportedNoteBanner({ note, onSynced }: { note: Note; onSynced: (note: Note) => void }) {
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

  return (
    <div className="imported-banner">
      <Icon name="info" size={14} />
      <span className="imported-banner-text">
        Synced from {label} — edit it there.
        {note.last_synced_at && (
          <span className="imported-banner-time" title={DateFormat.full(note.last_synced_at)}>
            {' '}Updated {DateFormat.relative(note.last_synced_at)}.
          </span>
        )}
        {error && <span className="imported-banner-error"> {error}</span>}
      </span>

      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void syncNow()}>
        <Icon name="refresh" size={12} />
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {provider_url && (
        <a className="btn btn-ghost btn-sm" href={provider_url} target="_blank" rel="noreferrer noopener">
          Open in {label}
        </a>
      )}
    </div>
  );
}
