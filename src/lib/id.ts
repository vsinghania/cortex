import { nanoid } from 'nanoid';
import { v7 as uuidv7 } from 'uuid';

export class Id {
  static generateRandom(length?: number): string {
    return length ? nanoid(length) : nanoid();
  }

  static generateUuidV7(): string {
    return uuidv7();
  }
}
