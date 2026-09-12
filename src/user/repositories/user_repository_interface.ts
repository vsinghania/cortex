import type { CreateUserInput, UpdateUserPatch, User } from '../types/user.types.js';

export interface UserRepository {
  createUser(input: CreateUserInput & { user_id: string }): Promise<User>;
  findByUserId(user_id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  updateByUserId(user_id: string, patch: UpdateUserPatch): Promise<User | null>;
  setLastLoginAt(user_id: string, at: Date): Promise<User | null>;
  /** Kept off UpdateUserPatch so proof-of-ownership cannot be set through a generic patch. */
  setEmailVerifiedAt(user_id: string, at: Date): Promise<User | null>;
}
