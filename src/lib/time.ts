export class Time {
  static secondsToMs(n: number): number {
    return n * 1000;
  }

  static minutesToMs(n: number): number {
    return n * 60 * 1000;
  }

  static hoursToMs(n: number): number {
    return n * 60 * 60 * 1000;
  }

  static daysToMs(n: number): number {
    return n * 24 * 60 * 60 * 1000;
  }
}
