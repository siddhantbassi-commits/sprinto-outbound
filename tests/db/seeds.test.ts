import { describe, expect, it } from "vitest";
import { ICP_V1 } from "@/lib/icp/config";
import { SPRINTO_FACTS_SEED } from "@/lib/pitch/sprinto-facts";
import { normaliseDomain } from "@/lib/scrape/url-guard";
import { newDb } from "./harness";

describe("the seed rows match the code", () => {
  it("seeds icp_versions with exactly ICP_V1, so the file and the code cannot drift", async () => {
    const db = await newDb();
    const [row] = await db.admin<{ config: unknown; blocklist: unknown }>("select config, blocklist from public.icp_versions order by version limit 1");
    expect(row!.config).toEqual(JSON.parse(JSON.stringify(ICP_V1)));
    expect(row!.blocklist).toEqual({ domains: [] });
  });

  it("seeds the Sprinto facts file with the unverified seed, so nothing can draft until a person verifies it", async () => {
    const db = await newDb();
    const [row] = await db.admin<{ content: unknown }>("select content from public.sprinto_facts_versions order by version limit 1");
    expect(row!.content).toEqual(JSON.parse(JSON.stringify(SPRINTO_FACTS_SEED)));
  });

  it("starts with test mode unset, so the first send is refused until an admin sets the address", async () => {
    const db = await newDb();
    const [s] = await db.admin<{ test_to: string | null; daily_send_cap: number; max_parallel: number; hunter_reserve: number; tokens_per_domain: number; tokens_per_run: number }>("select * from public.settings_versions order by version limit 1");
    expect(s).toMatchObject({ test_to: null, daily_send_cap: 20, max_parallel: 3, hunter_reserve: 3, tokens_per_domain: 60000, tokens_per_run: 400000, minutes_saved_per_email: "20", review_minutes_per_email: "1.5", review_minutes_per_decision: "2" });
  });

  it("has no signed-off ICP to begin with", async () => {
    const db = await newDb();
    expect(await db.admin("select * from public.icp_signoffs")).toEqual([]);
  });
});

describe("is_valid_domain agrees with the TypeScript normaliser", () => {
  const INPUTS = [
    "acme.com", "WWW.Acme.COM", "https://acme.com/path", "sub.domain.acme.co.uk", "xn--bcher-kva.example.com", "münchen.de", "a-b.io", "acme.com.",
    "10.0.0.1", "127.0.0.1", "[::1]", "localhost", "intranet.corp", "service.internal", "x.test", "acme", "ac me.com", "-acme.com", "acme-.com",
    "acme..com", "", "ftp://acme.com", "a.b", "1.2.3.4.5", "acme.123", "acme.c", "user@acme.com", "acme.com:8080",
  ];

  it("never accepts, in the database, a domain the normaliser would turn away, and accepts what it produces", async () => {
    const db = await newDb();
    for (const input of INPUTS) {
      const r = normaliseDomain(input);
      const [v] = await db.admin<{ ok: boolean }>("select public.is_valid_domain($1) ok", [r.ok ? r.domain : input.toLowerCase()]);
      if (r.ok) expect(v!.ok, `${input} -> ${r.domain}`).toBe(true);
      else expect(v!.ok, `${input} (${r.reason})`).toBe(false);
    }
  });
});

describe("the Postgres port reads columns and pages", () => {
  it("returns only the requested columns and honours order, limit and offset", async () => {
    const { world } = await import("./world");
    const { pgPort } = await import("@/lib/db/pg-port");
    const w = await world();
    await w.startRun(["a.com", "b.com", "c.com", "d.com"]);
    const db = pgPort(w.s.viewer);
    const rows = await db.select("prospects", {}, { columns: "domain, lane", order: "domain", limit: 2, offset: 1 });
    expect(rows).toEqual([{ domain: "b.com", lane: "active" }, { domain: "c.com", lane: "active" }]);
    await expect(db.select("prospects", {}, { columns: "domain; drop table runs" })).rejects.toThrow(/Bad column list/);
  });
});
