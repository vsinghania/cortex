import type { Connection, Model } from 'mongoose';
import { type CreateUserInput, type UpdateUserPatch, type User } from '../types/user.types.js';
import { UserModelFactory } from '../models/user_model.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { MongooseUtils } from '../../db/mongo/mongoose_utils.js';
import type { UserRepository as IUserRepository } from './user_repository_interface.js';


export class MongooseUserRepository implements IUserRepository {
  private static readonly factory = new UserModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: Model<User>
  ) {}

  static async create(params: { db: string; host?: string; port?: number }): Promise<IUserRepository> {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseUserRepository(conn, model);
  }

  async createUser(input: CreateUserInput & { user_id: string }): Promise<User> {
    const created = await this.model.create({
      user_id: input.user_id,
      email: input.email,
      password_hash: input.password_hash,
      roles: input.roles ?? ['user']
    });
    return MongooseUtils.toDomain<User>(created);
  }

  async findByUserId(user_id: string): Promise<User | null> {
    const found = await this.model.findOne({ user_id }).lean();
    return found ? (MongooseUtils.toDomain<User>(found) as User) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const found = await this.model.findOne({ email: email.toLowerCase().trim() }).lean();
    return found ? (MongooseUtils.toDomain<User>(found) as User) : null;
  }

  async updateByUserId(user_id: string, patch: UpdateUserPatch): Promise<User | null> {
    const allowed: UpdateUserPatch = {};
    if (patch.password_hash !== undefined) allowed.password_hash = patch.password_hash;
    if (patch.roles !== undefined) allowed.roles = patch.roles;
    if (patch.last_login_at !== undefined) allowed.last_login_at = patch.last_login_at;

    const updated = await this.model.findOneAndUpdate(
      { user_id },
      { $set: allowed },
      { new: true }
    ).lean();

    return updated ? (MongooseUtils.toDomain<User>(updated) as User) : null;
  }

  async setLastLoginAt(user_id: string, at: Date): Promise<User | null> {
    const updated = await this.model.findOneAndUpdate(
      { user_id },
      { $set: { last_login_at: at } },
      { new: true }
    ).lean();
    return updated ? (MongooseUtils.toDomain<User>(updated) as User) : null;
  }
}
