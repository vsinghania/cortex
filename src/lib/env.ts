import { z } from 'zod';

export class Env {
  /** Compose expands unset optional variables to empty strings. */
  public static normalizeEmptyStringAsUndefined<T extends z.ZodType>(schema: T) {
    return z.preprocess((value) => value === '' ? undefined : value, schema);
  }
}
