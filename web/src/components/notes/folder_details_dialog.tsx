import { useId, useRef, useState } from 'react';
import { ConfirmDialog } from '../confirm_dialog';

type Props = {
  title: string;
  initial_name?: string;
  initial_description?: string;
  onSave: (name: string, description: string) => Promise<boolean>;
  onCancel: () => void;
};

export function FolderDetailsDialog({ title, initial_name = '', initial_description = '', onSave, onCancel }: Props) {
  const [name, set_name] = useState(initial_name);
  const [description, set_description] = useState(initial_description);
  const [saving, set_saving] = useState(false);
  const form_ref = useRef<HTMLFormElement>(null);
  const hint_id = useId();

  async function saveFolderDetails() {
    if (saving || !form_ref.current?.reportValidity()) return;
    set_saving(true);
    try {
      if (await onSave(name.trim(), description.trim())) onCancel();
    } finally {
      set_saving(false);
    }
  }

  return (
    <ConfirmDialog open title={title} confirm_label="Save" confirm_autofocus={false} busy={saving} onConfirm={() => void saveFolderDetails()} onCancel={onCancel}>
      <form ref={form_ref} className="folder-details-form" onSubmit={(event) => { event.preventDefault(); void saveFolderDetails(); }}>
        <label className="field">
          <span className="field-label">Folder name</span>
          <input className="input" value={name} onChange={(event) => set_name(event.target.value)} required pattern=".*\S.*" maxLength={100} disabled={saving} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea className="input folder-description-input" value={description} onChange={(event) => set_description(event.target.value)} rows={4} maxLength={1000} disabled={saving} aria-describedby={hint_id} placeholder="What kinds of notes belong in this folder?" />
        </label>
        <p id={hint_id} className="field-hint">A short description helps AI assistants choose the right folder for your notes.</p>
      </form>
    </ConfirmDialog>
  );
}
