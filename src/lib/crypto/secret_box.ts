import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * The context a ciphertext is bound to. Passed to GCM as additional authenticated
 * data: not encrypted, but covered by the auth tag, so a value lifted out of one
 * row cannot be pasted into another and still open.
 */
export type SecretAad = {
  user_id: string;
  field: string;
};

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PART_SEPARATOR = '.';
/** Excludes the separator, so a key id can never split a sealed value wrongly. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const KEYS_ENV = 'SECRET_ENCRYPTION_KEYS';
const ACTIVE_KEY_ID_ENV = 'SECRET_ENCRYPTION_ACTIVE_KEY_ID';

/**
 * Reversible field-level encryption for secrets we have to replay rather than
 * verify - an OAuth token cache today, note bodies later. Hashing (TokenUtils,
 * bcrypt) is the right tool everywhere we only need to compare.
 *
 * Every ciphertext names the key that sealed it and several keys load at once, so
 * rotating one is a background re-seal sweep rather than a big-bang migration.
 *
 * Sealed form: `<key_id>.<iv>.<auth_tag>.<ciphertext>`, each part base64url.
 */
export class SecretBox {
  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    private readonly active_key_id: string
  ) {}

  /** Whether the env carries enough to build one; features gate on this. */
  static isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env[KEYS_ENV]?.trim()) && Boolean(env[ACTIVE_KEY_ID_ENV]?.trim());
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox {
    const keys = SecretBox.parseKeys(env[KEYS_ENV] ?? '');
    const active_key_id = (env[ACTIVE_KEY_ID_ENV] ?? '').trim();

    if (keys.size === 0) {
      throw new Error(`${KEYS_ENV} is not set; encryption cannot start`);
    }
    if (!active_key_id) {
      throw new Error(`${ACTIVE_KEY_ID_ENV} is not set; nothing would know which key to write with`);
    }
    if (!keys.has(active_key_id)) {
      throw new Error(`${ACTIVE_KEY_ID_ENV} names "${active_key_id}", which is not among the keys in ${KEYS_ENV}`);
    }
    return new SecretBox(keys, active_key_id);
  }

  seal(plaintext: string, aad: SecretAad): string {
    const key = this.keys.get(this.active_key_id);
    if (!key) {
      throw new Error(`Active key "${this.active_key_id}" is missing`);
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(SecretBox.encodeAad(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      this.active_key_id,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url')
    ].join(PART_SEPARATOR);
  }

  /**
   * Throws on a wrong key, wrong context or tampered bytes alike - the auth tag
   * cannot tell them apart, and none of them should ever fall back to plaintext.
   */
  open(sealed: string, aad: SecretAad): string {
    const parts = sealed.split(PART_SEPARATOR);
    if (parts.length !== 4) {
      throw new Error('Sealed value is malformed');
    }

    const [key_id, iv_part, auth_tag_part, ciphertext_part] = parts;
    const key = this.keys.get(key_id);
    if (!key) {
      throw new Error(`No key with id "${key_id}" is loaded; it may have been retired too early`);
    }

    const iv = Buffer.from(iv_part, 'base64url');
    const auth_tag = Buffer.from(auth_tag_part, 'base64url');
    if (iv.length !== IV_BYTES || auth_tag.length !== AUTH_TAG_BYTES) {
      throw new Error('Sealed value is malformed');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(SecretBox.encodeAad(aad));
    decipher.setAuthTag(auth_tag);

    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext_part, 'base64url')),
        decipher.final()
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Deliberately says nothing about the value itself.
      throw new Error('Sealed value failed authentication: wrong key, wrong context, or tampered data');
    }
  }

  /**
   * Length-prefixed rather than delimiter-joined, so no pair of (user_id, field)
   * values can encode to the same bytes as a different pair.
   */
  private static encodeAad(aad: SecretAad): Buffer {
    return Buffer.from(`${aad.user_id.length}:${aad.user_id}${aad.field.length}:${aad.field}`, 'utf8');
  }

  /** Parses `<key_id>:<base64 key>` entries, comma-separated. */
  private static parseKeys(raw: string): Map<string, Buffer> {
    const keys = new Map<string, Buffer>();

    for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
      const separator_at = entry.indexOf(':');
      if (separator_at <= 0) {
        throw new Error(`${KEYS_ENV} entries must be "<key_id>:<base64 key>"`);
      }

      const key_id = entry.slice(0, separator_at);
      if (!KEY_ID_PATTERN.test(key_id)) {
        throw new Error(`Key id "${key_id}" must match ${KEY_ID_PATTERN}`);
      }
      if (keys.has(key_id)) {
        throw new Error(`Key id "${key_id}" appears twice in ${KEYS_ENV}`);
      }

      const key = Buffer.from(entry.slice(separator_at + 1), 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error(`Key "${key_id}" must decode to ${KEY_BYTES} bytes, got ${key.length}`);
      }

      keys.set(key_id, key);
    }

    return keys;
  }
}
