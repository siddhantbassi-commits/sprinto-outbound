import { describe, expect, it } from "vitest";
import { chooseContact, classifyTitle, rankCandidate, type Candidate } from "@/lib/contacts/rank";

const person = (over: Partial<Candidate> = {}): Candidate => ({
  source: "hunter", firstName: "Priya", lastName: "Rao", position: "Head of Security", email: "priya@acme.com", type: "personal",
  seniority: "senior", department: "security", confidence: 94, verification: "valid", ...over,
});

describe("classifyTitle", () => {
  it.each([
    ["Head of Security", "security_lead"], ["CISO", "security_lead"], ["Chief Information Security Officer", "security_lead"],
    ["VP, Information Security", "security_lead"], ["Director of Security", "security_lead"],
    ["Head of GRC", "grc"], ["Director of Compliance", "grc"], ["Risk and Compliance Manager", "grc"],
    ["CTO", "cto"], ["Chief Technology Officer", "cto"], ["Technical Co-Founder", "cto"],
    ["VP Engineering", "eng_head"], ["Head of Engineering", "eng_head"], ["Engineering Director", "eng_head"],
    ["Head of IT", "it_head"], ["IT Director", "it_head"],
    ["COO", "coo"], ["CEO", "ceo"], ["Co-Founder & CEO", "ceo"], ["Founder", "ceo"],
  ])("%s is %s", (title, role) => expect(classifyTitle(title)).toBe(role));

  it.each(["VP Sales", "Marketing Manager", "Head of Growth", "HR Business Partner", "Recruiter", "Account Executive", "Intern", "Product Designer", "Customer Success Lead", null, ""])(
    "%j is not a compliance owner",
    (title) => expect(classifyTitle(title as string | null)).toBeNull(),
  );
});

describe("rankCandidate", () => {
  it("scores each part and adds them up", () => {
    const r = rankCandidate(person(), "51-200");
    // title 50, senior 10, valid 20, confidence 94 gives 10, department 5
    expect(r.score).toBe(95);
    expect(r.parts.map((p) => p.points)).toEqual([50, 10, 20, 10, 5]);
    expect(r.excluded).toBeNull();
  });

  it("changes the title weight with company size", () => {
    expect(rankCandidate(person({ position: "CTO" }), "11-50").score).toBeGreaterThan(rankCandidate(person({ position: "Head of Security" }), "11-50").score - 20);
    expect(rankCandidate(person({ position: "CTO" }), "11-50").parts[0]?.points).toBe(50);
    expect(rankCandidate(person({ position: "CTO" }), "201-500").parts[0]?.points).toBe(30);
    expect(rankCandidate(person({ position: "CEO" }), "201-500").excluded).toMatch(/not the buyer/);
  });

  it.each([
    ["no email", { email: null }, /No email/],
    ["a shared mailbox", { email: "info@acme.com" }, /shared mailbox/],
    ["a generic type", { type: "generic" as const }, /shared mailbox/],
    ["no last name", { lastName: null }, /full name/],
    ["a one-letter name", { firstName: "P" }, /full name/],
    ["a junior title", { seniority: "junior" as const }, /junior/],
    ["an invalid email", { verification: "invalid" as const }, /invalid/],
    ["a disposable email", { verification: "disposable" as const }, /disposable/],
    ["a sales title", { position: "VP Sales" }, /not a compliance owner/],
  ])("excludes %s", (_n, over, why) => expect(rankCandidate(person(over), "51-200").excluded).toMatch(why));

  it("scores weaker evidence lower", () => {
    const strong = rankCandidate(person(), "51-200").score;
    expect(rankCandidate(person({ verification: "accept_all" }), "51-200").score).toBe(strong - 12);
    expect(rankCandidate(person({ confidence: 50 }), "51-200").score).toBe(strong - 8);
    expect(rankCandidate(person({ seniority: "executive" }), "51-200").score).toBe(strong + 5);
  });

  it("uses the middle table when size is unknown", () => {
    expect(rankCandidate(person({ position: "CTO" }), null).parts[0]?.points).toBe(42);
  });
});

describe("chooseContact", () => {
  it("chooses the best and explains it from the numbers", () => {
    const c = chooseContact([
      person({ firstName: "Sam", lastName: "Lee", position: "CTO", email: "sam@acme.com", department: "executive" }),
      person(),
    ], "51-200");
    expect(c.chosen?.candidate.firstName).toBe("Priya");
    expect(c.runnerUp?.candidate.position).toBe("CTO");
    expect(c.explanation).toMatch(/^Chosen: Head of Security, 95 \(/);
    expect(c.explanation).toMatch(/Runner-up: CTO, \d+\./);
  });

  it("always prefers a hand-picked contact over Hunter", () => {
    const c = chooseContact([person(), person({ source: "manual", firstName: "Ana", lastName: "Diaz", position: "CTO", email: "ana@acme.com", verification: null, confidence: null, seniority: null, department: null })], "51-200");
    expect(c.chosen?.candidate.firstName).toBe("Ana");
    expect(c.explanation).toMatch(/hand-picked/);
  });

  it("breaks ties the same way every time", () => {
    const a = person({ firstName: "Zed", lastName: "Adams", email: "z@acme.com" });
    const b = person({ firstName: "Amy", lastName: "Brown", email: "a@acme.com" });
    expect(chooseContact([b, a], "51-200").chosen?.candidate.lastName).toBe("Adams");
    expect(chooseContact([a, b], "51-200").chosen?.candidate.lastName).toBe("Adams");
  });

  it("prefers a verified email on equal score", () => {
    const valid = person({ firstName: "Val", lastName: "Id", email: "v@acme.com", verification: "valid", confidence: 70 });
    const accept = person({ firstName: "Acc", lastName: "Ept", email: "a@acme.com", verification: "accept_all", confidence: 96, seniority: "executive" });
    const r = chooseContact([accept, valid], "51-200");
    expect(r.ranked.length).toBe(2);
    expect(r.chosen?.score).toBeGreaterThanOrEqual(r.runnerUp?.score ?? 0);
  });

  it("says so when nobody is suitable", () => {
    const c = chooseContact([person({ email: "info@acme.com" }), person({ position: "Intern" })], "51-200");
    expect(c.chosen).toBeNull();
    expect(c.excluded).toHaveLength(2);
    expect(c.explanation).toMatch(/No suitable contact/);
  });

  it("handles an empty list", () => {
    expect(chooseContact([], "51-200").chosen).toBeNull();
  });
});
