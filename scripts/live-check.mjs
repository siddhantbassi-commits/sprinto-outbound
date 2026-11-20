// A read-only health check of the LIVE app, safe to run every day. It only reads pages: it starts no run, searches nothing, sends
// no email and so spends no Hunter credit and no model time.
//
//   npm run live-check                 checks https://sprinto-outbound-eight.vercel.app
//   LIVE_URL=https://example npm run live-check
//
// It opens the app the way a visitor does, follows every internal link it finds (pages, CSV exports, PDF briefs), and checks that
// each answers, that nothing shows an error page, that the pages a reviewer is sent to say what they should, and that the security
// headers are present. It exits 1 if anything is wrong, so a scheduler can tell.

const BASE = (process.env.LIVE_URL ?? "https://sprinto-outbound-eight.vercel.app").replace(/\/$/, "");
const COOKIE = "sprinto_intro=1"; // what the welcome animation sets, so the check lands on real pages
const SKIP = /^\/(api|auth|login|enter)(\/|$|\?)|signout/;
const MAX_PAGES = 400;
const failures = [];
const note = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(what + (detail ? ` (${detail})` : ""));
};

const get = async (path, init = {}) => {
  const res = await fetch(BASE + path, { redirect: "follow", headers: { cookie: COOKIE, accept: "text/html,*/*" }, signal: AbortSignal.timeout(30_000), ...init });
  return res;
};

const hrefsIn = (html) => [...html.matchAll(/href="(\/[^"#]*)/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((h) => !h.startsWith("//"));

// ---- 1. the front door and the pages a reviewer is sent to
const expect = [
  ["/", /Today/],
  ["/privacy", /Privacy notice/],
  ["/review", /Review/],
  ["/leads", /Leads/],
  ["/leads/compare", /ompare/],
  ["/settings", /Settings/],
  ["/rulebook", /Send/],
  ["/discover", /Discover/],
  ["/ask", /Ask/],
];
for (const [path, re] of expect) {
  try {
    const r = await get(path);
    const t = await r.text();
    note(r.status === 200 && re.test(t), `page ${path}`, `HTTP ${r.status}`);
  } catch (e) {
    note(false, `page ${path}`, e.message);
  }
}

// ---- 2. the reviewer inbox is offered (the panel appears only when the sender and database support it)
try {
  const t = await (await get("/review")).text();
  note(/Want the test email in your own inbox\?|Test emails go to your own inbox/.test(t), "the reviewer inbox panel is on the Review page");
} catch (e) {
  note(false, "the reviewer inbox panel is on the Review page", e.message);
}

// ---- 3. security headers on a normal page
try {
  const r = await get("/");
  const csp = r.headers.get("content-security-policy") ?? "";
  note(/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /nonce-/.test(csp), "content security policy is in force");
  note(Boolean(r.headers.get("strict-transport-security")), "strict transport security is on");
  note(r.headers.get("x-content-type-options") === "nosniff", "nosniff is on");
} catch (e) {
  note(false, "security headers", e.message);
}

// ---- 4. the worker's endpoints refuse an ordinary visit (they only ever answer a signed call)
for (const p of ["/api/worker/tick", "/api/worker/digest", "/api/worker/golden"]) {
  try {
    const r = await get(p);
    note(r.status >= 400 && r.status < 500, `${p} does not answer a plain visit`, `HTTP ${r.status}`);
  } catch (e) {
    note(false, p, e.message);
  }
}

// ---- 5. follow every internal link
const seen = new Map();
const queue = ["/"];
const types = {};
const bad = [];
const work = async () => {
  while (queue.length && seen.size < MAX_PAGES) {
    const p = queue.shift();
    if (seen.has(p) || SKIP.test(p)) continue;
    seen.set(p, "pending");
    try {
      const r = await get(p);
      const ct = (r.headers.get("content-type") ?? "").split(";")[0];
      types[ct] = (types[ct] ?? 0) + 1;
      if (ct.includes("html")) {
        const t = await r.text();
        const err = /Application error: a (server|client)-side exception|NEXT_NOT_FOUND|<title>[^<]*\b(404|not found)\b[^<]*<\/title>/i.test(t);
        seen.set(p, r.status);
        if (r.status >= 400 || err) bad.push(`${p} -> ${r.status}${err ? " error page" : ""}`);
        else for (const h of hrefsIn(t)) if (!seen.has(h)) queue.push(h);
      } else {
        seen.set(p, r.status);
        if (r.status >= 400) bad.push(`${p} -> ${r.status}`);
        await r.body?.cancel();
      }
    } catch (e) {
      seen.set(p, "error");
      bad.push(`${p} -> ${e.message}`);
    }
  }
};
await Promise.all([work(), work(), work(), work()]);
const summary = Object.entries(types).map(([k, v]) => `${v} ${k.split("/")[1] ?? k}`).join(", ");
note(bad.length === 0 && seen.size > 40, `every internal link answers (${seen.size} addresses: ${summary})`, bad.slice(0, 5).join("; "));

console.log(failures.length ? `\nFAILED: ${failures.length} problem${failures.length === 1 ? "" : "s"}` : "\nALL GOOD: nothing spent, nothing sent.");
process.exit(failures.length ? 1 : 0);
