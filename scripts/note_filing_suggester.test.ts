import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteFilingSuggester } from '../src/notes_svc/filing/note_filing_suggester.js';
import type { NoteFolderNode } from '../src/notes_svc/types/note_folder.types.js';
import { AiSvc } from '../src/ai_svc/ai_svc.js';

const FOLDERS: NoteFolderNode[] = [
  {
    id: 'f-clients',
    user_id: 'u1',
    name: 'Clients',
    parent_id: 'f-work',
    ancestor_ids: ['f-work'],
    path: ['Work', 'Clients'],
    note_count: 2,
    created_at: new Date(0),
    updated_at: new Date(0)
  }
];

const TAGS = [{ tag: 'Meetings', count: 4 }, { tag: 'ideas', count: 1 }];

test('filing suggestions send folder descriptions to AI and preserve multiline text as folder data', async (context) => {
  const description = 'Client calls.\nExclude internal planning.';
  let request: Parameters<AiSvc['generateStructured']>[0] | undefined;
  context.mock.method(AiSvc, 'getInstance', async () => ({
    generateStructured: async (params: Parameters<AiSvc['generateStructured']>[0]) => {
      request = params;
      return { data: { title: null, folder_match: 'clear', folder_id: 'f-clients', tags: [] }, model: 'test-model' };
    }
  } as unknown as AiSvc));
  const { suggestion } = await NoteFilingSuggester.suggestNoteFiling({
    title: 'Client call', body: 'Discussed delivery dates.',
    folders: [{ ...FOLDERS[0], description }, { ...FOLDERS[0], id: 'legacy', description: undefined }], tags: TAGS
  });
  assert.ok(request);
  assert.ok(JSON.stringify(request.messages).includes('full path and description'));
  const user_prompt = request.messages[1].content;
  assert.equal(typeof user_prompt, 'string');
  const rows = String(user_prompt).split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  assert.equal(rows[0].description, description);
  assert.equal(rows[1].description, '');
  assert.equal(suggestion.folder?.id, 'f-clients');
});

test('keeps a known folder with its path and drops an invented one', () => {
  const known = NoteFilingSuggester.sanitizeFilingSuggestion({ title: null, folder_match: 'clear', folder_id: 'f-clients', tags: [] }, { folders: FOLDERS, tags: TAGS });
  assert.deepEqual(known.folder, { id: 'f-clients', path: ['Work', 'Clients'] });

  const invented = NoteFilingSuggester.sanitizeFilingSuggestion({ title: null, folder_match: 'clear', folder_id: 'f-made-up', tags: [] }, { folders: FOLDERS, tags: TAGS });
  assert.equal(invented.folder, null);
});

test('drops a folder unless the model calls it a clear match', () => {
  for (const folder_match of ['loose', 'none'] as const) {
    const result = NoteFilingSuggester.sanitizeFilingSuggestion({ title: null, folder_match, folder_id: 'f-clients', tags: [] }, { folders: FOLDERS, tags: TAGS });
    assert.equal(result.folder, null, `folder_match ${folder_match}`);
  }
});

test('snaps tags to existing spelling, dedupes by case and caps the count', () => {
  const result = NoteFilingSuggester.sanitizeFilingSuggestion(
    { title: null, folder_match: 'none', folder_id: null, tags: ['meetings', 'MEETINGS', ' Ideas ', '', 'a', 'b', 'c', 'd'] },
    { folders: FOLDERS, tags: TAGS }
  );
  assert.deepEqual(result.tags, ['Meetings', 'ideas', 'a', 'b', 'c']);
  assert.equal(result.tags.length, NoteFilingSuggester.MAX_SUGGESTED_TAGS);
});

test('suggests a title only when the note has none', () => {
  const untitled = NoteFilingSuggester.sanitizeFilingSuggestion(
    { title: '  Quarterly   Planning Notes ', folder_match: 'none', folder_id: null, tags: [] },
    { title: '   ', folders: FOLDERS, tags: TAGS }
  );
  assert.equal(untitled.title, 'Quarterly Planning Notes');

  const titled = NoteFilingSuggester.sanitizeFilingSuggestion(
    { title: 'Something Else', folder_match: 'none', folder_id: null, tags: [] },
    { title: 'My title', folders: FOLDERS, tags: TAGS }
  );
  assert.equal(titled.title, null);
});

test('a blank or overlong suggested title is cleaned up', () => {
  const blank = NoteFilingSuggester.sanitizeFilingSuggestion({ title: '   ', folder_match: 'none', folder_id: null, tags: [] }, { folders: FOLDERS, tags: TAGS });
  assert.equal(blank.title, null);

  const long = NoteFilingSuggester.sanitizeFilingSuggestion(
    { title: 'x'.repeat(NoteFilingSuggester.MAX_TITLE_CHARS + 50), folder_match: 'none', folder_id: null, tags: [] },
    { folders: FOLDERS, tags: TAGS }
  );
  assert.equal(long.title!.length, NoteFilingSuggester.MAX_TITLE_CHARS);
});
