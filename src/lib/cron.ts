import { CronExpressionParser } from 'cron-parser';

/**
 * Anti-corruption wrapper around cron-parser, so the package is imported in
 * exactly one file - the same role Id plays for nanoid and Time for duration math.
 */
export class Cron {
  private constructor() {}

  /**
   * The next firing strictly after `from`. Always computed forward from the given
   * instant rather than from a stale stored value, which is what bounds catch-up
   * to a single run after downtime.
   */
  static nextRunAt(params: { expression: string; from: Date; timezone?: string }): Date {
    const iterator = CronExpressionParser.parse(params.expression, {
      currentDate: params.from,
      tz: params.timezone
    });
    return iterator.next().toDate();
  }

  static isValid(expression: string): boolean {
    try {
      CronExpressionParser.parse(expression);
      return true;
    } catch {
      return false;
    }
  }

  /** Throws a readable error rather than the parser's own, for config boundaries. */
  static assertValid(expression: string): void {
    if (!Cron.isValid(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
  }
}
