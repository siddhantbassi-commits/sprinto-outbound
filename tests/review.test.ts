import { describe, expect, it } from "vitest";
import { approvalQueue, CLEAN_CONTACT_CONFIDENCE, isClean, lintDraftEdit } from "@/lib/app/review";
import { editRatio } from "@/lib/app/editdiff";
import { pgPort } from "@/lib/db/pg-port";
import { getDemo } from "@/lib/demo/world";
import { Store } from "@/lib/worker/store";
import { tick } from "@/lib/worker/tick";

/** One draft waiting for a person, made by the real pipeline in the demo world (which requires approval). Shared by the tests below. */
let shared: Promise<{ d: Awaited<ReturnType<typeof getDemo>>; deps: ReturnType<Awaited<ReturnType<typeof getDemo>>["deps"]>; outboxBefore: number }> | null = null;
function draftWaiting() {
  shared ??= (async () => {
    const d = await getDemo();
    // The first sample run already mailed this company; age that send past the cooldown so a new run is allowed.
    await d.db.admin("update public.emails set sending_at = now() - interval '40 days' where domain = 'northwind.io' and status = 'sent'");
    await d.db.as(d.users.operator).query("select public.create_run($1::text[], 'paste', 'Second run', '{}'::jsonb)", [["northwind.io"]]);
    const deps = d.deps(new Store(pgPort(d.db.as(d.users.worker))));
    const outboxBefore = d.outbox.length;
    await tick(deps, { source: "browser", maxSteps: 50 });
    return { d, deps, outboxBefore };
  })();
  return shared;
}
const as = (d: Awaited<ReturnType<typeof getDemo>>, role: "admin" | "operator" | "viewer" | "pending") => pgPort(d.db.as(d.users[role]));

describe("a new draft waiting for a person", () => {
  it("stops for approval and shows up in the queue with everything needed to decide", async () => {
    const { d, outboxBefore } = await draftWaiting();
    const q = await approvalQueue(as(d, "admin"), true);
    const item = q.find((x) => x.domain === "northwind.io")!;
    expect(item).toBeTruthy();
    expect(item.email.subject.length).toBeGreaterThan(5);
    expect(item.email.body).toMatch(/^Hi \w+,/);
    expect(item.email.hook?.quote.length).toBeGreaterThan(10);
    expect(item.email.pains.length).toBe(2);
    expect(item.email.checks.length).toBe(12);
    expect(item.contact?.name).toMatch(/\w+ \w+/);
    expect(item.contact?.email).toMatch(/@northwind\.io$/);
    expect(item.reasons.length).toBeGreaterThan(0);
    expect(item.clean).toBe(true);
    expect(d.outbox.length).toBe(outboxBefore); // nothing was sent while it waits
  }, 90_000);

  it("hides a contact's name and address from a viewer, and shows a pending person nothing", async () => {
    const { d } = await draftWaiting();
    const item = (await approvalQueue(as(d, "viewer"), false)).find((x) => x.domain === "northwind.io")!;
    expect(item.contact?.name).toMatch(/hidden for viewers/);
    expect(item.contact?.email).toMatch(/^\w\*\*\*@northwind\.io$/);
    expect(JSON.stringify(item)).not.toMatch(/priya@|@northwind\.io"[^}]*priya/i);
    expect(await approvalQueue(as(d, "pending"), false)).toEqual([]);
  }, 90_000);
});

describe("editing a draft", () => {
  it("accepts the draft as written and a sensible polish", async () => {
    const { d } = await draftWaiting();
    const item = (await approvalQueue(as(d, "admin"), true)).find((x) => x.domain === "northwind.io")!;
    expect(await lintDraftEdit(as(d, "operator"), item.email.id, item.email.subject, item.email.body)).toEqual({ ok: true, failed: [] });
    const polished = item.email.body.replace(/Would a short call/i, "Would a quick call");
    expect((await lintDraftEdit(as(d, "operator"), item.email.id, item.email.subject, polished)).ok).toBe(true);
  }, 90_000);

  it("refuses an edit that breaks the rules: a banned phrase, an unverified figure, a missing opt-out, a fake Re:", async () => {
    const { d } = await draftWaiting();
    const item = (await approvalQueue(as(d, "admin"), true)).find((x) => x.domain === "northwind.io")!;
    const lint = (subject: string, body: string) => lintDraftEdit(as(d, "operator"), item.email.id, subject, body);
    const banned = await lint(item.email.subject, item.email.body.replace("Hi", "Hi").replace(/\n\n/, "\n\nWe are a game-changer for compliance.\n\n"));
    expect(banned.ok).toBe(false);
    const figure = await lint(item.email.subject, item.email.body.replace(/\n\n/, "\n\nWe cut audit prep by 97% for most teams.\n\n"));
    expect(figure.ok).toBe(false);
    const noFooter = await lint(item.email.subject, item.email.body.split("\n").filter((l) => !/1[0-9] Demo Street|reply "no"/i.test(l)).join("\n"));
    expect(noFooter.ok).toBe(false);
    expect((await lint("Re: your audit", item.email.body)).ok).toBe(false);
    expect((await lint("", item.email.body)).ok).toBe(false);
  }, 90_000);

  it("allows a figure that a verified claim contains, only once an admin has verified that claim", async () => {
    const { d } = await draftWaiting();
    const item = (await approvalQueue(as(d, "admin"), true)).find((x) => x.domain === "northwind.io")!;
    const text = item.email.body.replace(/\n\n/, "\n\nCustomers cut audit prep by 94% in the first quarter.\n\n");
    const lint = () => lintDraftEdit(as(d, "operator"), item.email.id, item.email.subject, text);
    expect((await lint()).failed.map((f) => f.id)).toContain("L7"); // no claim contains 94%
    const admin = as(d, "admin");
    const [row] = await admin.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
    const content = row!.content as { items: Record<string, unknown>[] };
    const claim = { id: "F9", kind: "proof", claim: "Customers cut audit prep by 94%.", sourceUrl: "https://example.com/proof" };
    // Added but not verified: the figure is still refused.
    await admin.insert("sprinto_facts_versions", { content: { ...content, items: [...content.items, { ...claim, verifiedBy: null, verifiedAt: null }] }, reason: "Added claim F9, not yet verified" });
    expect((await lint()).failed.map((f) => f.id)).toContain("L7");
    // Verified by a person: the same figure is now sourced.
    await admin.insert("sprinto_facts_versions", { content: { ...content, items: [...content.items, { ...claim, verifiedBy: "an admin", verifiedAt: "2026-11-18" }] }, reason: "Verified F9" });
    expect((await lint()).failed.map((f) => f.id)).not.toContain("L7");
  }, 90_000);

  it("says plainly that a draft which no longer exists cannot be checked", async () => {
    const { d } = await draftWaiting();
    expect(await lintDraftEdit(as(d, "operator"), "00000000-0000-4000-8000-000000000000", "s", "b")).toMatchObject({ ok: false });
  }, 90_000);
});

describe("approval, end to end", () => {
  it("sends the person's edited wording to the inbox, and keeps the model's draft and the measure of the change", async () => {
    const { d, deps } = await draftWaiting();
    const item = (await approvalQueue(as(d, "admin"), true)).find((x) => x.domain === "northwind.io")!;
    const subject = "Security reviews at Northwind, a quick note";
    const body = item.email.body.replace(/Would a short call/i, "Would a quick call");
    const ratio = editRatio(`${item.email.subject}\n${item.email.body}`, `${subject}\n${body}`);
    await as(d, "operator").rpc("approve_email", { p_email: item.email.id, p_subject: subject, p_body: body, p_edit_ratio: ratio, p_note: "Tightened the ask" });
    const before = d.outbox.length;
    await tick(deps, { source: "browser", maxSteps: 20 });
    expect(d.outbox.length).toBe(before + 1);
    expect(d.outbox.some((m) => m.subject === subject)).toBe(true);
    const [r] = await d.db.admin<{ edit_ratio: string; reason: string }>("select edit_ratio, reason from public.email_reviews where email_id = $1", [item.email.id]);
    expect(Number(r!.edit_ratio)).toBeCloseTo(ratio, 3);
    expect(r!.reason).toBe("Tightened the ask");
    const [orig] = await d.db.admin<{ subject: string }>("select subject from public.emails where id = $1", [item.email.id]);
    expect(orig!.subject).toBe(item.email.subject);
    // Decided, so it is no longer in the queue.
    expect((await approvalQueue(as(d, "admin"), true)).find((x) => x.domain === "northwind.io")).toBeUndefined();
  }, 90_000);
});

describe("isClean", () => {
  const ok = { verdict: "qualified", email: { checks: [{ id: "L1", pass: true, message: "" }], hook: { id: "H1", quote: "q", source: "s" } }, contact: { name: "A B" }, flags: [] as string[] };
  const call = (over: Record<string, unknown> = {}) => isClean({ ...ok, ...over } as never);
  it("needs every condition", () => {
    expect(call()).toBe(true);
    expect(call({ verdict: "maybe" })).toBe(false);
    expect(call({ email: { ...ok.email, checks: [{ id: "L1", pass: false, message: "" }] } })).toBe(false);
    expect(call({ email: { ...ok.email, checks: [] } })).toBe(false);
    expect(call({ email: { ...ok.email, hook: null } })).toBe(false);
    expect(call({ contact: null })).toBe(false);
    expect(call({ flags: ["Company size is unknown"] })).toBe(false);
  });
  it("is relaxed about routine caveats, and strict about a shaky contact", () => {
    expect(call({ flags: ["Company size is an estimate"] })).toBe(true);
    expect(call({ contact: { name: "A B", confidence: CLEAN_CONTACT_CONFIDENCE } })).toBe(true);
    expect(call({ contact: { name: "A B", confidence: CLEAN_CONTACT_CONFIDENCE - 1 } })).toBe(false);
    expect(call({ contact: { name: "A B", confidence: null } })).toBe(true);
  });
});
