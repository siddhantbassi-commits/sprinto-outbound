import { describe, expect, it } from "vitest";
import { addNotice, MAX_NOTICES, readNotices, unreadCount, whenText, type Notice } from "@/lib/app/notices";

const n = (id: string, at: number, over: Partial<Notice> = {}): Notice => ({ id, at, text: `Run ${id} is ready`, href: "/leads", ...over });

describe("the notification history", () => {
  it("puts the newest first, and replaces a repeat of the same notice instead of listing it twice", () => {
    const l = addNotice(addNotice([], n("a", 1)), n("b", 2));
    expect(l.map((x) => x.id)).toEqual(["b", "a"]);
    const again = addNotice(l, n("a", 3, { text: "updated" }));
    expect(again.map((x) => x.id)).toEqual(["a", "b"]);
    expect(again[0]!.text).toBe("updated");
  });

  it("keeps only the newest thirty", () => {
    let l: Notice[] = [];
    for (let i = 0; i < MAX_NOTICES + 5; i++) l = addNotice(l, n(`r${i}`, i));
    expect(l).toHaveLength(MAX_NOTICES);
    expect(l[0]!.id).toBe(`r${MAX_NOTICES + 4}`);
    expect(l.some((x) => x.id === "r0")).toBe(false);
  });

  it("counts what arrived after the list was last opened", () => {
    const l = [n("a", 100), n("b", 200), n("c", 300)];
    expect(unreadCount(l, 0)).toBe(3);
    expect(unreadCount(l, 200)).toBe(1);
    expect(unreadCount(l, 300)).toBe(0);
    expect(unreadCount([], 0)).toBe(0);
  });

  it("reads only well-formed entries from storage, newest first, and nothing from anything else", () => {
    const raw = [n("old", 1), { id: 5, at: 2, text: "x", href: null }, null, "junk", n("new", 9), { id: "x", at: "soon", text: "x", href: null }, n("ext", 5, { href: "https://evil.example/" }), n("ok", 3, { href: null })];
    expect(readNotices(raw).map((x) => x.id)).toEqual(["new", "ok", "old"]);
    for (const bad of [null, undefined, "x", 3, {}]) expect(readNotices(bad)).toEqual([]);
  });

  it("will not follow a link that leaves the app", () => {
    expect(readNotices([n("a", 1, { href: "//evil.example" })])).toHaveLength(0);
    expect(readNotices([n("a", 1, { href: "/\\evil.example" })])).toHaveLength(0);
    expect(readNotices([n("a", 1, { href: "/leads" })])).toHaveLength(1);
  });

  it("bounds the length of what it stores", () => {
    const [x] = readNotices([n("i".repeat(300), 1, { text: "t".repeat(900) })]);
    expect(x!.id).toHaveLength(80);
    expect(x!.text).toHaveLength(200);
  });

  it("says when, the way a person would", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const ago = (s: number) => now - s * 1000;
    expect(whenText(ago(10), now)).toBe("just now");
    expect(whenText(ago(5 * 60), now)).toBe("5 min ago");
    expect(whenText(ago(3 * 3600), now)).toBe("3 hours ago");
    expect(whenText(ago(3600), now)).toBe("1 hour ago");
    expect(whenText(ago(30 * 3600), now)).toBe("yesterday");
    expect(whenText(ago(3 * 86400), now)).toBe("3 days ago");
    expect(whenText(ago(20 * 86400), now)).toMatch(/\d+ \w+/);
    expect(whenText(now + 5000, now)).toBe("just now");
  });
});
