export class DateFormat {
  private static readonly MS_PER_MINUTE = 60_000;
  private static readonly MINUTES_PER_HOUR = 60;
  private static readonly HOURS_PER_DAY = 24;
  private static readonly RELATIVE_DAYS_LIMIT = 7;

  /** "Sep 12" this year, "Sep 12, 2025" otherwise. */
  static short(iso: string): string {
    const date = new Date(iso);
    const is_this_year = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: is_this_year ? undefined : 'numeric',
    });
  }

  static full(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Compact age for recent timestamps ("5m ago"), falling back to a short date after a week. */
  static relative(iso: string): string {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / DateFormat.MS_PER_MINUTE);
    if (minutes < 1) return 'just now';
    if (minutes < DateFormat.MINUTES_PER_HOUR) return `${minutes}m ago`;

    const hours = Math.floor(minutes / DateFormat.MINUTES_PER_HOUR);
    if (hours < DateFormat.HOURS_PER_DAY) return `${hours}h ago`;

    const days = Math.floor(hours / DateFormat.HOURS_PER_DAY);
    if (days < DateFormat.RELATIVE_DAYS_LIMIT) return `${days}d ago`;

    return DateFormat.short(iso);
  }
}
