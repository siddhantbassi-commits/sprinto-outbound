import { describe, expect, it } from "vitest";
import { newDb } from "./harness";

describe("migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const db = await newDb();
    const tables = await db.admin<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' order by 1");
    expect(tables.length).toBeGreaterThanOrEqual(19);
  });
});
