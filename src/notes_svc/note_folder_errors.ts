import { ConflictError } from '../common/errors.js';

export class NoteFolderNameTakenError extends ConflictError {
  constructor(name: string) {
    super(`A folder named "${name}" already exists here`, { details: { name } });
  }
}
