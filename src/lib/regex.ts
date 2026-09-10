export class Regex {

  private static readonly METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

  static escape(value: string): string {
    return value.replace(Regex.METACHARACTERS, '\\$&');
  }

  /** Anchored, case-insensitive match on the whole string - `c++` matches only `C++`, never `xc++y`. */
  static exactCaseInsensitive(value: string): RegExp {
    return new RegExp(`^${Regex.escape(value)}$`, 'i');
  }
}
