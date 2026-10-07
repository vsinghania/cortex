import { useState } from 'react';
import type { Conversation } from '../../lib/agent.types';
import { Icon } from '../icon';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../mobile/mobile_bar';
import { BottomSheet } from '../mobile/bottom_sheet';
import { ThreadTitleInput } from './thread_title_input';

type Props = {
  title: string;
  conversation: Conversation | null;
  thinking: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  onTogglePin: (conversation: Conversation) => void;
  /** Resolves false when the rename failed, so the field stays open. */
  onRename: (conversation: Conversation, title: string) => Promise<boolean>;
  onDelete: (conversation: Conversation) => void;
};

type SheetView = 'actions' | 'rename';

/**
 * Renaming happens inside the sheet rather than in the bar: the sheet keeps the page inert
 * while it animates out, so a field in the bar couldn't take focus or raise the keyboard.
 */
export function MobileThreadBar({ title, conversation, thinking, onBack, onOpenInfo, onTogglePin, onRename, onDelete }: Props) {
  const [sheet_open, set_sheet_open] = useState(false);
  // Kept as-is on close, so the sheet doesn't swap content while it animates out.
  const [view, set_view] = useState<SheetView>('actions');
  const close = () => set_sheet_open(false);

  function openActions() {
    set_view('actions');
    set_sheet_open(true);
  }

  async function commitRename(target: Conversation, next: string): Promise<boolean> {
    const ok = await onRename(target, next);
    if (ok) close();
    return ok;
  }

  return (
    <>
      <MobileBar>
        <MobileBarButton label="Back to threads" icon="back" onClick={onBack} accent />
        <MobileBarTitle title={title} subtitle={thinking ? 'thinking…' : 'cortex-1'} />
        <MobileBarButton label="Session details" icon="info" onClick={onOpenInfo} />
        {conversation && <MobileBarButton label="Thread actions" icon="more" onClick={openActions} />}
      </MobileBar>

      {conversation && (
        <BottomSheet open={sheet_open} title={view === 'rename' ? 'Rename thread' : 'Thread actions'} onClose={close}>
          {view === 'rename' ? (
            <ThreadTitleInput
              initial={conversation.title ?? ''}
              className="input thread-title-input"
              onCommit={(next) => commitRename(conversation, next)}
              onCancel={close}
            />
          ) : (
            <div className="m-actions">
              <button type="button" className="m-action" onClick={() => set_view('rename')}>
                <Icon name="edit" size={17} />
                Rename thread
              </button>
              <button
                type="button"
                className="m-action"
                onClick={() => {
                  close();
                  onTogglePin(conversation);
                }}
              >
                <Icon name="pin" size={17} />
                {conversation.is_pinned ? 'Unpin thread' : 'Pin thread'}
              </button>
              <button
                type="button"
                className="m-action m-action-danger"
                onClick={() => {
                  close();
                  onDelete(conversation);
                }}
              >
                <Icon name="trash" size={17} />
                Delete thread
              </button>
            </div>
          )}
        </BottomSheet>
      )}
    </>
  );
}
