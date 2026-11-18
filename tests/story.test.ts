import { describe, expect, it } from "vitest";
import { story, type StoryInput } from "@/lib/app/story";

const base: StoryInput = {
  lane: "review", step: "drafted", verdict: "qualified", score: 92,
  reasons: ["Compliance status", "Handles customer data in the cloud", "Sells to businesses", "Extra"],
  contact: { name: "Meera Iyer", title: "Head of Security" }, candidates: 2,
  pains: ["Repeated security questionnaires", "Vendor risk reviews"],
  checks: { pass: 12, total: 12 }, pages: { read: 6, thin: 1 },
  emailStatus: "drafted", review: null, laneReason: null,
};

describe("story", () => {
  it("explains a qualified company from its strongest three reasons only", () => {
    const s = story(base);
    expect(s.headline).toBe("A strong fit");
    expect(s.sentences[0]).toBe("Scored 92 out of 100, because of compliance status, handles customer data in the cloud and sells to businesses.");
    expect(s.sentences.join(" ")).not.toContain("extra");
  });

  it("names the person, the pains and the checks", () => {
    const t = story(base).sentences.join(" ");
    expect(t).toContain("Writing to Meera Iyer, Head of Security, chosen from 2 candidates.");
    expect(t).toContain("these pains: repeated security questionnaires and vendor risk reviews.");
    expect(t).toContain("It passed all 12 checks.");
    expect(t).toContain("Read 6 pages, 1 of them thin.");
  });

  it("says a draft is waiting for approval and points at the review desk", () => {
    expect(story(base).next).toEqual({ tone: "warn", text: "This draft is waiting for your approval.", action: "review" });
  });

  it("stops asking for approval once a decision exists, even if the lane has not caught up", () => {
    const s = story({ ...base, review: { action: "approve", editRatio: 0, reason: "" } });
    expect(s.next.action).toBeUndefined();
    expect(s.next.text).not.toBe("This draft is waiting for your approval.");
  });

  it("reports what the person did, with the share edited", () => {
    expect(story({ ...base, lane: "active", review: { action: "approve", editRatio: 0, reason: "" } }).sentences.at(-1)).toBe("A person approved it as written.");
    expect(story({ ...base, lane: "active", review: { action: "approve", editRatio: 0.184, reason: "" } }).sentences.at(-1)).toBe("A person edited about 18% of it before approving.");
    const r = story({ ...base, lane: "skipped", review: { action: "reject", editRatio: 0, reason: "wrong person" } });
    expect(r.sentences.at(-1)).toBe("A person rejected the draft: wrong person.");
    expect(r.next.text).toBe("Rejected at review. It will not be sent.");
  });

  it("never claims more than was recorded", () => {
    const s = story({ ...base, verdict: null, score: null, reasons: [], contact: null, candidates: 0, pains: [], checks: null, pages: { read: 0, thin: 0 }, emailStatus: null, lane: "failed", laneReason: "Could not fetch the site." });
    expect(s.headline).toBe("Not assessed yet");
    expect(s.sentences).toEqual(["No pages could be read, so nothing was scored."]);
    expect(s.next).toEqual({ tone: "bad", text: "Could not fetch the site." });
  });

  it("marks a sent email and a failed check count", () => {
    expect(story({ ...base, lane: "sent", checks: { pass: 11, total: 12 } }).next.text).toBe("Sent to the test inbox. The contact was not mailed.");
    expect(story({ ...base, checks: { pass: 11, total: 12 } }).sentences.join(" ")).toContain("It passed 11 of 12 checks.");
  });

  it("calls a company the rubric rejected 'not a fit', not 'not assessed' (the stored verdict is not_fit)", () => {
    const s = story({ ...base, verdict: "not_fit", score: 12 });
    expect(s.headline).toBe("Not a fit");
    expect(s.tone).toBe("bad");
  });
});
