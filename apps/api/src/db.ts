/**
 * The subset of Cloudflare D1 that the API uses. D1Database satisfies it in the Worker; tests use a
 * node:sqlite adapter with the same SQL (test/sqlite-d1.ts).
 */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Db {
  prepare(sql: string): DbStatement;
}
