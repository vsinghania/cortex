import type { User } from './auth.types';
import { NoteTagCache } from './note_tag_cache';

type Listener = () => void;

export class AuthStore {
  private static _instance: AuthStore | null = null;

  private access_token: string | null = null;
  private user: User | null = null;
  private listeners: Set<Listener> = new Set();

  static instance(): AuthStore {
    if (!AuthStore._instance) {
      AuthStore._instance = new AuthStore();
    }
    return AuthStore._instance;
  }

  getToken(): string | null {
    return this.access_token;
  }

  getUser(): User | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return this.user !== null;
  }

  setSession(token: string, user: User): void {
    NoteTagCache.instance.invalidate();
    this.access_token = token;
    this.user = user;
    this.notify();
  }

  setToken(token: string): void {
    this.access_token = token;
    this.notify();
  }

  setUser(user: User): void {
    if (user.user_id !== this.user?.user_id) NoteTagCache.instance.invalidate();
    this.user = user;
    this.notify();
  }

  clear(): void {
    NoteTagCache.instance.invalidate();
    this.access_token = null;
    this.user = null;
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}
