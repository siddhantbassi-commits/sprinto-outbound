import { describe, expect, it } from "vitest";
import { GUEST_MAX_PER_RUN, guestMay, guestMayPay, promoteSql, startOfUtcDay, sumUsage, type GuestCaps, type GuestUsage } from "@/lib/app/guest";
import { wantsIntro } from "@/lib/app/enter";
import { realCredentials, readEnv } from "@/lib/env";

const CAPS: GuestCaps = { dailyTokens: 400_000, dailyHunter: 6, dailyCompanies: 25, keepCredits: 15 };
const FRESH: GuestUsage = { tokensToday: 0, hunterToday: 0, companiesToday: 0, hunterRemaining: 40 };
const msg = (v: ReturnType<typeof guestMay>) => (v.ok ? "" : v.message);

describe("what a guest may start", () => {
  it("lets a normal run through", () => {
    expect(guestMay(3, FRESH, CAPS)).toEqual({ ok: true });
    expect(guestMay(GUEST_MAX_PER_RUN, FRESH, CAPS)).toEqual({ ok: true });
  });

  it("refuses an empty run and one that is too big, saying what to do", () => {
    expect(msg(guestMay(0, FRESH, CAPS))).toMatch(/at least one/);
    expect(msg(guestMay(GUEST_MAX_PER_RUN + 1, FRESH, CAPS))).toMatch(/up to 5 companies.*second run/);
  });

  it("stops when the day's companies are used up, counting the new ones, and says the research stays readable", () => {
    expect(guestMay(5, { ...FRESH, companiesToday: 20 }, CAPS)).toEqual({ ok: true });
    const v = guestMay(5, { ...FRESH, companiesToday: 21 }, CAPS);
    expect(msg(v)).toMatch(/researched companies for today is used up.*tomorrow.*still open to read/);
  });

  it("stops when the day's model time is used up", () => {
    expect(msg(guestMay(1, { ...FRESH, tokensToday: 400_000 }, CAPS))).toMatch(/model time/);
    expect(guestMay(1, { ...FRESH, tokensToday: 399_999 }, CAPS)).toEqual({ ok: true });
  });

  it("never touches the credits kept for the owner, and stops at the daily lookup cap", () => {
    expect(msg(guestMay(1, { ...FRESH, hunterRemaining: 15 }, CAPS))).toMatch(/kept for guests are used up/);
    expect(guestMay(1, { ...FRESH, hunterRemaining: 16 }, CAPS)).toEqual({ ok: true });
    expect(msg(guestMay(1, { ...FRESH, hunterToday: 6 }, CAPS))).toMatch(/contact lookups for today/);
    expect(guestMay(1, { ...FRESH, hunterToday: 5 }, CAPS)).toEqual({ ok: true });
  });

  it("does not block on an unknown Hunter balance, because the other caps still hold", () => {
    expect(guestMay(1, { ...FRESH, hunterRemaining: null }, CAPS)).toEqual({ ok: true });
  });

  it("applies the same credit rules to the paid address check", () => {
    expect(guestMayPay(FRESH, CAPS)).toEqual({ ok: true });
    expect(guestMayPay({ ...FRESH, hunterRemaining: 10 }, CAPS).ok).toBe(false);
    expect(guestMayPay({ ...FRESH, hunterToday: 6 }, CAPS).ok).toBe(false);
  });
});

describe("counting today's usage from the records", () => {
  const NOW = Date.UTC(2026, 10, 18, 15);
  const at = (h: number) => new Date(Date.UTC(2026, 10, 18, h)).toISOString();
  const yesterday = new Date(Date.UTC(2026, 10, 17, 23, 59)).toISOString();

  it("adds only today's rows, by kind, and ignores yesterday and the other kinds", () => {
    const ledger = [
      { kind: "gemini_tokens", units: 1000, created_at: at(1) },
      { kind: "gemini_tokens", units: 2500, created_at: at(14) },
      { kind: "gemini_tokens", units: 99_999, created_at: yesterday },
      { kind: "hunter_credits", units: 1, created_at: at(2) },
      { kind: "hunter_credits", units: 1, created_at: at(3) },
      { kind: "hunter_credits", units: 7, created_at: yesterday },
      { kind: "gmail_send", units: 1, created_at: at(4) },
    ];
    expect(sumUsage(ledger, [], "g", NOW)).toMatchObject({ tokensToday: 3500, hunterToday: 2 });
  });

  it("counts companies only from the guest's own runs today", () => {
    const runs = [
      { created_by: "g", domain_count: 3, created_at: at(5) },
      { created_by: "g", domain_count: 2, created_at: at(9) },
      { created_by: "owner", domain_count: 10, created_at: at(9) },
      { created_by: "g", domain_count: 4, created_at: yesterday },
    ];
    expect(sumUsage([], runs, "g", NOW).companiesToday).toBe(5);
  });

  it("starts the day at midnight UTC", () => {
    expect(new Date(startOfUtcDay(NOW)).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });
});

describe("the guest pass in the environment", () => {
  const REAL = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", GUEST_PASS: "1", GUEST_EMAIL: " guest@example.org ", GUEST_PASSWORD: "pw-secret" };

  it("is on only when asked for and fully set, with the default caps", () => {
    const e = readEnv(REAL);
    expect(e.guest).toEqual({ email: "guest@example.org", password: "pw-secret", dailyTokens: 400_000, dailyHunter: 6, dailyCompanies: 25, keepCredits: 15 });
    expect(readEnv({ ...REAL, GUEST_PASS: "" }).guest).toBeNull();
    expect(readEnv({ ...REAL, GUEST_PASS: "0" }).guest).toBeNull();
  });

  it("says plainly what is missing, never the password", () => {
    const e = readEnv({ ...REAL, GUEST_PASSWORD: "" });
    expect(e.guest).toBeNull();
    expect(e.problems.join(" ")).toMatch(/GUEST_EMAIL and GUEST_PASSWORD are not/);
    expect(readEnv({ ...REAL, GUEST_EMAIL: "" }).guest).toBeNull();
  });

  it("reads the caps from the environment and ignores nonsense", () => {
    const e = readEnv({ ...REAL, GUEST_DAILY_TOKENS: "900000", GUEST_DAILY_HUNTER: "2", GUEST_DAILY_COMPANIES: "10", GUEST_KEEP_CREDITS: "20" });
    expect(e.guest).toMatchObject({ dailyTokens: 900_000, dailyHunter: 2, dailyCompanies: 10, keepCredits: 20 });
    expect(readEnv({ ...REAL, GUEST_DAILY_TOKENS: "5", GUEST_DAILY_HUNTER: "-1", GUEST_DAILY_COMPANIES: "0", GUEST_KEEP_CREDITS: "x" }).guest).toMatchObject({ dailyTokens: 400_000, dailyHunter: 6, dailyCompanies: 25, keepCredits: 15 });
  });

  it("applies only to the real app, never to a demo", () => {
    const e = readEnv({ DEMO_MODE: "1", GUEST_PASS: "1", GUEST_EMAIL: "g@x.org", GUEST_PASSWORD: "pw" });
    expect(e.mode).toBe("demo");
    expect(e.guest).toBeNull();
    expect(e.problems.join(" ")).toMatch(/only applies to the real app/);
  });

  it("counts the guest account as a real credential, so a public demo refuses to hold it", () => {
    expect(realCredentials({ GUEST_EMAIL: "g@x.org", GUEST_PASSWORD: "pw" })).toEqual(["GUEST_EMAIL", "GUEST_PASSWORD"]);
    expect(readEnv({ DEMO_MODE: "1", DEMO_PUBLIC: "1", VERCEL_ENV: "production", GUEST_PASSWORD: "pw" }).mode).toBe("supabase");
  });
});

describe("the welcome for a guest", () => {
  const base = { method: "GET", hasCookie: false, accept: "text/html,application/xhtml+xml", path: "/leads" };

  it("greets a first-time guest opening a page, once", () => {
    expect(wantsIntro({ ...base, mode: "guest" })).toBe(true);
    expect(wantsIntro({ ...base, mode: "guest", hasCookie: true })).toBe(false);
  });

  it("never greets an action, an API call, a prefetch or the sign-in page, and never a signed-in owner", () => {
    expect(wantsIntro({ ...base, mode: "guest", method: "POST" })).toBe(false);
    expect(wantsIntro({ ...base, mode: "guest", accept: "*/*" })).toBe(false);
    expect(wantsIntro({ ...base, mode: "guest", path: "/api/runs/advance" })).toBe(false);
    expect(wantsIntro({ ...base, mode: "guest", path: "/login" })).toBe(false);
    expect(wantsIntro({ ...base, mode: "supabase" })).toBe(false);
  });
});

describe("the line that makes the guest an admin", () => {
  it("is printed only for a plain email address, with quotes made safe", () => {
    expect(promoteSql(" guest@example.org ")).toBe("update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'guest@example.org');");
    expect(promoteSql("o'brien@example.org")).toBeNull();
    expect(promoteSql("x'; drop table profiles; --@example.org")).toBeNull();
    expect(promoteSql("not an email")).toBeNull();
    expect(promoteSql("")).toBeNull();
  });
});
