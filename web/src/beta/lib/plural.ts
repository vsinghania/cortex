export class Plural {
  static count(n: number, noun: string): string {
    return `${n} ${n === 1 ? noun : `${noun}s`}`;
  }
}
