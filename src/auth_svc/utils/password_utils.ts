import bcrypt from 'bcryptjs';

const DEFAULT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

export class PasswordUtils {
  private constructor() {}

  public static async hashPassword(plain: string, rounds: number = DEFAULT_ROUNDS): Promise<string> {
    if (!plain || plain.length < 8) {
      throw new Error('password_too_weak');
    }
    const salt = await bcrypt.genSalt(rounds);
    return bcrypt.hash(plain, salt);
  }

  public static async verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!plain || !hash) return false;
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }
}
