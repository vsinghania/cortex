import { useState } from 'react';
import { ConfirmDialog } from '../confirm_dialog';
import { OneNoteLogo } from '../onenote_logo';
import { useOneNoteConnection } from '../../lib/use_onenote_connection';
import { useOneNoteSync } from '../../lib/use_onenote_sync';
import { DateFormat } from '../../lib/date_format';
import { Icon } from '../icon';
import { OneNoteNotebookDialog } from './onenote_notebook_dialog';
import type { OneNoteConnection, OneNoteLastSync, OneNoteSyncJob } from '../../lib/onenote.types';

const ACTIVE_SYNC_STATUSES = new Set(['queued', 'running']);

/** The job's reason code is for us; this is what a person needs to do about it. */
function syncFailureText(reason: string | null | undefined): string {
  if (reason === 'reauth_required') return 'Microsoft access expired. Connect again to resume syncing.';
  if (reason === 'throttled') return 'Microsoft is rate limiting us. The next scheduled sync will retry.';
  return "The last sync didn't finish. Try again, or wait for the next scheduled one.";
}

/** Live counts while a pass runs, and the tally once it stops. */
function describeProgress(progress: OneNoteSyncJob['progress'] | undefined, running: boolean): string {
  const pages = progress?.processed ?? 0;
  const failed = progress?.failed ?? 0;
  const noun = `page${pages === 1 ? '' : 's'}`;

  if (running) {
    return pages === 0 ? 'Looking for changes…' : `${pages} ${noun} so far…`;
  }
  const done = pages === 0 ? 'Already up to date' : `Synced ${pages} ${noun}`;
  return failed ? `${done}, ${failed} skipped` : done;
}

/**
 * Sections Cortex cannot read — password-protected ones, most often. Worth saying out
 * loud: otherwise those notes are quietly missing and nothing explains why.
 */
function describeSkipped(result: OneNoteSyncJob['result']): string | null {
  const skipped = Number((result as { sections_skipped?: number } | null)?.sections_skipped ?? 0);
  if (!skipped) return null;
  return `${skipped} section${skipped === 1 ? '' : 's'} couldn't be read — password-protected sections stay in OneNote.`;
}

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
          : // Per-notebook times live in the table; repeating an account-wide one here
            // only invites the two to disagree.
            `Connected ${formatDate(connection.created_at)}`}
      </span>
    </div>
  );
}

/**
 * Status first: day to day the question is "is my stuff current?", not "which notebooks
 * did I pick?". Choosing is a setup task and lives in a dialog.
 */
function SyncSection({
  connection,
  last_sync,
  onFinished
}: {
  connection: OneNoteConnection;
  last_sync: OneNoteLastSync | null;
  onFinished: () => void;
}) {
  const active = last_sync && ACTIVE_SYNC_STATUSES.has(last_sync.status) ? last_sync : null;
  const { job, running, scope, current_notebook_id, error, start } = useOneNoteSync({ onFinished, active });
  // A failure the browser never saw, because it happened before this page was loaded.
  const stale_failure = !job && last_sync?.status === 'failed' ? last_sync : null;
  const [choosing, set_choosing] = useState(false);

  const selected = connection.notebooks.filter((n) => connection.selected_notebook_ids.includes(n.id));
  const chooser = (
    <OneNoteNotebookDialog open={choosing} onClose={() => set_choosing(false)} onSaved={onFinished} />
  );

  if (selected.length === 0) {
    return (
      <div className="connection-sync">
        <p className="connection-meta">
          Nothing is syncing yet. Choose the notebooks you want in Cortex.
        </p>
        <div className="connection-actions">
          <button type="button" className="btn btn-primary" onClick={() => set_choosing(true)}>
            Choose notebooks
          </button>
        </div>
        {chooser}
      </div>
    );
  }

  return (
    <div className="connection-sync">
      <div className="notebook-head">
        <p className="connection-meta">
          Syncing {selected.length} of {connection.notebooks.length} notebook
          {connection.notebooks.length === 1 ? '' : 's'}
        </p>
        <button type="button" className="text-link" onClick={() => set_choosing(true)}>
          Choose notebooks
        </button>
      </div>

      <ul className="notebook-status-list">
        {selected.map((notebook) => {
          // The pass works through notebooks one at a time, so only the one it is on
          // says "syncing". Before the first checkpoint lands, fall back to the scope.
          const in_scope = scope === null || !!scope?.includes(notebook.id);
          const syncing =
            running && in_scope && (current_notebook_id ? current_notebook_id === notebook.id : true);
          return (
            <li key={notebook.id} className="notebook-status-row">
              <span className="notebook-name">{notebook.display_name}</span>
              <span className="notebook-status">
                {/* Read from the notebook itself, so it survives the job row being reaped. */}
                {!syncing && notebook.last_error ? (
                  <span className="notebook-failed" title={syncFailureText(notebook.last_error)}>
                    {notebook.consecutive_failures && notebook.consecutive_failures > 1
                      ? `failed ${notebook.consecutive_failures}×`
                      : 'sync failed'}
                  </span>
                ) : syncing ? (
                  <span className="notebook-syncing">syncing…</span>
                ) : notebook.last_synced_at ? (
                  <span title={DateFormat.full(notebook.last_synced_at)}>
                    synced {DateFormat.relative(notebook.last_synced_at)}
                  </span>
                ) : (
                  <span className="notebook-muted">not synced yet</span>
                )}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={running}
                aria-label={`Sync ${notebook.display_name}`}
                title={`Sync ${notebook.display_name}`}
                onClick={() => void start({ notebook_ids: [notebook.id] })}
              >
                <Icon name="refresh" size={13} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="connection-actions">
        <button type="button" className="btn btn-primary" disabled={running} onClick={() => void start()}>
          {running ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {running && (
        <div className="sync-progress" role="status" aria-live="polite">
          {/* Indeterminate on purpose: the page count is only known once the walk ends,
              so any percentage here would be invented. */}
          <div className="sync-progress-track">
            <div className="sync-progress-bar" />
          </div>
          <p className="connection-meta">{describeProgress(job?.progress, true)}</p>
        </div>
      )}

      {stale_failure && (
        <p className="connection-error" role="status">
          {syncFailureText(stale_failure.last_error)}
        </p>
      )}

      {job && !running && (
        <>
          <p className="connection-meta" role="status">
            {describeProgress(job.progress, false)}
          </p>
          {describeSkipped(job.result) && <p className="connection-meta">{describeSkipped(job.result)}</p>}
        </>
      )}
      {error && <p className="connection-error">{error}</p>}
      {chooser}
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
            <SyncSection
              connection={connection}
              last_sync={status?.last_sync ?? null}
              onFinished={() => void reload()}
            />
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
