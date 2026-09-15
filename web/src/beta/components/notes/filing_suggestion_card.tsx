import type { ReactNode } from 'react';
import { Icon } from '../../../components/icon';
import { FolderTree } from '../../lib/folder_tree';
import { NoteFiling } from '../../lib/note_filing';
import type { FilingChoice, PendingFiling } from '../../lib/note_filing';
import type { FilingSuggestionState } from '../../lib/use_filing_suggestion';

type Props = {
  state: Exclude<FilingSuggestionState, { status: 'idle' }>;
  /** Null until a suggestion has arrived. */
  pending: PendingFiling | null;
  onApply: (choice: FilingChoice) => void;
  onRetry: () => void;
  onDismiss: () => void;
};

export function FilingSuggestionCard({ state, pending, onApply, onRetry, onDismiss }: Props) {
  const has_pending = !!pending && !NoteFiling.isEmpty(pending);

  return (
    <section className="filing-card" aria-label="Filing suggestions" aria-busy={state.status === 'loading'}>
      <header className="filing-card-header">
        <Icon name="wand" size={14} />
        <span className="filing-card-title">Suggestions</span>
        <span className="filing-card-actions">
          {has_pending && (
            <button type="button" className="link-btn" onClick={() => onApply(NoteFiling.everything(pending))}>
              Apply all
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm" onClick={onDismiss} aria-label="Dismiss suggestions" title="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </span>
      </header>

      {state.status === 'loading' && (
        <p className="filing-card-note" role="status">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          Reading the note…
        </p>
      )}

      {state.status === 'error' && (
        <p className="filing-card-note status-error" role="alert">
          {state.message}{' '}
          <button type="button" className="link-btn" onClick={onRetry}>Try again</button>
        </p>
      )}

      {state.status === 'ready' && !has_pending && (
        <p className="filing-card-note">
          {NoteFiling.isEmpty(state.suggestion)
            ? 'Nothing clearly fits this note yet. Try again once it has more content.'
            : 'This note is already filed where it fits.'}
        </p>
      )}

      {has_pending && (
        <dl className="filing-card-rows">
          {pending.title && (
            <FilingRow label="Title" action="Use title" onAction={() => onApply({ title: pending.title! })}>
              <span className="filing-card-value">{pending.title}</span>
            </FilingRow>
          )}
          {pending.folder && (
            <FilingRow label="Folder" action="Move here" onAction={() => onApply({ folder_id: pending.folder!.id })}>
              <span className="filing-card-value">
                <Icon name="folder" size={13} />
                {FolderTree.pathLabel(pending.folder)}
              </span>
            </FilingRow>
          )}
          {pending.tags.length > 0 && (
            <FilingRow
              label="Tags"
              action={pending.tags.length > 1 ? 'Add all' : 'Add'}
              onAction={() => onApply({ tags: pending.tags })}
            >
              <span className="filing-card-tags">
                {pending.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip chip-suggested"
                    onClick={() => onApply({ tags: [tag] })}
                    aria-label={`Add tag ${tag}`}
                    title={`Add #${tag}`}
                  >
                    <Icon name="plus" size={10} />
                    {tag}
                  </button>
                ))}
              </span>
            </FilingRow>
          )}
        </dl>
      )}
    </section>
  );
}

type RowProps = {
  label: string;
  action: string;
  onAction: () => void;
  children: ReactNode;
};

function FilingRow({ label, action, onAction, children }: RowProps) {
  return (
    <div className="filing-card-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
      <dd className="filing-card-row-action">
        <button type="button" className="link-btn" onClick={onAction}>{action}</button>
      </dd>
    </div>
  );
}
