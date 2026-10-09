const SEPARATOR = ':';

export class JobDedupKey {
  private constructor() {}

  /**
   * Joins parts after trimming, rejecting empties so a key cannot collide by
   * accident - buildDedupKey(['note', '']) must not equal buildDedupKey(['note']).
   */
  static buildDedupKey(parts: string[]): string {
    const cleaned = parts.map((part) => part.trim());

    if (cleaned.length === 0 || cleaned.some((part) => part.length === 0)) {
      throw new Error('JobDedupKey.buildDedupKey requires at least one non-empty part');
    }
    if (cleaned.some((part) => part.includes(SEPARATOR))) {
      throw new Error(`JobDedupKey.buildDedupKey parts must not contain "${SEPARATOR}"`);
    }

    return cleaned.join(SEPARATOR);
  }
}
