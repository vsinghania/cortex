import { useState } from 'react';
import { ConfirmDialog } from '../confirm_dialog';
import { OneNoteLogo } from './onenote_logo';
import { useOneNoteConnection } from '../../lib/use_onenote_connection';
import { useOneNoteSync } from '../../lib/use_onenote_sync';
import { OneNoteNotebookPicker } from './onenote_notebook_picker';
import type { OneNoteConnection } from '../../lib/onenote.types';

function formatDate(iso: string | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ConnectionDetail({ connection }: { connection: OneNoteConnection }) {
  return (
    <div className="connection-detail">
      <span className="connection-account">{connection.microsoft_email}</span>
      <span className="connection-meta">
        {connection.status === 'needs_reauth'
          ? 'Microsoft access expired or was revoked. Connect again to resume syncing.'
          : `Connected ${formatDate(connection.created_at)} · last synced ${formatDate(connection.last_synced_at)}`}
      </span>
    </div>
  );
}

function SyncRow({ connection, onFinished }: { connection: OneNoteConnection; onFinished: () => void }) {
  const { job, running, error, start } = useOneNoteSync({ onFinished });
  const nothing_chosen = connection.selected_notebook_ids.length === 0;

  return (
    <div className="connection-sync">
      <div className="connection-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={running || nothing_chosen}
          onClick={() => void start()}
          title={nothing_chosen ? 'Choose a notebook first' : undefined}
        >
          {running ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {job && (
        <p className="connection-meta" role="status">
          {running
            ? `Imported ${job.progress.processed} page${job.progress.processed === 1 ? '' : 's'}…`
            : `Finished: ${job.progress.succeeded} page${job.progress.succeeded === 1 ? '' : 's'} synced` +
              (job.progress.failed ? `, ${job.progress.failed} skipped` : '')}
        </p>
      )}
      {error && <p className="connection-error">{error}</p>}
    </div>
  );
}

export function OneNoteCard() {
  const { status, loading, busy, error, connect, disconnect, reload } = useOneNoteConnection();
  const [confirming, set_confirming] = useState(false);

  const connection = status?.connection ?? null;
  const unavailable = status !== null && !status.available;

  async function handleDisconnect() {
    await disconnect();
    set_confirming(false);
  }

  return (
    <article className="connection-card">
      <div className="connection-head">
        <span className="connection-icon" aria-hidden="true">
          <OneNoteLogo size={22} />
        </span>
        <div className="connection-title">
          <h3>Microsoft OneNote</h3>
          <p>Bring your notebooks into Cortex, and ask questions across all your notes in one place.</p>
        </div>
      </div>

      {loading && <p className="connection-meta">Loading…</p>}

      {unavailable && (
        <p className="connection-meta">OneNote isn't available on this server yet.</p>
      )}

      {!loading && !unavailable && connection && (
        <>
          <ConnectionDetail connection={connection} />
          {connection.status !== 'needs_reauth' && (
            <>
              <OneNoteNotebookPicker onChanged={() => void reload()} />
              <SyncRow connection={connection} onFinished={() => void reload()} />
            </>
          )}
        </>
      )}

      {error && (
        <p className="connection-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !unavailable && (
        <div className="connection-actions">
          {connection ? (
            <>
              {connection.status === 'needs_reauth' && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
                  Reconnect
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy}
                onClick={() => set_confirming(true)}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
              Connect OneNote
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Disconnect OneNote?"
        confirm_label="Disconnect"
        danger
        busy={busy}
        onConfirm={() => void handleDisconnect()}
        onCancel={() => set_confirming(false)}
      >
        Cortex will stop syncing from OneNote. Notes already imported stay in Cortex, and nothing is
        changed in OneNote.
      </ConfirmDialog>
    </article>
  );
}
