export interface Change {
  key: string;
  value: unknown | null;
}
export interface Storage {
  get<T>(key: string): Promise<T | null>;
  list<T>(prefix: string): Promise<T[]>;
  /** Enumerate cache keys without decoding their potentially large payloads. */
  keys?(prefix: string): Promise<string[]>;
  batch(changes: Change[]): Promise<void>;
}
