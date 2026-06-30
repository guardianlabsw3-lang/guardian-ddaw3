/**
 * `IdGenerator` port — produces aggregate identifiers. Implementations use UUID v7
 * (time-ordered, spec 09) so primary keys sort by creation time.
 */
export interface IdGenerator {
  uuid(): string;
}
