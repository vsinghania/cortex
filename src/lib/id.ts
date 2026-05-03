import { nanoid } from 'nanoid';

export class Id {
  static generate(length?: number): string {
    return length ? nanoid(length) : nanoid();
  }
}
