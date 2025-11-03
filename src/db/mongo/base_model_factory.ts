import type { Connection, Model, Schema } from 'mongoose';

export abstract class BaseModelFactory<T> {
  private cache = new WeakMap<Connection, Model<T>>();

  protected abstract buildSchema(): Schema<T>;
  protected abstract getModelName(): string;

  getModel(conn: Connection): Model<T> {
    const existing = this.cache.get(conn);
    if (existing) return existing;
    const schema = this.buildSchema();
    const model = conn.model<T>(this.getModelName(), schema);
    this.cache.set(conn, model);
    return model;
  }
}
