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

  static minutesToSec(n: number): number {
    return n * 60;
  }

  static daysToSec(n: number): number {
    return n * 24 * 60 * 60;
  }

  static msToSec(n: number): number {
    return Math.floor(n / 1000);
  }

  static elapsedMs(start_ms: number): number {
    return Number((performance.now() - start_ms).toFixed(1));
  }
}
