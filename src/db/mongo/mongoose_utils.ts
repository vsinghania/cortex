export class MongooseUtils {
  private constructor() {}

  /**
   * Safely convert a Mongoose document or plain object to a typed domain object.
   * - If the object has a toJSON function, it will be used.
   * - Otherwise, the object is returned as-is, typed as T.
   */
  public static toDomain<T>(doc: any): T {
    const obj = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc;
    return obj as T;
  }
}
