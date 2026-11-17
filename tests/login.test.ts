import { describe, expect, it } from "vitest";
import { linkNotSent, redirectBase } from "@/lib/app/login";

describe("redirectBase", () => {
  it("uses the configured address, without a trailing slash", () => {
    expect(redirectBase("https://app.example.com/", "production")).toBe("https://app.example.com");
    expect(redirectBase("https://app.example.com", "development")).toBe("https://app.example.com");
  });
  it("falls back to localhost in development only", () => {
    expect(redirectBase(null, "development")).toBe("http://localhost:3000");
    expect(redirectBase(null, undefined)).toBe("http://localhost:3000");
  });
  it("never guesses in production, so the link uses Supabase's own Site URL", () => expect(redirectBase(null, "production")).toBeNull());
});

describe("linkNotSent", () => {
  it("says so when the mail service is rate-limited or down", () => {
    expect(linkNotSent({ status: 429 })).toBe(true);
    expect(linkNotSent({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(linkNotSent({ code: "over_request_rate_limit" })).toBe(true);
    expect(linkNotSent({ status: 500 })).toBe(true);
    expect(linkNotSent({ status: 503 })).toBe(true);
  });
  it("is silent for success", () => {
    expect(linkNotSent(null)).toBe(false);
    expect(linkNotSent(undefined)).toBe(false);
  });
  it("stays silent about an unknown or uninvited address, so the form cannot reveal who is invited", () => {
    expect(linkNotSent({ status: 400, code: "otp_disabled" })).toBe(false);
    expect(linkNotSent({ status: 422, code: "signup_disabled" })).toBe(false);
    expect(linkNotSent({ status: 400 })).toBe(false);
    expect(linkNotSent({ status: 404 })).toBe(false);
  });
});
