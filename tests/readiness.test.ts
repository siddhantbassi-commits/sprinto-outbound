import { describe, expect, it } from "vitest";
import { buildReadiness, type ReadinessInput } from "@/lib/app/readiness";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const READY: ReadinessInput = { mode: "supabase", testTo: "me@example.com", icpSignedVersion: 1, factsProblems: [], geminiSet: true, gmailSet: true, hunter: { remaining: 20 }, lastTick: new Date(NOW - 60_000).toISOString(), now: NOW, waiting: 0, reserve: 3 };
const item = (i: ReadinessInput, id: string) => buildReadiness(i).items.find((x) => x.id === id)!;

describe("buildReadiness", () => {
  it("is ready when everything required is in place", () => {
    const r = buildReadiness(READY);
    expect(r).toMatchObject({ ready: true, done: r.total });
  });
  it.each([
    ["test", { testTo: null }],
    ["icp", { icpSignedVersion: null }],
    ["facts", { factsProblems: ["No claim about Sprinto has been verified by a person yet."] }],
    ["gemini", { geminiSet: false }],
    ["gmail", { gmailSet: false }],
  ] as [string, Partial<ReadinessInput>][])("is not ready when %s is missing, and says what to do", (id, over) => {
    const r = buildReadiness({ ...READY, ...over });
    expect(r.ready).toBe(false);
    expect(item({ ...READY, ...over }, id)).toMatchObject({ ok: false, href: expect.stringMatching(/^\//), action: expect.any(String) });
    expect(r.done).toBe(r.total - 1);
  });
  it("reports the first facts problem, not all of them", () => expect(item({ ...READY, factsProblems: ["First.", "Second."] }, "facts").detail).toBe("First."));
  it("treats Hunter as optional: missing or failing does not block", () => {
    expect(buildReadiness({ ...READY, hunter: null }).ready).toBe(true);
    expect(item({ ...READY, hunter: { error: "Hunter refused the key" } }, "hunter")).toMatchObject({ ok: false, optional: true, detail: "Hunter refused the key" });
    expect(item({ ...READY, hunter: { remaining: 4 } }, "hunter").detail).toMatch(/4 credits left, 3 kept in reserve/);
  });
  it("does not need Gemini or Gmail keys in demo mode", () => expect(buildReadiness({ ...READY, mode: "demo", geminiSet: false, gmailSet: false }).ready).toBe(true));
  it("calls a quiet worker a fault only when companies are waiting", () => {
    const old = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(buildReadiness({ ...READY, lastTick: old, waiting: 0 }).ready).toBe(true);
    const stuck = buildReadiness({ ...READY, lastTick: old, waiting: 4 });
    expect(stuck.ready).toBe(false);
    expect(item({ ...READY, lastTick: old, waiting: 4 }, "worker")).toMatchObject({ ok: false, optional: false });
    expect(item({ ...READY, lastTick: null, waiting: 2 }, "worker").detail).toMatch(/never run/);
  });
  it("counts the worker only when it is required", () => {
    expect(buildReadiness({ ...READY, waiting: 0 }).total).toBe(5);
    expect(buildReadiness({ ...READY, waiting: 3 }).total).toBe(6);
  });
  it("an hour is the line: just inside is running, just outside is not", () => {
    expect(item({ ...READY, waiting: 1, lastTick: new Date(NOW - 3_599_000).toISOString() }, "worker").ok).toBe(true);
    expect(item({ ...READY, waiting: 1, lastTick: new Date(NOW - 3_601_000).toISOString() }, "worker").ok).toBe(false);
  });
});
