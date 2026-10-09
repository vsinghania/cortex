import { Icon } from '../icon';
import { NoteEditorControls } from '../../lib/note_editor_controls';

export type EditorMode = 'edit' | 'preview';

export function NoteModeSwitch({ mode, onChange }: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Editor mode">
      {(['edit', 'preview'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          className={`segmented-item${mode === value ? ' segmented-item-active' : ''}`}
          // The label is hidden on mobile, where the bar has no room for it.
          aria-label={value === 'edit' ? 'Edit' : 'Preview'}
          title={`${value === 'edit' ? 'Edit' : 'Preview'} (${NoteEditorControls.modeToggleLabel()})`}
          onClick={() => onChange(value)}
        >
          <Icon name={value === 'edit' ? 'edit' : 'eye'} size={12} />
          <span className="segmented-label">{value === 'edit' ? 'Edit' : 'Preview'}</span>
        </button>
      ))}
    </div>
  );
}
