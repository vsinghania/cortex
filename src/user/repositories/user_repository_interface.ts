import type { AdminUserRecord, CreateUserInput, ListUsersParams, UpdateUserPatch, User } from '../types/user.types.js';

export interface UserRepository {
  createUser(input: CreateUserInput & { user_id: string }): Promise<User>;
  findByUserId(user_id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByGoogleSub(google_sub: string): Promise<User | null>;
  updateByUserId(user_id: string, patch: UpdateUserPatch): Promise<User | null>;
  setLastLoginAt(user_id: string, at: Date): Promise<User | null>;
  /** Kept off UpdateUserPatch so proof-of-ownership cannot be set through a generic patch. */
  setEmailVerifiedAt(user_id: string, at: Date): Promise<User | null>;
  /** Kept off UpdateUserPatch for the same reason: it grants a way to sign in. */
  linkGoogleAccount(user_id: string, google_sub: string): Promise<User | null>;
  /** For a password set by someone who never proved they own the address. */
  removePassword(user_id: string): Promise<User | null>;

  /** Admin-only, and the one read path across users: newest sign-ups first. */
  listUsers(params: ListUsersParams): Promise<AdminUserRecord[]>;
  countUsers(): Promise<number>;
}
