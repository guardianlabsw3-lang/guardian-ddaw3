import { v7 as uuidv7 } from 'uuid';
import type { IdGenerator } from '../../application/ports/index.js';

/** `IdGenerator` using UUID v7 (time-ordered) so primary keys sort by creation time. */
export class UuidV7IdGenerator implements IdGenerator {
  uuid(): string {
    return uuidv7();
  }
}
