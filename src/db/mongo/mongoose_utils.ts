export class MongooseUtils {
  private static readonly DUPLICATE_KEY_ERROR_CODE = 11000;

  private constructor() {}

  public static isDuplicateKeyError(err: unknown): boolean {
    return !!err && typeof err === 'object' && (err as { code?: number }).code === MongooseUtils.DUPLICATE_KEY_ERROR_CODE;
  }

  public static stripMongoFields(ret: unknown): unknown {
    if (!ret || typeof ret !== 'object') return ret;
    const obj = ret as Record<string, unknown>;
    Reflect.deleteProperty(obj, '_id');
    Reflect.deleteProperty(obj, '__v');
    return obj;
  }

  /**
   * Safely convert a Mongoose document or plain object to a typed domain object.
   * - If the object has a toJSON function, it will be used.
   * - Otherwise, the object is returned as-is, typed as T.
   */
  public static toDomain<T>(doc: unknown): T {
    const obj =
      MongooseUtils.hasToJson(doc) ? doc.toJSON() : doc;
    return MongooseUtils.stripMongoFields(obj) as T;
  }

  private static hasToJson(doc: unknown): doc is { toJSON: () => unknown } {
    return !!doc && typeof doc === 'object' && 'toJSON' in doc && typeof doc.toJSON === 'function';
  }
}
