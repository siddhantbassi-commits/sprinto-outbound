import { describe, expect, it } from "vitest";
import { INTRO_COOKIE, safeDestination, wantsIntro, type IntroRequest } from "@/lib/app/enter";

const base: IntroRequest = { mode: "demo", method: "GET", hasCookie: false, accept: "text/html,application/xhtml+xml", path: "/" };

describe("where the welcome leads", () => {
  it("goes to a page inside the app, with its query", () => {
    expect(safeDestination("/")).toBe("/");
    expect(safeDestination("/leads?view=board&q=north")).toBe("/leads?view=board&q=north");
    expect(safeDestination("/prospects/abc/brief")).toBe("/prospects/abc/brief");
  });

  it("will not lead to another site, however it is written", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "http://evil.example/x", "javascript:alert(1)", "evil.example", "\\\\evil", "/%0d%0aX:1".replace("%0d%0a", "\r\n")]) expect(safeDestination(bad), bad).toBe("/");
  });

  it("will not loop back to itself or into the API, the sign-in page or the auth routes", () => {
    for (const p of ["/enter", "/enter?to=/", "/api/demo/warm", "/login", "/auth/callback"]) expect(safeDestination(p), p).toBe("/");
    expect(safeDestination("/entering-room")).toBe("/entering-room");
  });

  it("falls back to the home page for nothing, a blank, or something absurdly long", () => {
    expect(safeDestination(null)).toBe("/");
    expect(safeDestination(undefined)).toBe("/");
    expect(safeDestination("   ")).toBe("/");
    expect(safeDestination(`/${"a".repeat(400)}`)).toBe("/");
  });
});

describe("when the welcome is shown", () => {
  it("shows it to someone opening a page in the demo for the first time", () => {
    expect(wantsIntro(base)).toBe(true);
    expect(wantsIntro({ ...base, path: "/leads" })).toBe(true);
  });

  it("shows it once: not again once the visitor has the cookie", () => {
    expect(wantsIntro({ ...base, hasCookie: true })).toBe(false);
    expect(INTRO_COOKIE).toBe("sprinto_intro");
  });

  it("never in the real product", () => {
    expect(wantsIntro({ ...base, mode: "supabase" })).toBe(false);
  });

  it("not for an action, an API call, a prefetch or a file", () => {
    expect(wantsIntro({ ...base, method: "POST" })).toBe(false);
    expect(wantsIntro({ ...base, accept: "text/x-component" })).toBe(false);
    expect(wantsIntro({ ...base, accept: "application/json" })).toBe(false);
    expect(wantsIntro({ ...base, accept: "*/*" })).toBe(false);
  });

  it("not for the welcome itself, the API, or the sign-in and auth routes", () => {
    for (const path of ["/enter", "/api/demo/warm", "/api/runs/status", "/login", "/auth/signout", "/privacy"]) expect(wantsIntro({ ...base, path }), path).toBe(false);
  });
});
