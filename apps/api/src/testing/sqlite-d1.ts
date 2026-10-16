import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db, DbStatement } from "../db.ts";

/**
 * Test-only: a real in-memory SQLite database behind the D1 subset in db.ts, with every migration from
 * apps/api/migrations applied in order. D1 is SQLite, so the SQL under test is the SQL that ships.
 */
export function createTestDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(`${dir}${file}`, "utf8"));
  }

  // D1 takes BLOBs as ArrayBuffer; node:sqlite wants a typed array.
  const asSqlite = (v: unknown) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);
  const statement = (sql: string, values: unknown[]): DbStatement => ({
    bind: (...next) => statement(sql, next.map(asSqlite)),
    first: async <T>() => (raw.prepare(sql).get(...(values as SQLInputValue[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...(values as SQLInputValue[])) as T[] }),
    run: async () => raw.prepare(sql).run(...(values as SQLInputValue[])),
  });

  return { raw, prepare: (sql) => statement(sql, []) };
}

/** Inserts a site and its users for tests. */
export function seedSite(
  db: { raw: DatabaseSync },
  site: { id: string; name: string; origin: string },
  users: Array<{ email: string; role: "owner" | "editor" }>,
): void {
  db.raw
    .prepare("INSERT INTO sites (id, name, origin, created_at) VALUES (?, ?, ?, 0)")
    .run(site.id, site.name, site.origin);
  for (const u of users) {
    db.raw
      .prepare("INSERT INTO site_users (site_id, email, role, created_at) VALUES (?, ?, ?, 0)")
      .run(site.id, u.email, u.role);
  }
}
