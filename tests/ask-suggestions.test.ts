import { describe, expect, it } from "vitest";
import { askSuggestions, DEMO_SUGGESTIONS } from "@/lib/app/ask-suggestions";

const p = (domain: string, verdict: string | null, lane = "review") => ({ domain, verdict, lane });

describe("the example questions on Ask", () => {
  it("names real companies from the records, one ruled out and one that got furthest", () => {
    const s = askSuggestions([p("a.com", "maybe"), p("b.com", "not_fit", "not_fit"), p("c.com", "qualified", "sent")], false);
    expect(s).toContain("Why was b.com not a fit?");
    expect(s).toContain("Tell me about c.com");
    expect(s.join(" ")).not.toMatch(/petalpop|harborpay/);
  });

  it("prefers a company that was sent, then a qualified or maybe one", () => {
    expect(askSuggestions([p("a.com", "maybe"), p("s.com", "qualified", "sent")], false)).toContain("Tell me about s.com");
    expect(askSuggestions([p("a.com", "maybe"), p("q.com", "qualified")], false)).toContain("Tell me about a.com");
  });

  it("falls back to the general questions when there is no company to name", () => {
    const s = askSuggestions([], false);
    expect(s).toEqual(["Who is waiting for a person?", "Which companies had no usable contact?", "How many companies are in each outcome?", "What are the send rules?"]);
  });

  it("never names a company twice, and keeps the demo's own examples in demo mode only", () => {
    expect(askSuggestions([p("x.com", "not_fit"), p("x.com", "not_fit")], false).filter((q) => q.includes("x.com"))).toHaveLength(1);
    expect(askSuggestions([], true)).toEqual(DEMO_SUGGESTIONS);
    expect(askSuggestions([p("z.com", "not_fit")], true)).toEqual(DEMO_SUGGESTIONS);
  });
});
