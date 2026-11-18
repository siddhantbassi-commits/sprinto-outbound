import { describe, expect, it } from "vitest";
import { createHunterClient, HunterError, readDiscover, type DiscoverCompany, type DiscoverResult, type HunterClient } from "@/lib/contacts/hunter";
import { ANGLES, angleRequest, defaultCriteria, estimateCost, HUNTER_EXCLUDE_LIMIT, MAX_WANT, mergeAngles, normaliseCriteria, standingOf, type AngleId, type Criteria } from "@/lib/discovery/criteria";
import { discover, type Known } from "@/lib/discovery/discover";
import { aboutFrom, readPeek, type Peek } from "@/lib/discovery/peek";
import { ICP_V1 } from "@/lib/icp/config";

const co = (domain: string, emails = 5, name = domain): DiscoverCompany => ({ domain, name, emailsTotal: emails, emailsPersonal: emails });
const base = defaultCriteria(ICP_V1);

describe("the starting criteria", () => {
  it("come from the ICP: the sizes it scores well, and the regions Sprinto sells into", () => {
    expect(base.sizes).toEqual(["11-50", "51-200", "201-500"]);
    expect(base.regions).toEqual(["AMER", "EMEA"]);
    expect(base.angles).toEqual(["hiring", "software", "regulated"]);
    expect(base.want).toBe(10);
  });

  it("follow a changed ICP rather than a fixed list", () => {
    const icp = { ...ICP_V1, points: { ...ICP_V1.points, size: { "1-10": 9, "11-50": 3, "51-200": 3, "201-500": 3, "501-1000": 3, "1000+": 0 } } };
    expect(defaultCriteria(icp).sizes).toEqual(["1-10"]);
  });
});

describe("what the browser posts", () => {
  it("is shape-checked: unknown values are dropped, a missing list falls back, the count is clamped", () => {
    const c = normaliseCriteria({ regions: ["EMEA", "MARS", 7], sizes: ["51-200", "huge"], angles: ["hiring", "x"], want: 9999 }, base);
    expect(c).toEqual({ regions: ["EMEA"], sizes: ["51-200"], angles: ["hiring"], want: MAX_WANT });
  });

  it("falls back to the default for anything it cannot use, including nothing at all", () => {
    expect(normaliseCriteria(null, base)).toEqual(base);
    expect(normaliseCriteria({ regions: [], sizes: "nope", angles: [], want: "ten" }, base)).toEqual(base);
    expect(normaliseCriteria({ want: 0 }, base).want).toBe(1);
    expect(normaliseCriteria({ want: 12.9 }, base).want).toBe(12);
  });

  it("removes repeats", () => {
    expect(normaliseCriteria({ regions: ["AMER", "AMER"] }, base).regions).toEqual(["AMER"]);
  });
});

describe("the request for each angle", () => {
  const crit: Criteria = { regions: ["AMER", "APAC"], sizes: ["51-200"], angles: ["hiring", "software", "regulated"], want: 10 };

  it("always narrows to software companies of the chosen size and region, and leaves out schools, charities and government", () => {
    for (const a of ANGLES) {
      const r = angleRequest(crit, a.id, []) as Record<string, any>;
      expect(r.industry).toEqual({ include: ["Software Development"] });
      expect(r.headcount).toEqual(["51-200"]);
      expect(r.headquarters_location).toEqual({ include: [{ business_region: "AMER" }, { business_region: "APAC" }] });
      expect(r.company_type.exclude).toEqual(expect.arrayContaining(["educational", "government agency", "non profit"]));
    }
  });

  it("asks the hiring angle for specific security, compliance and privacy roles in the last 90 days, not any 'security' job", () => {
    const r = angleRequest(crit, "hiring", []) as Record<string, any>;
    expect(r.job_openings.posted_date).toBe("last90d");
    expect(r.job_openings.job_title.include).toEqual(expect.arrayContaining(["information security", "compliance", "grc", "ciso"]));
    expect(r.job_openings.job_title.include).not.toContain("security");
    expect(r.keywords).toBeUndefined();
  });

  it("asks the software angle for SaaS keywords and the regulated angle for regulated-sector keywords", () => {
    const s = angleRequest(crit, "software", []) as Record<string, any>;
    expect(s.keywords).toEqual({ include: ["saas", "software as a service", "b2b"], match: "any" });
    const g = angleRequest(crit, "regulated", []) as Record<string, any>;
    expect(g.keywords.include).toEqual(expect.arrayContaining(["fintech", "healthtech", "payments", "insurance"]));
    expect(g.job_openings).toBeUndefined();
  });

  it("excludes the given domains, capped at what Hunter accepts, and leaves the field out when there are none", () => {
    const many = Array.from({ length: 150 }, (_, i) => `d${i}.com`);
    expect((angleRequest(crit, "software", many) as any).organization.exclude.domain).toHaveLength(HUNTER_EXCLUDE_LIMIT);
    expect((angleRequest(crit, "software", ["vanta.com"]) as any).organization.exclude.domain).toEqual(["vanta.com"]);
    expect((angleRequest(crit, "software", []) as any).organization).toBeUndefined();
  });
});

describe("merging the angles", () => {
  const found: Partial<Record<AngleId, DiscoverCompany[]>> = {
    hiring: [co("alpha.io", 40), co("beta.io", 3)],
    software: [co("alpha.io", 40), co("gamma.io", 60), co("beta.io", 3)],
    regulated: [co("alpha.io", 40), co("delta.io", 0)],
  };
  const m = mergeAngles(found);
  const by = (d: string) => m.find((x) => x.domain === d)!;

  it("lists each company once, with every angle that found it and the reason for each", () => {
    expect(m.map((x) => x.domain).sort()).toEqual(["alpha.io", "beta.io", "delta.io", "gamma.io"]);
    expect(by("alpha.io").angles).toEqual(["hiring", "software", "regulated"]);
    expect(by("alpha.io").because).toHaveLength(3);
    expect(by("alpha.io").because[0]).toMatch(/Hiring for a security/);
  });

  it("ranks more agreement higher, with a bonus for a hiring signal and a small one for known addresses", () => {
    expect(m[0]!.domain).toBe("alpha.io");
    // beta: hiring + software, gamma: software only with many addresses; two angles with a hiring signal beats one angle.
    expect(by("beta.io").rank).toBeGreaterThan(by("gamma.io").rank);
    expect(by("gamma.io").rank).toBeGreaterThan(by("delta.io").rank);
  });

  it("gives no bonus for a company Hunter holds no addresses for", () => {
    expect(by("delta.io").rank).toBe(10);
  });

  it("keeps the larger address count when two angles disagree", () => {
    const r = mergeAngles({ software: [co("x.io", 2)], regulated: [co("x.io", 90)] });
    expect(r[0]!.emailsTotal).toBe(90);
  });

  it("is empty when nothing was found", () => {
    expect(mergeAngles({})).toEqual([]);
  });
});

describe("where a company already stands", () => {
  const known = { researched: new Set(["a.com", "b.com", "c.com"]), suppressed: new Set(["a.com"]), mailed: new Set(["b.com"]) };
  it("says why a company is not new, strongest reason first", () => {
    expect(standingOf("a.com", known)).toBe("suppressed");
    expect(standingOf("b.com", known)).toBe("mailed_recently");
    expect(standingOf("c.com", known)).toBe("researched");
    expect(standingOf("z.com", known)).toBe("new");
  });
});

describe("the cost shown before a search is started", () => {
  it("is about 16,000 tokens and 40 seconds a company, and never under a minute", () => {
    expect(estimateCost(10)).toEqual({ tokens: 160_000, minutes: 7 });
    expect(estimateCost(1)).toEqual({ tokens: 16_000, minutes: 1 });
    expect(estimateCost(0).minutes).toBe(1);
  });
});

describe("reading Hunter's answer", () => {
  it("keeps clean domains and plain names, with the address counts", () => {
    const r = readDiscover({ data: [{ domain: "Acme.IO", organization: "Acme", emails_count: { personal: 4, generic: 1, total: 5 } }], meta: { results: 321 } });
    expect(r).toEqual({ companies: [{ domain: "acme.io", name: "Acme", emailsTotal: 5, emailsPersonal: 4 }], total: 321 });
  });

  it("drops an entry whose domain is not a public hostname, and falls back to the domain for a missing name", () => {
    const r = readDiscover({ data: [{ domain: "10.0.0.1" }, { domain: "localhost" }, { domain: "ok.com" }, "junk", null] });
    expect(r.companies).toEqual([{ domain: "ok.com", name: "ok.com", emailsTotal: 0, emailsPersonal: 0 }]);
    expect(r.total).toBe(1);
  });

  it("refuses an answer that is not a list of companies", () => {
    expect(() => readDiscover({ data: {} })).toThrow(HunterError);
    expect(() => readDiscover(null)).toThrow(HunterError);
  });
});

describe("the Hunter client's discover call", () => {
  const KEY = "hunter-secret-key-123";
  function fake(res: Response | Error) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string | URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;
    return { fn, seen };
  }
  const ok = () => new Response(JSON.stringify({ data: [{ domain: "a.com", organization: "A", emails_count: { total: 2, personal: 2 } }], meta: { results: 1 } }), { status: 200 });

  it("posts the filters with the key in a header, never in the address, and caps the page size", async () => {
    const f = fake(ok());
    const r = await createHunterClient({ apiKey: ` ${KEY}\n`, fetchFn: f.fn }).discover!({ headcount: ["51-200"] }, 5000);
    expect(r.companies).toHaveLength(1);
    expect(f.seen[0]!.url).toBe("https://api.hunter.io/v2/discover");
    expect(f.seen[0]!.url).not.toContain(KEY);
    expect((f.seen[0]!.init.headers as Record<string, string>)["X-API-KEY"]).toBe(KEY);
    expect(f.seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.seen[0]!.init.body))).toEqual({ headcount: ["51-200"], limit: 100 });
  });

  it("says plainly when the plan has no Discover, and tells that apart from being rate limited", async () => {
    const noAccess = fake(new Response(JSON.stringify({ errors: [{ id: "no_discover_access" }] }), { status: 403 }));
    await expect(createHunterClient({ apiKey: KEY, fetchFn: noAccess.fn }).discover!({})).rejects.toMatchObject({ code: "no_discover" });
    const limited = fake(new Response("{}", { status: 403 }));
    await expect(createHunterClient({ apiKey: KEY, fetchFn: limited.fn }).discover!({})).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps the other failures without leaking Hunter's text or the key", async () => {
    for (const [status, code] of [[401, "auth"], [429, "quota"], [400, "bad_request"], [500, "api_error"]] as const) {
      const f = fake(new Response(`secret ${KEY}`, { status }));
      const e = await createHunterClient({ apiKey: KEY, fetchFn: f.fn }).discover!({}).catch((x) => x);
      expect(e).toMatchObject({ code });
      expect(String(e.message)).not.toContain(KEY);
    }
    const t = fake(Object.assign(new Error("slow"), { name: "TimeoutError" }));
    await expect(createHunterClient({ apiKey: KEY, fetchFn: t.fn }).discover!({})).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("looking at a home page", () => {
  const SAAS = "Page title: Acme\nThe workflow platform for engineering teams that ship faster, with a public API and integrations.\nPricing\nBook a demo\nSign in\nCloud dashboard and analytics for developers.";

  it("takes the first line that reads like a description, not the title", () => {
    expect(aboutFrom(SAAS, "Acme")).toBe("The workflow platform for engineering teams that ship faster, with a public API and integrations.");
    expect(aboutFrom("Page title: Acme\nshort\nTiny", "Acme")).toBe("");
  });

  it("shortens a long description", () => {
    const long = `Page title: A\n${"word ".repeat(55)}`;
    expect(aboutFrom(long, "A").length).toBeLessThanOrEqual(220);
    expect(aboutFrom(long, "A").endsWith("…")).toBe(true);
  });

  it("recognises a software company from several of its own words, and says which", () => {
    const p = readPeek(SAAS, "Acme");
    expect(p.looksLikeSoftware).toBe(true);
    expect(p.signals).toEqual(expect.arrayContaining(["platform", "api", "pricing"]));
  });

  it("does not take a hotel with a login page for software", () => {
    const hotel = "Page title: Grand Hotel & Resort\nA beautiful hotel by the sea with a spa, restaurant and golf.\nSign in\nPricing\nBook a demo of our rooms.";
    expect(readPeek(hotel, "Grand Hotel & Resort").looksLikeSoftware).toBe(false);
  });

  it("does not take a hotel for software even when its booking platform uses the words", () => {
    const t = "Page title: Seaview Hotel\nOur hotel runs on a cloud platform and software for your booking, with an easy sign in.";
    expect(readPeek(t, "Seaview Hotel").looksLikeSoftware).toBe(false);
  });

  it("does take software that is sold to hospitals, clinics and schools", () => {
    const t = "Page title: Meridian Care\nMeridian Care is a patient messaging platform for hospital groups, with an API and cloud software.\nPricing";
    expect(readPeek(t, "Meridian Care").looksLikeSoftware).toBe(true);
  });

  it("does not take a university or a clinic with a patient login for software", () => {
    const t = "Page title: Riverside Clinic\nRiverside Clinic is a family clinic. Patients can sign in to the portal, see pricing and book a demo visit.";
    expect(readPeek(t, "Riverside Clinic").looksLikeSoftware).toBe(false);
  });

  it("does not take a plain brochure site for software", () => {
    expect(readPeek("Page title: Smith Plumbing\nFamily plumbers for forty years across the county, call us today.", "Smith Plumbing").looksLikeSoftware).toBe(false);
  });
});

describe("a whole search", () => {
  const crit: Criteria = { regions: ["AMER"], sizes: ["51-200"], angles: ["hiring", "software", "regulated"], want: 10 };
  const known = (over: Partial<Known> = {}): Known => ({ blocklist: [], researched: new Set(), suppressed: new Set(), mailed: new Set(), ...over });
  const fetchDeps = { resolve: async () => [], transport: async () => { throw new Error("no network in tests"); }, userAgent: "t" } as never;
  const soft = (about = "A workflow platform for teams."): Peek => ({ reachable: true, reason: null, title: "T", about, looksLikeSoftware: true, signals: ["platform", "api"] });

  function hunter(by: Partial<Record<AngleId, DiscoverCompany[] | Error>>): HunterClient {
    const order: AngleId[] = ["hiring", "software", "regulated"];
    let i = 0;
    return {
      account: async () => { throw new Error("unused"); },
      domainSearch: async () => { throw new Error("unused"); },
      discover: async (): Promise<DiscoverResult> => {
        const r = by[order[i++]!];
        if (r instanceof Error) throw r;
        return { companies: r ?? [], total: (r ?? []).length };
      },
    };
  }
  const run = (h: HunterClient, peek: (d: string) => Promise<Peek>, k = known(), c = crit, extra = {}) => discover(c, { hunter: h, fetchDeps, known: k, peek, ...extra });

  it("returns software companies, best first, with what each site says and why it was suggested", async () => {
    const o = await run(hunter({ hiring: [co("alpha.io", 30)], software: [co("alpha.io", 30), co("beta.io", 5)], regulated: [] }), async (d) => soft(`About ${d}, a software platform for teams.`));
    expect(o.found.map((f) => f.domain)).toEqual(["alpha.io", "beta.io"]);
    expect(o.found[0]).toMatchObject({ verified: true, standing: "new", angles: ["hiring", "software"], about: "About alpha.io, a software platform for teams." });
    expect(o.considered).toBe(2);
    expect(o.byAngle).toEqual({ hiring: 1, software: 2, regulated: 0 });
  });

  it("drops what is not software or cannot be reached, and says how many", async () => {
    const o = await run(hunter({ hiring: [co("good.io"), co("hotel.com"), co("dead.io")], software: [], regulated: [] }), async (d) =>
      d === "hotel.com" ? { ...soft(), looksLikeSoftware: false } : d === "dead.io" ? { reachable: false, reason: "no", title: "", about: "", looksLikeSoftware: false, signals: [] } : soft());
    expect(o.found.map((f) => f.domain)).toEqual(["good.io"]);
    expect(o.hidden).toEqual({ notSoftware: 1, unreachable: 1 });
  });

  it("keeps a site with too little text, marked as not checked, rather than throwing it away", async () => {
    const o = await run(hunter({ hiring: [co("spa.io")], software: [], regulated: [] }), async () => ({ reachable: true, reason: "thin", title: "Spa", about: "", looksLikeSoftware: false, signals: [] }));
    expect(o.found[0]).toMatchObject({ domain: "spa.io", verified: false });
    expect(o.found[0]!.note).toMatch(/little readable text/);
  });

  it("never shows a competitor, even if Hunter returned one", async () => {
    const o = await run(hunter({ hiring: [co("vanta.com"), co("drata.com"), co("mine.io")], software: [], regulated: [] }), async () => soft());
    expect(o.found.map((f) => f.domain)).toEqual(["mine.io"]);
    const extra = await run(hunter({ hiring: [co("rival.io"), co("mine.io")], software: [], regulated: [] }), async () => soft(), known({ blocklist: ["rival.io"] }));
    expect(extra.found.map((f) => f.domain)).toEqual(["mine.io"]);
  });

  it("shows companies it already knows about after the new ones, with the reason, and never looks at their site", async () => {
    const looked: string[] = [];
    const o = await run(hunter({ hiring: [co("new.io", 1), co("old.io", 99), co("nope.io", 98), co("sent.io", 97)], software: [], regulated: [] }), async (d) => (looked.push(d), soft()),
      known({ researched: new Set(["old.io"]), suppressed: new Set(["nope.io"]), mailed: new Set(["sent.io"]) }));
    expect(o.found.map((f) => `${f.domain}:${f.standing}`)).toEqual(["new.io:new", "old.io:researched", "nope.io:suppressed", "sent.io:mailed_recently"]);
    expect(looked).toEqual(["new.io"]);
  });

  it("carries on when one angle fails, and reports it", async () => {
    const o = await run(hunter({ hiring: new HunterError("api_error"), software: [co("a.io")], regulated: [] }), async () => soft());
    expect(o.found.map((f) => f.domain)).toEqual(["a.io"]);
    expect(o.byAngle.hiring).toBeNull();
    expect(o.problems[0]).toMatch(/Hiring for security or compliance/);
  });

  it("fails clearly when every angle fails, and at once when the plan has no Discover", async () => {
    await expect(run(hunter({ hiring: new HunterError("quota"), software: new HunterError("quota"), regulated: new HunterError("quota") }), async () => soft())).rejects.toMatchObject({ code: "quota" });
    let calls = 0;
    const noAccess: HunterClient = { account: async () => { throw new Error("x"); }, domainSearch: async () => { throw new Error("x"); }, discover: async () => { calls += 1; throw new HunterError("no_discover"); } };
    await expect(run(noAccess, async () => soft())).rejects.toMatchObject({ code: "no_discover" });
    expect(calls).toBe(1);
    await expect(run({ account: async () => { throw new Error("x"); }, domainSearch: async () => { throw new Error("x"); } }, async () => soft())).rejects.toMatchObject({ code: "no_discover" });
  });

  it("only runs the angles that were asked for", async () => {
    let n = 0;
    const h: HunterClient = { account: async () => { throw new Error("x"); }, domainSearch: async () => { throw new Error("x"); }, discover: async () => (n += 1, { companies: [co("a.io")], total: 1 }) };
    const o = await run(h, async () => soft(), known(), { ...crit, angles: ["software"] });
    expect(n).toBe(1);
    expect(Object.keys(o.byAngle)).toEqual(["software"]);
  });

  it("does not wait for a site that never answers", async () => {
    const o = await run(hunter({ hiring: [co("slow.io"), co("fast.io")], software: [], regulated: [] }), (d) => (d === "slow.io" ? new Promise<Peek>(() => undefined) : Promise.resolve(soft())), known(), crit, { peekTimeoutMs: 20 });
    expect(o.found.map((f) => f.domain)).toEqual(["fast.io"]);
    expect(o.hidden.unreachable).toBe(1);
  });

  it("only looks at as many sites as it was told to", async () => {
    const looked: string[] = [];
    const many = Array.from({ length: 8 }, (_, i) => co(`c${i}.io`, 8 - i));
    await run(hunter({ hiring: many, software: [], regulated: [] }), async (d) => (looked.push(d), soft()), known(), crit, { peekLimit: 3 });
    expect(looked).toEqual(["c0.io", "c1.io", "c2.io"]);
  });

  it("puts a company whose site was read ahead of one that could not be checked, when they otherwise rank the same", async () => {
    const o = await run(hunter({ hiring: [co("thin.io", 5), co("read.io", 5)], software: [], regulated: [] }), async (d) => (d === "thin.io" ? { reachable: true, reason: "thin", title: "", about: "", looksLikeSoftware: false, signals: [] } : soft()));
    expect(o.found.map((f) => f.domain)).toEqual(["read.io", "thin.io"]);
  });
});
