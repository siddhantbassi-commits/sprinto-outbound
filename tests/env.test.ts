import { describe, expect, it } from "vitest";
import { readEnv, realCredentials, sameSecret } from "@/lib/env";

const FULL = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", WORKER_EMAIL: "worker@x.co", WORKER_PASSWORD: "pw",
  CRON_SECRET: "c".repeat(32), GEMINI_API_KEY: "g", HUNTER_API_KEY: "h", GMAIL_CLIENT_ID: "i", GMAIL_CLIENT_SECRET: "s", GMAIL_REFRESH_TOKEN: "r", GMAIL_FROM: "me@x.co", OUTBOUND_TEST_TO: "me@x.co",
};

describe("readEnv", () => {
  it("reads a fully configured environment with no problems", () => {
    const e = readEnv(FULL);
    expect(e.mode).toBe("supabase");
    expect(e.problems).toEqual([]);
    expect(e.gmail).toMatchObject({ from: "me@x.co" });
    expect(e.testTo).toBe("me@x.co");
  });

  it("names every missing piece in plain words", () => {
    const e = readEnv({});
    expect(e.problems).toHaveLength(7);
    expect(e.problems.join(" ")).toMatch(/Supabase is not configured.*worker account.*CRON_SECRET.*GEMINI_API_KEY.*HUNTER_API_KEY.*Gmail.*OUTBOUND_TEST_TO/s);
  });

  it("treats Gmail as configured only when all four parts are present", () => {
    expect(readEnv({ ...FULL, GMAIL_REFRESH_TOKEN: "" }).gmail).toBeNull();
    expect(readEnv({ ...FULL, GMAIL_FROM: undefined }).gmail).toBeNull();
  });

  it("cleans whitespace pasted into keys", () => {
    expect(readEnv({ ...FULL, GEMINI_API_KEY: " ab\ncd " }).gemini?.apiKey).toBe("abcd");
    expect(readEnv({ ...FULL, NEXT_PUBLIC_SUPABASE_URL: " https://abc.supabase.co\n" }).supabase?.url).toBe("https://abc.supabase.co");
  });

  it("flags a short cron secret", () => {
    expect(readEnv({ ...FULL, CRON_SECRET: "short" }).problems.join(" ")).toMatch(/CRON_SECRET/);
  });

  it("derives the app address from Vercel when none is set", () => {
    expect(readEnv({ ...FULL, VERCEL_URL: "outbound.vercel.app" }).appUrl).toBe("https://outbound.vercel.app");
    expect(readEnv({ ...FULL, APP_URL: "https://mine.app", VERCEL_URL: "other.vercel.app" }).appUrl).toBe("https://mine.app");
  });
});

describe("demo mode can never sit beside real data", () => {
  it("turns on only with the flag, no Supabase project, and outside production", () => {
    expect(readEnv({ DEMO_MODE: "1" }).mode).toBe("demo");
    expect(readEnv({ DEMO_MODE: "1" }).problems).toEqual([]);
    expect(readEnv({ DEMO_MODE: "0" }).mode).toBe("supabase");
    expect(readEnv({}).mode).toBe("supabase");
  });

  it("is ignored, with a warning, when a Supabase project is configured", () => {
    const e = readEnv({ ...FULL, DEMO_MODE: "1" });
    expect(e.mode).toBe("supabase");
    expect(e.problems[0]).toMatch(/Supabase project is configured, so demo mode was ignored/);
  });

  it("is ignored, with a warning, in a production deployment", () => {
    const e = readEnv({ DEMO_MODE: "1", VERCEL_ENV: "production" });
    expect(e.mode).toBe("supabase");
    expect(e.problems[0]).toMatch(/production deployment, so it was ignored/);
  });
});

describe("a public demo in production", () => {
  const PROD = { DEMO_MODE: "1", DEMO_PUBLIC: "1", VERCEL_ENV: "production" };

  it("runs only when it is asked for twice and holds nothing real", () => {
    const e = readEnv(PROD);
    expect(e.mode).toBe("demo");
    expect(e.problems).toEqual([]);
  });

  it("is still refused in production without the public flag", () => {
    expect(readEnv({ DEMO_MODE: "1", VERCEL_ENV: "production" }).mode).toBe("supabase");
    expect(readEnv({ DEMO_PUBLIC: "1", VERCEL_ENV: "production" }).mode).toBe("supabase");
  });

  it("is refused when any real credential is present, and names which, never their values", () => {
    for (const name of ["SUPABASE_ANON_KEY", "WORKER_PASSWORD", "CRON_SECRET", "GEMINI_API_KEY", "HUNTER_API_KEY", "GMAIL_REFRESH_TOKEN", "GMAIL_FROM", "OUTBOUND_TEST_TO", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const e = readEnv({ ...PROD, [name]: "super-secret-value" });
      expect(e.mode, name).toBe("supabase");
      expect(e.problems.join(" ")).toContain(name);
      expect(e.problems.join(" ")).not.toContain("super-secret-value");
    }
  });

  it("is refused beside a Supabase project, in production or not", () => {
    expect(readEnv({ ...PROD, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }).mode).toBe("supabase");
    expect(readEnv({ DEMO_MODE: "1", DEMO_PUBLIC: "1", SUPABASE_URL: "https://x.supabase.co" }).mode).toBe("supabase");
  });

  it("ignores blanks, so an empty variable does not count as a credential", () => {
    expect(readEnv({ ...PROD, GEMINI_API_KEY: "", HUNTER_API_KEY: "  " }).mode).toBe("demo");
  });

  it("has no effect on a normal deployment that merely sets the public flag", () => {
    expect(readEnv({ ...FULL, DEMO_PUBLIC: "1", VERCEL_ENV: "production" }).mode).toBe("supabase");
    expect(realCredentials({})).toEqual([]);
  });
});

describe("sameSecret", () => {
  it("is true only for identical secrets, including different lengths", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "")).toBe(true);
    expect(sameSecret("abc", "")).toBe(false);
    // Padding with zeros must not make a secret equal to itself plus a NUL byte.
    expect(sameSecret("abc", "abc\0")).toBe(false);
    expect(sameSecret("abc\0", "abc")).toBe(false);
  });
});

describe("live research in a public demo", () => {
  const LIVE = { DEMO_MODE: "1", DEMO_PUBLIC: "1", DEMO_LIVE: "1", NODE_ENV: "production", GEMINI_API_KEY: "g-secret", HUNTER_API_KEY: "h-secret" };

  it("allows exactly the Gemini and Hunter keys, and turns the live features on with caps", () => {
    const e = readEnv(LIVE);
    expect(e.mode).toBe("demo");
    expect(e.problems).toEqual([]);
    expect(e.live).toEqual({ dailyTokens: 400_000, dailyHunter: 6 });
    expect(e.gemini?.apiKey).toBe("g-secret");
    expect(e.hunterKey).toBe("h-secret");
  });

  it("reads the caps from the environment, ignoring nonsense", () => {
    expect(readEnv({ ...LIVE, DEMO_LIVE_DAILY_TOKENS: "900000", DEMO_LIVE_DAILY_HUNTER: "2" }).live).toEqual({ dailyTokens: 900_000, dailyHunter: 2 });
    expect(readEnv({ ...LIVE, DEMO_LIVE_DAILY_TOKENS: "5", DEMO_LIVE_DAILY_HUNTER: "x" }).live).toEqual({ dailyTokens: 400_000, dailyHunter: 6 });
  });

  it("still refuses every other credential, naming it and never its value", () => {
    for (const name of ["GMAIL_REFRESH_TOKEN", "GMAIL_FROM", "OUTBOUND_TEST_TO", "WORKER_PASSWORD", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const e = readEnv({ ...LIVE, [name]: "very-secret" });
      expect(e.mode, name).toBe("supabase");
      expect(e.problems.join(" ")).toContain(name);
      expect(e.problems.join(" ")).not.toContain("very-secret");
    }
  });

  it("is ignored without the public flag, outside a deployment, or without a model key", () => {
    expect(readEnv({ ...LIVE, DEMO_PUBLIC: "" }).mode).toBe("supabase");
    const local = readEnv({ DEMO_MODE: "1", DEMO_PUBLIC: "1", DEMO_LIVE: "1", GEMINI_API_KEY: "g-secret" });
    expect(local.live).toBeNull();
    expect(local.gemini).toBeNull();
    expect(local.problems.join(" ")).toMatch(/only applies to a public demo deployment/);
    const nokey = readEnv({ DEMO_MODE: "1", DEMO_PUBLIC: "1", DEMO_LIVE: "1", NODE_ENV: "production" });
    expect(nokey.live).toBeNull();
    expect(nokey.problems.join(" ")).toMatch(/no GEMINI_API_KEY/);
  });

  it("never uses a key in a scripted demo, and works without the Hunter key", () => {
    const scripted = readEnv({ DEMO_MODE: "1", GEMINI_API_KEY: "g", HUNTER_API_KEY: "h" });
    expect(scripted.gemini).toBeNull();
    expect(scripted.hunterKey).toBeNull();
    const noHunter = readEnv({ ...LIVE, HUNTER_API_KEY: "" });
    expect(noHunter.live).not.toBeNull();
    expect(noHunter.hunterKey).toBeNull();
  });

  it("treats a plain production start (NODE_ENV) as a deployment, so the public flag is required on any host", () => {
    expect(readEnv({ DEMO_MODE: "1", NODE_ENV: "production" }).mode).toBe("supabase");
    expect(readEnv({ DEMO_MODE: "1", DEMO_PUBLIC: "1", NODE_ENV: "production" }).mode).toBe("demo");
  });
});
