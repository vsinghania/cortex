const SEPARATOR = ':';

export class JobDedupKey {
  private constructor() {}

  /**
   * Joins parts after trimming, rejecting empties so a key cannot collide by
   * accident - build(['note', '']) must not equal build(['note']).
   */
  static build(parts: string[]): string {
    const cleaned = parts.map((part) => part.trim());

    if (cleaned.length === 0 || cleaned.some((part) => part.length === 0)) {
      throw new Error('JobDedupKey.build requires at least one non-empty part');
    }
    if (cleaned.some((part) => part.includes(SEPARATOR))) {
      throw new Error(`JobDedupKey.build parts must not contain "${SEPARATOR}"`);
    }

    return cleaned.join(SEPARATOR);
  }
}
