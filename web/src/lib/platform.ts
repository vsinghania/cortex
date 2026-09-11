export class Platform {
  private static readonly APPLE_PATTERN = /Mac|iPhone|iPad|iPod/;

  static modifierKeyLabel(): string {
    return Platform.APPLE_PATTERN.test(navigator.userAgent) ? '⌘' : 'Ctrl';
  }
}
