import { describe, expect, it } from "vitest";
import { GUEST_DAILY_ASKS, GUEST_MAX_RESUMES, GUEST_PINNED, GUEST_MAX_PER_RUN, countToday, createFlight, createSerial, guestCooldown, guestMay, guestMayAsk, guestMayResume, pinGuestSettings, guestMayPay, promoteSql, startOfUtcDay, sumUsage, type GuestCaps, type GuestUsage } from "@/lib/app/guest";
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

  it("never lets a run dip below the credits kept for the owner, and says how many it can take", () => {
    expect(guestMay(3, { ...FRESH, hunterRemaining: 18 }, CAPS)).toEqual({ ok: true });
    const v = guestMay(4, { ...FRESH, hunterRemaining: 18 }, CAPS);
    expect(msg(v)).toMatch(/only 3 credits to spare.*at most 3 companies/);
    expect(msg(guestMay(2, { ...FRESH, hunterRemaining: 16 }, CAPS))).toMatch(/only 1 credit to spare.*at most 1 company\./);
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

describe("actions a guest may repeat only after a pause", () => {
  const NOW = Date.UTC(2026, 10, 19, 10, 0);
  const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

  it("allows the first run, and a run after the window", () => {
    expect(guestCooldown(null, NOW, 60, "The digest")).toEqual({ ok: true });
    expect(guestCooldown(undefined, NOW, 60, "The digest")).toEqual({ ok: true });
    expect(guestCooldown(ago(60), NOW, 60, "The digest")).toEqual({ ok: true });
    expect(guestCooldown(ago(61), NOW, 60, "The digest")).toEqual({ ok: true });
  });

  it("refuses inside the window, saying how long to wait, and that the last result is still there", () => {
    const g = guestCooldown(ago(20), NOW, 60, "The digest");
    expect(g).toMatchObject({ ok: false, waitMinutes: 40 });
    expect((g as { message: string }).message).toMatch(/The digest was run recently.*once every 60 minutes.*about 40 minutes.*still on the page/);
  });

  it("speaks in hours for long windows, and counts a single minute properly", () => {
    const long = guestCooldown(ago(30), NOW, 360, "The golden set") as { ok: false; message: string };
    expect(long.message).toMatch(/once every 6 hours.*about 6 hours/);
    expect((guestCooldown(new Date(NOW - 59 * 60_000 - 30_000).toISOString(), NOW, 60, "x") as { message: string }).message).toMatch(/about 1 minute\./);
  });

  it("does not block on an unreadable date", () => {
    expect(guestCooldown("not a date", NOW, 60, "x")).toEqual({ ok: true });
  });
});

describe("the settings a guest cannot change", () => {
  const prev = { test_to: "owner@example.org", daily_send_cap: 20, max_run_size: 50, max_parallel: 3, hunter_reserve: 15, tokens_per_domain: 60000, tokens_per_run: 400000, mail_cooldown_days: 30, require_approval: true, sender_name: "Siddhant", postal_address: "1 Old St, Mumbai 400001", minutes_saved_per_email: 20 };

  it("puts every spend-and-send value back to the owner's, whatever the form says", () => {
    const attack = { ...prev, test_to: null, daily_send_cap: 200, max_run_size: 500, max_parallel: 10, hunter_reserve: 0, tokens_per_domain: 1e9, tokens_per_run: 1e9, mail_cooldown_days: 0, require_approval: false };
    const out = pinGuestSettings(attack, prev);
    for (const k of GUEST_PINNED) expect(out[k], k).toEqual(prev[k as keyof typeof prev]);
  });

  it("lets a guest change the rest, such as the sender, the address in the opt-out line and the time-saved figures", () => {
    const out = pinGuestSettings({ ...prev, sender_name: "Alex", postal_address: "9 New Rd, Pune 411001", minutes_saved_per_email: 30, hunter_reserve: 0 }, prev);
    expect(out).toMatchObject({ sender_name: "Alex", postal_address: "9 New Rd, Pune 411001", minutes_saved_per_email: 30, hunter_reserve: 15 });
  });

  it("covers every setting that governs spend, volume, mail routing and approval", () => {
    expect([...GUEST_PINNED].sort()).toEqual(["daily_send_cap", "hunter_reserve", "mail_cooldown_days", "max_parallel", "max_run_size", "require_approval", "test_to", "tokens_per_domain", "tokens_per_run"]);
  });

  it("forces approval on when there is no previous version to copy, and does not mutate its input", () => {
    const input = { require_approval: false, hunter_reserve: 0 };
    expect(pinGuestSettings(input, null)).toMatchObject({ require_approval: true, hunter_reserve: 0 });
    expect(input.require_approval).toBe(false);
  });
});

describe("how many times a guest may re-run or promote", () => {
  const CAPS = { dailyTokens: 400_000, dailyHunter: 6, dailyCompanies: 25, keepCredits: 15 };
  const FRESH = { tokensToday: 0, hunterToday: 0, companiesToday: 0, hunterRemaining: 40 };

  it("allows it within the day's limits", () => {
    expect(guestMayResume(FRESH, CAPS, 0)).toEqual({ ok: true });
    expect(guestMayResume(FRESH, CAPS, GUEST_MAX_RESUMES - 1)).toEqual({ ok: true });
  });

  it("stops at the daily number, when model time is gone, and when the credits kept for the owner are reached", () => {
    expect((guestMayResume(FRESH, CAPS, GUEST_MAX_RESUMES) as { message: string }).message).toMatch(/back in the queue a day/);
    expect((guestMayResume({ ...FRESH, tokensToday: 400_000 }, CAPS, 0) as { message: string }).message).toMatch(/model time/);
    expect(guestMayResume({ ...FRESH, hunterRemaining: 15 }, CAPS, 0).ok).toBe(false);
    expect(guestMayResume({ ...FRESH, hunterToday: 6 }, CAPS, 0).ok).toBe(false);
  });
});

describe("questions a guest may ask", () => {
  it("allows them until the daily number, then says when it starts again", () => {
    expect(guestMayAsk(0)).toEqual({ ok: true });
    expect(guestMayAsk(GUEST_DAILY_ASKS - 1)).toEqual({ ok: true });
    expect((guestMayAsk(GUEST_DAILY_ASKS) as { message: string }).message).toMatch(/20 questions a day.*tomorrow/);
    expect(guestMayAsk(3, 3).ok).toBe(false);
  });
});

describe("counting a guest's own rows today", () => {
  const NOW = Date.UTC(2026, 10, 19, 15);
  const at = (h: number) => new Date(Date.UTC(2026, 10, 19, h)).toISOString();
  const rows = [
    { created_by: "g", created_at: at(2), kind: "rerun" }, { created_by: "g", created_at: at(3), kind: "promote" }, { created_by: "g", created_at: at(4), kind: "pause_run" },
    { created_by: "owner", created_at: at(5), kind: "rerun" }, { created_by: "g", created_at: new Date(Date.UTC(2026, 10, 18, 23)).toISOString(), kind: "rerun" },
  ];
  it("counts only this person's rows from today, optionally of certain kinds", () => {
    expect(countToday(rows, "g", NOW)).toBe(3);
    expect(countToday(rows, "g", NOW, ["rerun", "promote"])).toBe(2);
    expect(countToday(rows, "nobody", NOW)).toBe(0);
  });
});

describe("two requests at the same instant", () => {
  it("runs the same key one after another, so a cap read before a write cannot be passed twice", async () => {
    const serial = createSerial();
    const order: string[] = [];
    const slow = (name: string, ms: number) => serial("k", async () => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}:end`); return name; });
    const out = await Promise.all([slow("a", 20), slow("b", 1), slow("c", 1)]);
    expect(out).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("lets different keys run together, and carries on after one fails", async () => {
    const serial = createSerial();
    const t0 = Date.now();
    await Promise.all([serial("x", () => new Promise((r) => setTimeout(r, 30))), serial("y", () => new Promise((r) => setTimeout(r, 30)))]);
    expect(Date.now() - t0).toBeLessThan(55);
    await expect(serial("z", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(serial("z", async () => "ok")).resolves.toBe("ok");
  });

  it("turns a second long action away while one is running, instead of queueing it", async () => {
    const flight = createFlight();
    let release!: () => void;
    const first = flight("digest", () => new Promise<string>((r) => { release = () => r("done"); }));
    await new Promise((r) => setTimeout(r, 5));
    expect(await flight("digest", async () => "never")).toEqual({ busy: true });
    release();
    expect(await first).toEqual({ busy: false, value: "done" });
    expect(await flight("digest", async () => "again")).toEqual({ busy: false, value: "again" });
  });

  it("frees the slot even when the action throws", async () => {
    const flight = createFlight();
    await expect(flight("g", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(await flight("g", async () => 1)).toEqual({ busy: false, value: 1 });
  });
});
