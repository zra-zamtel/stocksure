// The app targets React Native, so @types/node is not installed. The tests run
// in Node and use two built-ins; these are the only parts of them they need.

declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;

  export class StatementSync {
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
    all(...params: SQLInputValue[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:crypto' {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
  export function randomBytes(size: number): Uint8Array;
}
