export class NoteTagOptions {
  static normalizeTag(value: string): string {
    return value.trim().replace(/^#/, '').trim();
  }

  static includesTag(tags: string[], tag: string): boolean {
    return tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  }

  static findCommonTags(tag_sets: string[][]): string[] {
    return (tag_sets[0] ?? []).filter((tag) => tag_sets.every((tags) => NoteTagOptions.includesTag(tags, tag)));
  }

  static canAddTag(params: { selected: string[]; value: string }): boolean {
    const tag = NoteTagOptions.normalizeTag(params.value);
    return !!tag && !NoteTagOptions.includesTag(params.selected, tag);
  }

  static filterAvailableTags(tags: string[], selected: string[], value: string): string[] {
    const query = NoteTagOptions.normalizeTag(value).toLowerCase();
    return tags
      .filter((tag) => !NoteTagOptions.includesTag(selected, tag) && tag.toLowerCase().includes(query))
      .sort((left, right) => left.localeCompare(right));
  }

  static resolveTagToAdd(tags: string[], value: string): string {
    const tag = NoteTagOptions.normalizeTag(value);
    return tags.find((existing) => existing.toLowerCase() === tag.toLowerCase()) ?? tag;
  }
}
