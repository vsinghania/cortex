import { Icon } from '../../../components/icon';

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
          onClick={() => onChange(value)}
        >
          <Icon name={value === 'edit' ? 'edit' : 'eye'} size={12} />
          {value === 'edit' ? 'Edit' : 'Preview'}
        </button>
      ))}
    </div>
  );
}
