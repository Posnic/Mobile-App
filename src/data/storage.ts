export interface Change {
  key: string;
  value: unknown | null;
}
export interface Storage {
  get<T>(key: string): Promise<T | null>;
  list<T>(prefix: string): Promise<T[]>;
  batch(changes: Change[]): Promise<void>;
}
